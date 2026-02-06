// netlify/functions/whatauto_ingest.js

export default async (req) => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const INGEST_BEARER = process.env.INGEST_BEARER || "CONSYSENCIA_SECURE_INGEST_V1";

  const nowIso = new Date().toISOString();
  const trace =
    (crypto?.randomUUID?.() || `t_${Date.now()}_${Math.random().toString(16).slice(2)}`).slice(0, 36);

  // --- Helpers
  const json = (statusCode, obj) => ({
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(obj),
  });

  const safeText = async () => {
    try {
      return await req.text();
    } catch {
      return "";
    }
  };

  const parseBody = async () => {
    // 1) Tenta JSON
    try {
      const j = await req.json();
      if (j && typeof j === "object") return { ok: true, data: j, mode: "json" };
    } catch {}

    // 2) Tenta x-www-form-urlencoded / key=value
    const raw = await safeText();
    if (!raw) return { ok: false, data: null, mode: "empty", raw: "" };

    // alguns WhatsAuto mandam algo tipo "{app=WhatsAuto, sender=..., message=...}"
    // vamos normalizar e extrair por regex simples
    const cleaned = raw
      .trim()
      .replace(/^\{/, "")
      .replace(/\}$/, "")
      .replace(/\s+/g, " ");

    // tenta URLSearchParams direto
    try {
      const p = new URLSearchParams(cleaned);
      const obj = {};
      for (const [k, v] of p.entries()) obj[k] = v;
      if (Object.keys(obj).length) return { ok: true, data: obj, mode: "form", raw };
    } catch {}

    // tenta parse por "chave=valor" separado por vírgula
    const obj = {};
    for (const part of cleaned.split(",")) {
      const [k, ...rest] = part.split("=");
      if (!k || !rest.length) continue;
      obj[k.trim()] = rest.join("=").trim();
    }
    if (Object.keys(obj).length) return { ok: true, data: obj, mode: "kv", raw };

    return { ok: false, data: null, mode: "unknown", raw };
  };

  const sha256Hex = async (input) => {
    const enc = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  };

  // --- Auth (Bearer)
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== INGEST_BEARER) {
    return json(401, { ok: false, trace, code: "unauthorized" });
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json(500, { ok: false, trace, code: "missing_env" });
  }

  // --- Parse inbound
  const parsed = await parseBody();
  if (!parsed.ok) {
    return json(400, { ok: false, trace, code: "bad_json", mode: parsed.mode, raw: parsed.raw || "" });
  }

  const b = parsed.data;

  // WhatsAuto padrão: app, sender, message, group_name, phone
  const app = String(b.app || "WhatsAuto");
  const sender = String(b.sender || "");
  const message = String(b.message || "");
  const group_name = String(b.group_name || "");
  const phone = String(b.phone || "");

  // --- Normalize payload
  const payload = {
    app,
    sender,
    message,
    group_name,
    phone,
    received_at: nowIso,
    trace,
    parse_mode: parsed.mode,
  };

  // --- Dedupe key (evita 409 e duplicatas)
  // Base: app + sender + phone + group + message + janela de tempo (minuto)
  const minuteBucket = nowIso.slice(0, 16); // "YYYY-MM-DDTHH:MM"
  const dedupeBase = [app, sender, phone, group_name, message, minuteBucket].join("|");
  const dedupe_key = await sha256Hex(dedupeBase);

  // --- Insert into core_events
  // IMPORTANTES:
  //  - source='whatauto'
  //  - kind='whatauto_in'  (trigger vai disparar o reply)
  //  - trace (ajuda auditoria)
  //  - dedupe_key (evita duplicação)
  const row = {
    source: "whatauto",
    kind: "whatauto_in",
    severity: 0,
    trace,
    payload,
    dedupe_key,
  };

  // Supabase REST insert
  const url = `${SUPABASE_URL}/rest/v1/core_events`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify([row]),
  });

  // 201 ok, 409 conflict (dedupe) também é "ok" pro nosso caso
  if (res.status === 409) {
    return json(200, { ok: true, trace, code: "deduped", status: 409 });
  }

  const text = await res.text();
  if (!res.ok) {
    return json(500, { ok: false, trace, code: "insert_failed", status: res.status, body: text });
  }

  return json(200, { ok: true, trace, code: "insert_ok", status: res.status });
};
                      

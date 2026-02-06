// netlify/functions/whatauto_ingest.js

const crypto = require("crypto");

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function getBearerToken(headers = {}) {
  const auth = headers.authorization || headers.Authorization || "";
  if (!auth) return "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return (m ? m[1] : auth).trim();
}

function safeTrim(s) {
  return String(s ?? "").trim();
}

// Aceita:
// 1) JSON válido
// 2) form-urlencoded: a=b&c=d
// 3) texto tipo: {app=WhatsAuto, sender=..., message=...}
function parseBody(event) {
  const raw = event.body || "";
  if (!raw) return {};

  // 1) tenta JSON
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") return obj;
  } catch (_) {}

  // content-type pode ajudar, mas não confiamos 100%
  const ct = safeTrim(event.headers?.["content-type"] || event.headers?.["Content-Type"] || "").toLowerCase();

  // 2) tenta x-www-form-urlencoded
  // mesmo que ct não venha, tentamos se tiver "=" e "&"
  if (raw.includes("=")) {
    // Caso venha com chaves e vírgulas: {a=b, c=d}
    const cleaned = raw
      .trim()
      .replace(/^\{/, "")
      .replace(/\}$/, "")
      .trim();

    // Se parece com a=b&c=d
    if (ct.includes("application/x-www-form-urlencoded") || cleaned.includes("&")) {
      try {
        const params = new URLSearchParams(cleaned);
        const out = {};
        for (const [k, v] of params.entries()) out[k] = v;
        if (Object.keys(out).length) return out;
      } catch (_) {}
    }

    // 3) tenta formato "a=b, c=d"
    // split por vírgula, depois por "="
    const out = {};
    const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      const idx = part.indexOf("=");
      if (idx === -1) continue;
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k) out[k] = v;
    }
    if (Object.keys(out).length) return out;
  }

  return {};
}

exports.handler = async (event) => {
  const neutralOk = {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply: "" }),
  };

  if (event.httpMethod !== "POST") return neutralOk;

  // Auth
  const expectedToken = safeTrim(process.env.WHATAUTO_INGEST_TOKEN);
  const gotToken = getBearerToken(event.headers);

  if (!expectedToken || gotToken !== expectedToken) {
    console.log("[whatauto_ingest] auth_failed");
    return neutralOk;
  }

  // Parse tolerante
  const body = parseBody(event);

  // Normaliza campos (aceita variações de nome)
  const app = safeTrim(body.app || body.application || "WhatsAuto");
  const sender = safeTrim(body.sender || body.from || "");
  const message = safeTrim(body.message || body.text || "");
  const groupName = safeTrim(body.group_name || body.group || body.groupName || "");
  const phone = safeTrim(body.phone || body.number || body.msisdn || "");

  if (!message && !sender && !phone && !groupName) {
    // Sem dados úteis: não insere
    console.log("[whatauto_ingest] empty_payload");
    return neutralOk;
  }

  const dedupeKey =
    "whatauto:" + sha256Hex([app, phone, groupName, sender, message].join("|"));

  const actorHash = phone ? sha256Hex("phone:" + phone) : sha256Hex("sender:" + sender);

  const nowIso = new Date().toISOString();

  const payload = {
    ts: nowIso,
    app,
    sender,
    message,
    group_name: groupName || null,
    phone_last4: phone ? phone.slice(-4) : null,
    actor_hash: actorHash,
    raw: {
      // preserva o bruto “parseado” sem phone completo
      ...body,
      phone: undefined,
    },
  };

  const row = {
    source: "whatauto",
    kind: groupName ? "message_in_group" : "message_in_dm",
    severity: 1,
    trace: "whatauto_ingest_v1",
    payload,
    dedupe_key: dedupeKey,
  };

  const SUPABASE_URL = safeTrim(process.env.SUPABASE_URL);
  const SUPABASE_SERVICE_ROLE_KEY = safeTrim(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.log("[whatauto_ingest] missing_env");
    return neutralOk;
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/core_events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });

    console.log("[whatauto_ingest] insert_status", resp.status);
    return neutralOk;
  } catch (e) {
    console.log("[whatauto_ingest] insert_exception");
    return neutralOk;
  }
};

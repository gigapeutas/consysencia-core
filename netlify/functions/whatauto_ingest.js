// netlify/functions/whatauto_ingest.js
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

// Import do “cérebro” local (ajuste o caminho se seu repo for diferente)
const brain = require("./_core/brain.js");

// === Helpers ===
function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(obj),
  };
}

function truncate(str, n = 700) {
  if (str == null) return "";
  str = String(str);
  return str.length > n ? str.slice(0, n) + "…" : str;
}

function safeLower(s) {
  return String(s || "").toLowerCase();
}

function decodeBody(event) {
  const raw = event?.body ?? "";
  if (!raw) return "";
  if (event?.isBase64Encoded) {
    try {
      return Buffer.from(raw, "base64").toString("utf8");
    } catch {
      return String(raw);
    }
  }
  return String(raw);
}

function parseTextKV(raw) {
  // aceita: "{a=b, c=d}" OR "a=b, c=d" OR "a=b&c=d"
  const out = {};
  let s = String(raw || "").trim();

  if (!s) return out;

  // remove chaves
  if (s.startsWith("{") && s.endsWith("}")) s = s.slice(1, -1).trim();

  // querystring
  if (s.includes("&") && s.includes("=")) {
    try {
      const usp = new URLSearchParams(s);
      for (const [k, v] of usp.entries()) out[k] = v;
      return out;
    } catch {
      // cai pra split
    }
  }

  // split por vírgula (a=b, c=d)
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(v.replace(/\+/g, " "));
  }
  return out;
}

function normalizeFields(obj) {
  const src = obj || {};

  const sender =
    src.sender ?? src.from ?? src.name ?? src.contact ?? src.user ?? null;

  const message =
    src.message ?? src.text ?? src.body ?? src.content ?? src.msg ?? null;

  const phone =
    src.phone ??
    src.number ??
    src.msisdn ??
    src.remote_jid ??
    src.remoteJid ??
    null;

  const group_name =
    src.group_name ?? src.group ?? src.groupName ?? src.chat ?? null;

  const app = src.app ?? src.platform ?? "WhatsAuto";

  return { app, sender, message, phone, group_name };
}

function sha256(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

function getAuthToken(event) {
  const h = event?.headers || {};
  return h.authorization || h.Authorization || "";
}

function hasValidAuth(event) {
  const expected = process.env.CS_ADMIN_TOKEN;
  if (!expected) return true; // se você esquecer de setar env, não bloqueia dev
  const token = getAuthToken(event);
  // esperado: "Bearer <token>"
  return token === `Bearer ${expected}`;
}

// === Main ===
exports.handler = async (event, context) => {
  try {
    // 0) auth
    if (!hasValidAuth(event)) {
      return json(401, { reply: "UNAUTHORIZED" });
    }

    // 1) decode body + content-type
    const headers = event?.headers || {};
    const contentType = safeLower(headers["content-type"] || headers["Content-Type"]);
    const rawBody = decodeBody(event);

    // 2) parse body (json / form / text)
    let parsed = null;
    let body_type_detected = "unknown";
    let parse_path = [];

    if (contentType.includes("application/json")) {
      parse_path.push("json");
      body_type_detected = "json";
      try {
        parsed = rawBody ? JSON.parse(rawBody) : {};
      } catch (e) {
        // não explode: registra e segue
        parsed = { _parse_error: "json_invalid", _raw: truncate(rawBody) };
      }
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      parse_path.push("form");
      body_type_detected = "form";
      try {
        const usp = new URLSearchParams(rawBody);
        parsed = Object.fromEntries(usp.entries());
      } catch (e) {
        parsed = { _parse_error: "form_invalid", _raw: truncate(rawBody) };
      }
    } else {
      parse_path.push("text");
      body_type_detected = "text";
      parsed = parseTextKV(rawBody);
      // se vier texto “solto”, guarda também
      if (!Object.keys(parsed || {}).length && rawBody) {
        parsed = { message: rawBody };
      }
    }

    // 3) canonical
    const canonical = normalizeFields(parsed);

    // 4) LOOP GUARD (anti ping-pong):
    // tudo que o bot enviar vai começar com "🧠 "
    // se voltar pro webhook, a gente IGNORA e não responde.
    const msg = String(canonical.message || "").trim();
    if (msg.startsWith("🧠 ")) {
      // registra mesmo assim (opcional), mas não responde pra não loopar
      return json(200, { reply: "" });
    }

    // 5) monta payload rico
    const idempotency_key = sha256(
      `${canonical.app}|${canonical.phone}|${canonical.sender}|${msg}|${event?.requestContext?.requestId || ""}|${Date.now()}`
    );

    const payload = {
      provider: "whatauto",
      content_type: contentType || null,
      body_type_detected,
      parse_path,
      raw_body_preview: truncate(rawBody, 1200),
      parsed_body_preview: parsed,
      extracted_fields: canonical,
      canonical, // mantém redundante pra facilitar query
      headers_preview: {
        "content-type": headers["content-type"] || headers["Content-Type"] || null,
        "user-agent": headers["user-agent"] || headers["User-Agent"] || null,
      },
      netlify: {
        function: context?.functionName || "whatauto_ingest",
        request_id: event?.requestContext?.requestId || null,
      },
      idempotency_key,
      received_at: new Date().toISOString(),
    };

    // 6) grava no Supabase (core_events)
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      // sem env => não quebra, mas avisa
      // ainda assim tenta responder via brain, se possível
      // (você vai ver isso no WhatsApp e saber que faltou ENV)
    }

    let inserted = null;

    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      });

      const { data, error } = await supabase
        .from("core_events")
        .insert([
          {
            provider: "whatauto",
            sender: canonical.sender,
            phone: canonical.phone,
            group_name: canonical.group_name,
            message_preview: truncate(canonical.message, 180),
            payload,
          },
        ])
        .select("id, created_at")
        .single();

      if (error) {
        // não explode, só registra no payload de saída
        payload.supabase_error = {
          message: error.message,
          details: error.details || null,
          hint: error.hint || null,
          code: error.code || null,
        };
      } else {
        inserted = data;
      }
    }

    // 7) chama o cérebro (o “servidor” de verdade)
    // Esperado: brain.process({ canonical, payload, inserted }) -> { reply }
    // Se o seu brain exporta diferente, ajusta aqui.
    let replyText = null;

    try {
      if (brain && typeof brain.process === "function") {
        const out = await brain.process({
          canonical,
          payload,
          inserted,
        });
        replyText = out?.reply ?? out?.text ?? out?.message ?? null;
      }
    } catch (e) {
      payload.brain_error = truncate(e?.stack || e?.message || String(e), 1500);
    }

    // 8) fallback inteligente (nunca deixa “mudo”)
    // Se não tiver reply do brain, dá um OK mínimo pra validar pipeline.
    if (!replyText) {
      if (!canonical.message || !canonical.sender || !canonical.phone) {
        // aqui o WhatsAuto realmente não mandou o trio mínimo.
        // mas mesmo assim gravamos payload rico pra depurar.
        replyText = "🧠 Recebi seu webhook. Me envie JSON com message/sender/phone.";
      } else {
        replyText = "🧠 OK";
      }
    } else {
      // garante o prefixo anti-loop
      if (!String(replyText).startsWith("🧠 ")) replyText = "🧠 " + replyText;
    }

    return json(200, { reply: replyText });
  } catch (e) {
    // nunca devolve HTML de crash
    return json(200, { reply: "🧠 Erro interno no ingest. Tente novamente." });
  }
};

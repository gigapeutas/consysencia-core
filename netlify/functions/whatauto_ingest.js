/**
 * WhatsAuto -> ConSySencI.A Core ingest
 *
 * WhatsAuto envia JSON:
 * {
 *   "app": "...",
 *   "sender": "...",
 *   "message": "...",
 *   "group_name": "...",
 *   "phone": "..."
 * }
 *
 * Espera resposta JSON:
 * { "reply": "..." }
 */

const { createClient } = require("@supabase/supabase-js");

// Se você já tem brain.js, ele deve estar em: netlify/functions/_core/brain.js
// e exportar: module.exports = { decide };
let decideFn = null;
try {
  decideFn = require("./_core/brain").decide;
} catch (e) {
  decideFn = null;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

function getBearer(headers) {
  const h = headers.authorization || headers.Authorization || "";
  const v = (h || "").trim();
  if (!v.toLowerCase().startsWith("bearer ")) return null;
  return v.slice(7).trim();
}

function safePayload(raw) {
  // garante que o payload sempre tenha as chaves que usamos
  const p = raw && typeof raw === "object" ? raw : {};
  return {
    app: p.app || "whatsapp",
    sender: p.sender || "",
    message: (p.message || "").toString(),
    group_name: p.group_name || "",
    phone: (p.phone || "").toString(),
  };
}

exports.handler = async (event) => {
  try {
    // 1) método
    if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });

    // 2) auth (instance_key)
    const instance_key = getBearer(event.headers || {});
    if (!instance_key) return json(401, { error: "missing_instance_key" });

    // 3) env
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { error: "missing_supabase_env" });
    }

    // 4) payload
    let parsed = {};
    try {
      parsed = JSON.parse(event.body || "{}");
    } catch (_) {
      parsed = {};
    }
    const payload = safePayload(parsed);

    // ignora mensagens vazias
    if (!payload.message.trim()) return json(200, { reply: "" });

    // 5) supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 6) decidir resposta
    if (typeof decideFn === "function") {
      const decision = await decideFn({
        supabase,
        instance_key,
        payload,
        provider: "whatauto",
      });

      // suporte: se brain retornar formato completo
      const reply = (decision && decision.reply) ? decision.reply : "";
      return json(200, { reply });
    }

    // 7) fallback ultra seguro (se brain.js não existir ainda)
    return json(200, {
      reply:
        "Entendi. Me diz: você quer ativar o sistema agora ou entender melhor antes?",
    });
  } catch (e) {
    // nunca quebrar o WhatsAuto
    return json(500, { error: "internal_error" });
  }
};

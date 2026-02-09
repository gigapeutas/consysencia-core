/**
 * WhatsAuto -> ConSySencI.A Core ingest
 * Payload WhatsAuto (pelo seu print):
 * { app, sender, message, group_name, phone }
 * Resposta esperada:
 * { reply: "..." }
 */

const { createClient } = require("@supabase/supabase-js");
const { decide } = require("./_core/brain");

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
    if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });

    const instance_key = getBearer(event.headers || {});
    if (!instance_key) return json(401, { error: "missing_instance_key" });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { error: "missing_supabase_env" });
    }

    let parsed = {};
    try { parsed = JSON.parse(event.body || "{}"); } catch (_) { parsed = {}; }
    const payload = safePayload(parsed);

    if (!payload.message.trim()) return json(200, { reply: "" });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const decision = await decide({
      supabase,
      instance_key,
      payload,
      provider: "whatauto",
    });

    return json(200, { reply: decision.reply || "" });
  } catch (e) {
    return json(500, { error: "internal_error" });
  }
};

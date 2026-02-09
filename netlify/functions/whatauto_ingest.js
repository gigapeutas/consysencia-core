// netlify/functions/whatauto_ingest.js
const { createClient } = require("@supabase/supabase-js");
const { decide } = require("./_core/brain");

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  };
}

function getBearerToken(authHeader) {
  const h = (authHeader || "").trim();
  if (!h.toLowerCase().startsWith("bearer ")) return null;
  return h.slice(7).trim();
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "method_not_allowed" });
    }

    // MULTI-TENANT: instance_key vem do Authorization Bearer
    const instance_key = getBearerToken(event.headers.authorization || event.headers.Authorization);
    if (!instance_key) {
      return json(401, { error: "missing_instance_key" });
    }

    // supabase client (service role)
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { error: "missing_supabase_env" });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // parse payload
    const payload = JSON.parse(event.body || "{}");

    // normalize required fields
    const msg = (payload.message || "").toString().trim();
    if (!msg) {
      return json(200, { reply: "" }); // nada pra responder
    }

    // core decision
    const decision = await decide({
      supabase,
      instance_key,
      payload,
      provider: "whatauto",
    });

    // WhatsAuto exige { reply: "..." }
    return json(200, { reply: decision.reply || "" });
  } catch (e) {
    return json(500, { error: "internal_error" });
  }
};

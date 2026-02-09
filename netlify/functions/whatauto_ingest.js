const { createClient } = require("@supabase/supabase-js");

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
    sender: p.sender || p.from || p.nome || "",
    message: (p.message || p.text || p.mensagem || "").toString(),
    group_name: p.group_name || p.group || p.grupo || "",
    phone: (p.phone || p.number || p.telefone || "").toString(),
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { error: "missing_supabase_env" });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const instance_key = getBearer(event.headers || {});
    const rawBody = event.body || "";

    let parsed = null;
    try { parsed = JSON.parse(rawBody); } catch (_) { parsed = null; }

    const payload = safePayload(parsed);

    // ✅ LOG RAW (pra gente ver o que o WhatsAuto REALMENTE envia)
    await supabase.from("core_events").insert({
      provider: "whatauto",
      instance_key: instance_key || null,
      sender: payload.sender || null,
      phone: payload.phone || null,
      group_name: payload.group_name || null,
      message: payload.message || null,
      decision: {
        debug: true,
        raw_body_preview: rawBody.slice(0, 900),
        headers_preview: {
          authorization: (event.headers?.authorization || event.headers?.Authorization || null),
          content_type: (event.headers?.["content-type"] || event.headers?.["Content-Type"] || null)
        }
      },
      reply_preview: "debug_ingest_ok",
      created_at: new Date().toISOString()
    });

    // ✅ resposta simples (WhatsAuto pede {"reply": "..."} )
    if (!payload.message.trim()) {
      return json(200, { reply: "Recebi seu webhook. Agora ajuste o envio do JSON (message/sender/phone)." });
    }

    // Temporário: responde eco (pra provar payload)
    return json(200, { reply: `OK. Mensagem recebida: "${payload.message}"` });

  } catch (e) {
    return json(500, { error: "internal_error" });
  }
};

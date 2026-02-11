// netlify/functions/whatauto_ingest.js
const { createClient } = require("@supabase/supabase-js");
const querystring = require("querystring");

function maskPhone(v) {
  if (!v) return null;
  const s = String(v);
  if (s.length <= 6) return "***";
  return `${s.slice(0, 3)}***${s.slice(-3)}`;
}

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function normalize(bodyObj) {
  // WhatsAuto costuma mandar: app, sender, message, group_name, phone
  const provider = bodyObj.provider || bodyObj.app || "whatsauto";
  const sender = bodyObj.sender ?? null;
  const message = bodyObj.message ?? bodyObj.text ?? bodyObj.msg ?? null;
  const phone = bodyObj.phone ?? bodyObj.from ?? null;
  const group_name = bodyObj.group_name ?? bodyObj.group ?? null;
  const message_id = bodyObj.message_id ?? bodyObj.id ?? null;

  return { provider, sender, message, phone, group_name, message_id };
}

exports.handler = async (event) => {
  // 1) Método
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // 2) Parse do body (JSON OU form-urlencoded)
  const contentType =
    event.headers["content-type"] ||
    event.headers["Content-Type"] ||
    "";

  const rawBody = event.body || "";
  let bodyObj = null;

  if (contentType.includes("application/json")) {
    bodyObj = safeJsonParse(rawBody);
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    bodyObj = querystring.parse(rawBody);
  } else {
    // tentativa automática: JSON primeiro, senão parse de querystring
    bodyObj = safeJsonParse(rawBody) || querystring.parse(rawBody);
  }

  if (!bodyObj || typeof bodyObj !== "object") bodyObj = {};

  // 3) Normalização
  const n = normalize(bodyObj);

  // 4) Resposta dinâmica mínima (sem ser burra)
  // (depois você pluga o decide de verdade)
  let reply = "Recebi sua mensagem ✅";
  const msg = (n.message || "").toLowerCase();

  if (msg.includes("ativar")) reply = "Beleza. Quer ativar como: *novo afiliado* ou *acesso admin*?";
  else if (msg.includes("oi") || msg.includes("olá") || msg.includes("ola")) reply = "Opa! Você quer *ativar*, *ver a vitrine* ou *tirar uma dúvida*?";
  else if (msg.includes("novo afiliado")) reply = "Perfeito. Me manda: *NOME* + *DDD/Whats* e eu gero seu acesso.";

  // 5) Persistência no Supabase (não falha o webhook)
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && serviceRole) {
      const supabase = createClient(supabaseUrl, serviceRole, {
        auth: { persistSession: false },
      });

      // Ajuste os nomes das colunas se a sua tabela for diferente
      const insertPayload = {
        provider: n.provider,
        sender: n.sender,
        phone: n.phone || n.sender || null,
        group_name: n.group_name,
        message: n.message,
        raw_body: bodyObj,
        headers: event.headers,
        message_id: n.message_id,
      };

      const { error } = await supabase.from("core_events").insert(insertPayload);

      // se sua tabela NÃO é core_events, troque acima pelo nome real
      if (error) {
        console.log("[ingest] supabase insert error:", error.message);
      }
    } else {
      console.log("[ingest] missing env SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
  } catch (e) {
    console.log("[ingest] persist exception:", e?.message || e);
  }

  // 6) Logs úteis (sem vazar segredos)
  console.log("[ingest] provider:", n.provider, "phone:", maskPhone(n.phone), "sender:", n.sender, "msg:", (n.message || "").slice(0, 80));

  // 7) Resposta pro WhatsAuto
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply }),
  };
};

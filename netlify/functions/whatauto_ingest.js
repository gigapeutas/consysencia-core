// netlify/functions/whatauto_ingest.js
// Requisitos:
// - npm i @supabase/supabase-js
// - Env vars no Netlify:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   (opcional) WEBHOOK_SECRET  -> se quiser bloquear chamadas sem Authorization válida

const { createClient } = require("@supabase/supabase-js");
const querystring = require("querystring");

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return null;
}

function toStringOrNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v);
  return s.length ? s : null;
}

function maskToken(auth) {
  if (!auth) return null;
  const s = String(auth);
  if (s.length <= 12) return "***";
  return `${s.slice(0, 10)}***${s.slice(-4)}`;
}

function detectBodyType(contentType) {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("application/json")) return "json";
  if (ct.includes("application/x-www-form-urlencoded")) return "form";
  if (ct.includes("multipart/form-data")) return "multipart";
  return "unknown";
}

// Normaliza o payload do WhatsAuto/variações
function normalize(bodyObj = {}) {
  const provider = toStringOrNull(pick(bodyObj, ["provider", "app"])) || "whatsauto";

  const sender = toStringOrNull(pick(bodyObj, ["sender", "from_name", "name"]));
  const phone = toStringOrNull(pick(bodyObj, ["phone", "from", "remoteJid", "jid", "wa_id"]));
  const group_name = toStringOrNull(pick(bodyObj, ["group_name", "group", "chat", "chat_name"]));

  const message =
    toStringOrNull(
      pick(bodyObj, ["message", "text", "msg", "body", "content", "caption"])
    ) || null;

  const instance_key = toStringOrNull(pick(bodyObj, ["instance_key", "instance", "session", "device"]));
  const message_id = toStringOrNull(pick(bodyObj, ["message_id", "id", "msg_id", "key", "uuid"]));

  // thread_id/thread_type se existirem
  const thread_id = toStringOrNull(pick(bodyObj, ["thread_id", "conversation_id", "chat_id"]));
  const thread_type = toStringOrNull(pick(bodyObj, ["thread_type", "chat_type"]));

  // Ajuda a detectar duplicidade quando não vem message_id
  const dedupe_key =
    toStringOrNull(
      pick(bodyObj, ["dedupe_key"])
    ) || null;

  return {
    provider,
    instance_key,
    sender,
    phone,
    group_name,
    message,
    message_id,
    thread_id,
    thread_type,
    dedupe_key,
  };
}

// Resposta dinâmica simples (substitui depois pelo decide real)
function decideReply(norm) {
  const msg = (norm.message || "").trim();
  const m = msg.toLowerCase();

  if (!msg) {
    return "Recebi ✅ Pode me enviar uma mensagem (ex.: *oi*, *ativar*, *vitrine*)?";
  }

  if (m.includes("oi") || m.includes("olá") || m.includes("ola")) {
    return "Opa! Você quer *ativar*, *ver a vitrine* ou *tirar uma dúvida*?";
  }

  if (m.includes("ativar")) {
    return "Beleza. Quer ativar como: *novo afiliado* ou *acesso admin*?";
  }

  if (m.includes("novo afiliado")) {
    return "Perfeito. Me manda: *NOME + DDD/Whats* e eu gero seu acesso.";
  }

  if (m.includes("vitrine")) {
    return "Show. Você quer ver a vitrine por *categoria* ou quer que eu recomende o *melhor primeiro*?";
  }

  // fallback sempre dinâmico
  return `Entendi: "${msg}". Você quer *ativar*, *vitrine* ou *suporte*?`;
}

exports.handler = async (event) => {
  // 1) Método
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // 2) Headers e auth
  const headers = event.headers || {};
  const contentType = headers["content-type"] || headers["Content-Type"] || "";
  const bodyType = detectBodyType(contentType);

  const auth = headers.authorization || headers.Authorization || "";
  const hasAuth = !!auth;
  const tokenMask = maskToken(auth);

  // Se você quiser OBRIGAR Authorization, setar WEBHOOK_SECRET no Netlify:
  // - WEBHOOK_SECRET="cs_admin_...."  (ou só o token)
  // A validação abaixo aceita "Bearer <token>" ou "<token>".
  const required = process.env.WEBHOOK_SECRET;
  if (required) {
    const clean = String(auth).replace(/^Bearer\s+/i, "").trim();
    const ok = clean === String(required).trim();
    if (!ok) {
      // Importante: você pode retornar 200 para não quebrar provedor, mas sem processar
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ reply: "OK" }),
      };
    }
  }

  // 3) Parse do body (JSON e form)
  const rawBody = event.body || "";
  let bodyObj = null;

  if (bodyType === "json") {
    bodyObj = safeJsonParse(rawBody);
  } else if (bodyType === "form") {
    bodyObj = querystring.parse(rawBody);
  } else {
    // tentativa automática
    bodyObj = safeJsonParse(rawBody) || querystring.parse(rawBody);
  }

  if (!bodyObj || typeof bodyObj !== "object") bodyObj = {};

  // 4) Normalização (o que “entendemos”)
  const norm = normalize(bodyObj);

  // 5) Resposta dinâmica
  const reply = decideReply(norm);

  // 6) Persistência no Supabase (SEM “chaves erradas”)
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRole) {
      console.log("[ingest] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    } else {
      const supabase = createClient(supabaseUrl, serviceRole, {
        auth: { persistSession: false },
      });

      // Monta payloads conforme tua tabela (print das colunas)
      const payloadNorm = {
        ...norm,
        // carimbo opcional (se você mandar test_id no Hoppscotch)
        test_id: bodyObj.test_id || null,
      };

      // dedupe_key: se não vier, cria um simples (provider+phone+message+minute)
      const dedupeKey =
        norm.dedupe_key ||
        norm.message_id ||
        `${norm.provider}|${norm.phone || norm.sender || "unknown"}|${(norm.message || "").slice(
          0,
          40
        )}|${new Date().toISOString().slice(0, 16)}`;

      const insertPayload = {
        // observabilidade
        source: "whatauto_ingest",
        kind: "ingest",
        severity: 0,
        trace: null,

        // núcleos de payload
        payload: null, // (se você quiser, pode espelhar em payload também)
        payload_raw: bodyObj,
        payload_norm: payloadNorm,

        // dedupe / tipo / tempo
        dedupe_key: dedupeKey,
        event_type: "message",
        occurred_at: new Date().toISOString(),
        ingested_at: new Date().toISOString(),

        // identificação / roteamento
        provider: norm.provider,
        instance_key: norm.instance_key,
        affiliate_id: null,

        thread_id: norm.thread_id,
        thread_type: norm.thread_type,
        thread_ref: null,

        // campos “humanos”
        sender: norm.sender,
        phone: norm.phone,
        group_name: norm.group_name,
        message: norm.message,

        // resultado cognitivo (vai usar depois)
        decision: null,
        reply_preview: reply,

        // diagnósticos
        content_type: contentType || null,
        body_type_detected: bodyType,
        raw_body_preview: String(rawBody || "").slice(0, 500),

        schema_keys: Array.isArray(bodyObj)
          ? ["__array_payload__"]
          : Object.keys(bodyObj || {}),

        canonical: null,
        extracted_fields: null,

        parse_error: null,
        has_auth: hasAuth,
        token_mask: tokenMask,
        token_hash: null,

        body_length: rawBody ? String(rawBody).length : 0,
        is_base64encoded: !!event.isBase64Encoded,
        decode_error: null,

        headers_preview: headers,
        query_preview: event.queryStringParameters || null,
      };

      const { error } = await supabase.from("core_events").insert(insertPayload);
      if (error) {
        console.log("[ingest] supabase insert error:", error.message);
      }
    }
  } catch (e) {
    console.log("[ingest] persist exception:", e?.message || e);
  }

  // 7) Resposta pro provedor
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ reply }),
  };
};

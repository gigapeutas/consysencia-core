// netlify/functions/whatauto_ingest.js

const crypto = require("crypto");

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function getBearerToken(headers = {}) {
  const auth = headers.authorization || headers.Authorization || "";
  if (!auth) return "";
  // Aceita: "Bearer TOKEN" (case-insensitive)
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return (m ? m[1] : auth).trim(); // se vier sem Bearer, aceita também
}

exports.handler = async (event) => {
  // Resposta neutra SEMPRE (não incentiva retry agressivo, não vaza estado)
  const neutralOk = {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply: "" }),
  };

  // 1) Só POST
  if (event.httpMethod !== "POST") return neutralOk;

  // 2) Autenticação por token (encapsulado)
  const expectedToken = (process.env.WHATAUTO_INGEST_TOKEN || "").trim();
  const gotToken = getBearerToken(event.headers);

  if (!expectedToken || gotToken !== expectedToken) {
    // Não revela erro; apenas ignora silenciosamente.
    console.log("[whatauto_ingest] auth_failed");
    return neutralOk;
  }

  // 3) Parse do payload
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    console.log("[whatauto_ingest] bad_json");
    return neutralOk;
  }

  const app = String(body.app || "WhatsAuto");
  const sender = String(body.sender || "");
  const message = String(body.message || "");
  const groupName = String(body.group_name || "");
  const phone = String(body.phone || "");

  // 4) Dedupe key (idempotência)
  // Observação: o WhatsAuto não envia message_id no payload do seu print,
  // então usamos um hash do conteúdo/contexto.
  const dedupeKey = "whatauto:" + sha256Hex([app, phone, groupName, sender, message].join("|"));

  // 5) Hash irreversível do ator (não salva phone puro)
  const actorHash = phone ? sha256Hex("phone:" + phone) : sha256Hex("sender:" + sender);

  // 6) Monta payload “legível” (tudo dentro de payload jsonb)
  const nowIso = new Date().toISOString();

  const payload = {
    ts: nowIso,
    app,
    sender,
    message,
    group_name: groupName || null,
    phone_last4: phone ? phone.slice(-4) : null,
    actor_hash: actorHash,
    // Guarda o bruto SEM o phone completo (privacidade)
    raw: {
      app,
      sender,
      message,
      group_name: groupName || null,
      // phone omitido propositalmente
    },
  };

  // 7) Row compatível com o schema real da sua tabela core_events
  const row = {
    source: "whatauto",
    kind: groupName ? "message_in_group" : "message_in_dm",
    severity: 1,
    trace: "whatauto_ingest_v1",
    payload,
    dedupe_key: dedupeKey,
  };

  // 8) Envia para Supabase REST (service role)
  const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
  const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

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

    // Não vaza detalhes sensíveis, mas loga status pra diagnóstico.
    // 201/204 = ok; 409 = dedupe; 4xx/5xx = problema.
    console.log("[whatauto_ingest] insert_status", resp.status);

    return neutralOk;
  } catch (e) {
    console.log("[whatauto_ingest] insert_exception");
    return neutralOk;
  }
};

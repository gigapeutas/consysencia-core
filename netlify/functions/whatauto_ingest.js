// netlify/functions/whatauto_ingest.js

const crypto = require("crypto");

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

exports.handler = async (event) => {
  // 1) Só POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: "" }),
    };
  }

  // 2) Auth por token (não vaza motor)
  const expectedToken = process.env.WHATAUTO_INGEST_TOKEN || "";
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const gotToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  // Resposta neutra sempre (pra não incentivar retry agressivo / nem expor nada)
  const neutralOk = {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply: "" }),
  };

  if (!expectedToken || gotToken !== expectedToken) {
    // Não revela erro para o WhatsAuto, só ignora.
    return neutralOk;
  }

  // 3) Parse payload do WhatsAuto
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return neutralOk;
  }

  const app = String(body.app || "WhatsAuto");
  const sender = String(body.sender || "");
  const message = String(body.message || "");
  const groupName = String(body.group_name || "");
  const phone = String(body.phone || "");

  // 4) Normalização mínima (sem interpretar)
  const occurredAt = new Date().toISOString();

  // 5) Dedupe key determinística (idempotência)
  // Como o WhatsAuto não manda message_id no payload do print, usamos um hash estável do conteúdo + contexto.
  // (Se no futuro você tiver message_id real, trocamos por ele.)
  const dedupeKey = "whatauto:" + sha256Hex([app, phone, groupName, sender, message].join("|"));

  // 6) Hash irreversível do ator (não salva phone puro)
  const actorHash = phone ? sha256Hex("phone:" + phone) : sha256Hex("anon:" + sender);

  // 7) Monta evento para core_events (ledger)
  const row = {
    source: "whatauto",
    event_type: groupName ? "message_in_group" : "message_in_dm",
    occurred_at: occurredAt,
    ingested_at: occurredAt,
    actor_hash: actorHash,
    dedupe_key: dedupeKey,
    payload_raw: body, // bruto
    payload_norm: {
      app,
      sender,
      message,
      group_name: groupName,
      // phone não vai aqui (preserva privacidade). Se quiser, guarde só os 4 últimos:
      phone_last4: phone ? phone.slice(-4) : null,
    },
  };

  // 8) Insert server-side no Supabase com service role
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
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

    // Se for duplicado (unique dedupe_key), Supabase tende a retornar erro 409.
    // Mesmo assim, devolvemos neutralOk para o WhatsAuto.
    return neutralOk;
  } catch (e) {
    return neutralOk;
  }
};

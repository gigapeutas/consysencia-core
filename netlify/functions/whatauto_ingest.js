// netlify/functions/whatauto_ingest.js
// Aceita JSON e também body estilo WhatsAuto (form / kv)
// Persiste no Supabase em public.core_events
// Sempre responde: { reply: "..." }

const crypto = require("crypto");
const { URLSearchParams } = require("url");

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// tenta converter: "{a=b, c=d}" -> {a:"b", c:"d"}
function parseWhatsAutoKvBlock(raw) {
  if (!raw) return null;
  const s = raw.trim();

  // Se já é JSON
  const j = safeJsonParse(s);
  if (j && typeof j === "object") return j;

  // Remove chaves externas
  const noBraces = s.replace(/^\{/, "").replace(/\}$/, "").trim();
  if (!noBraces) return null;

  // Se é "a=b, c=d"
  const obj = {};
  const parts = noBraces.split(",").map(p => p.trim()).filter(Boolean);
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    obj[k] = v;
  }
  return Object.keys(obj).length ? obj : null;
}

function parseBody(event) {
  const ct = (event.headers["content-type"] || event.headers["Content-Type"] || "").toLowerCase();
  let raw = event.body || "";

  if (event.isBase64Encoded) {
    raw = Buffer.from(raw, "base64").toString("utf8");
  }

  // 1) JSON
  if (ct.includes("application/json")) {
    const j = safeJsonParse(raw);
    if (j && typeof j === "object") return { data: j, raw };
  }

  // 2) x-www-form-urlencoded
  if (ct.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(raw);
    const obj = {};
    for (const [k, v] of params.entries()) obj[k] = v;
    if (Object.keys(obj).length) return { data: obj, raw };
  }

  // 3) WhatsAuto “kv block” no debug
  const kv = parseWhatsAutoKvBlock(raw);
  if (kv) return { data: kv, raw };

  // 4) tenta como querystring simples
  try {
    const params = new URLSearchParams(raw);
    const obj = {};
    for (const [k, v] of params.entries()) obj[k] = v;
    if (Object.keys(obj).length) return { data: obj, raw };
  } catch {}

  return { data: null, raw };
}

async function supabaseFetch(path, { method = "GET", headers = {}, body } = {}) {
  const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "") + path;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ""}`,
      ...headers,
    },
    body,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { res, text, json };
}

exports.handler = async (event) => {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const expected = `Bearer ${process.env.INGEST_BEARER || "CONSYSENCIA_SECURE_INGEST_V1"}`;

  // auth simples (igual você configurou no WhatsAuto)
  if (auth.trim() !== expected.trim()) {
    return {
      statusCode: 401,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ reply: "Acesso negado." }),
    };
  }

  const { data, raw } = parseBody(event);
  if (!data) {
    console.log("[whatauto_ingest] bad_json");
    return {
      statusCode: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ reply: "Recebi, mas veio em formato inválido. Tente novamente." }),
    };
  }

  // normalização mínima
  const payload = {
    app: data.app || "WhatsAuto",
    sender: data.sender || data.from || "unknown",
    message: data.message || data.text || "",
    group_name: data.group_name || data.group || "",
    phone: data.phone || data.number || "",
    _raw: raw,
  };

  const kind = "whatsauto_ingest";
  const source = "whatauto";

  // dedupe para evitar spam duplicado (gera 409 quando repetir)
  const dedupe_key = sha256(
    `${source}|${payload.phone}|${payload.group_name}|${payload.sender}|${payload.message}`.slice(0, 2000)
  );

  // INSERT em core_events
  const insertBody = JSON.stringify([{
    source,
    kind,
    severity: 0,
    trace: "whatauto_ingest",
    payload,
    dedupe_key,
  }]);

  const ins = await supabaseFetch("/rest/v1/core_events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Prefer: "return=minimal",
    },
    body: insertBody,
  });

  console.log("[whatauto_ingest] insert_status", ins.res.status);

  // tenta gerar resposta via RPC (se existir)
  // RPC esperada: public.fn_whatauto_reply_v1(input jsonb) returns json/jsonb/text
  let reply = "Recebido ✅";

  const rpc = await supabaseFetch("/rest/v1/rpc/fn_whatauto_reply_v1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: payload }),
  });

  if (rpc.res.ok) {
    // se vier string
    if (typeof rpc.json === "string") reply = rpc.json;
    // se vier objeto {reply:""}
    else if (rpc.json && typeof rpc.json === "object") reply = rpc.json.reply || reply;
  }

  // SEMPRE responder JSON com a chave reply (o WhatsAuto espera isso)
  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      reply,
      ok: true,
      insert_status: ins.res.status, // 201 ou 409 etc
    }),
  };
};

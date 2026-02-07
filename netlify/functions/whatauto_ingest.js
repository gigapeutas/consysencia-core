// netlify/functions/whatauto_ingest.js
// ConSySencI.A — WhatsAuto Ingest + Reply (RPC Supabase)
// Node 18+ (Netlify)

const crypto = require("crypto");
const { URLSearchParams } = require("url");

function normPhone(p) {
  if (!p) return "";
  return String(p).replace(/\D/g, "");
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// "{a=b, c=d}" -> {a:"b", c:"d"}
function parseKvBlock(raw) {
  if (!raw) return null;
  const s = raw.trim();

  // if JSON already
  const j = safeJsonParse(s);
  if (j && typeof j === "object") return j;

  const noBraces = s.replace(/^\{/, "").replace(/\}$/, "").trim();
  if (!noBraces) return null;

  const obj = {};
  for (const part of noBraces.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (k) obj[k] = v;
  }
  return Object.keys(obj).length ? obj : null;
}

function parseBody(event) {
  let raw = event.body || "";
  if (event.isBase64Encoded) {
    raw = Buffer.from(raw, "base64").toString("utf8");
  }

  const ct =
    (event.headers["content-type"] ||
      event.headers["Content-Type"] ||
      "").toLowerCase();

  // 1) JSON
  if (ct.includes("application/json")) {
    const j = safeJsonParse(raw);
    if (j && typeof j === "object") return { data: j, raw, mode: "json" };
  }

  // 2) x-www-form-urlencoded
  if (ct.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(raw);
    const obj = {};
    for (const [k, v] of params.entries()) obj[k] = v;
    if (Object.keys(obj).length) return { data: obj, raw, mode: "form" };
  }

  // 3) kv block (WhatsAuto common)
  const kv = parseKvBlock(raw);
  if (kv) return { data: kv, raw, mode: "kv" };

  // 4) try querystring
  try {
    const params = new URLSearchParams(raw);
    const obj = {};
    for (const [k, v] of params.entries()) obj[k] = v;
    if (Object.keys(obj).length) return { data: obj, raw, mode: "qs" };
  } catch {}

  return { data: null, raw, mode: "unknown" };
}

async function supa(path, { method = "GET", headers = {}, body } = {}) {
  const base = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const url = `${base}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      ...headers,
    },
    body,
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, text, json };
}

exports.handler = async (event) => {
  const TRACE =
    (crypto.randomUUID ? crypto.randomUUID() : `t_${Date.now()}_${Math.random().toString(16).slice(2)}`)
      .slice(0, 36);

  const EXPECTED = `Bearer ${process.env.INGEST_BEARER || "CONSYSENCIA_SECURE_INGEST_V1"}`;
  const auth = event.headers.authorization || event.headers.Authorization || "";

  // --- Auth
  if (auth.trim() !== EXPECTED.trim()) {
    return {
      statusCode: 401,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ reply: "Acesso negado." }),
    };
  }

  // --- Env
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ reply: "Config incompleta (env)." }),
    };
  }

  // --- Parse inbound
  const parsed = parseBody(event);
  if (!parsed.data) {
    console.log("[whatauto_ingest] bad_json", { trace: TRACE, mode: parsed.mode, raw: parsed.raw?.slice?.(0, 200) });
    return {
      statusCode: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ reply: "Recebi ✅ (formato inválido, tente de novo)" }),
    };
  }

  const b = parsed.data;

  // Normalize payload
  const payload = {
    app: String(b.app || "WhatsAuto"),
    sender: String(b.sender || b.from || "unknown"),
    message: String(b.message || b.text || ""),
    group_name: String(b.group_name || b.group || ""),
    phone: normPhone(String(b.phone || b.number || "")),
    received_at: new Date().toISOString(),
    trace: TRACE,
    parse_mode: parsed.mode,
  };

  // --- Dedupe key (per-minute bucket)
  const minuteBucket = payload.received_at.slice(0, 16);
  const dedupeBase = [
    "whatauto",
    payload.phone,
    payload.group_name,
    payload.sender,
    payload.message,
    minuteBucket,
  ].join("|");
  const dedupe_key = sha256(dedupeBase);

  // --- Insert core_events
  const row = {
    source: "whatauto",
    kind: "whatauto_in",
    severity: 0,
    trace: TRACE,
    payload,
    dedupe_key,
  };

  const ins = await supa("/rest/v1/core_events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify([row]),
  });

  // 409 = dedupe (ok)
  if (ins.res.status === 409) {
    console.log("[whatauto_ingest] deduped", { trace: TRACE });
  } else if (!ins.res.ok) {
    console.log("[whatauto_ingest] insert_failed", { trace: TRACE, status: ins.res.status, body: ins.text?.slice?.(0, 300) });
    // ainda assim respondemos pro WhatsAuto com fallback pra não travar
    return {
      statusCode: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ reply: "Erro ao registrar ⚠️" }),
    };
  }

  // --- Call reply brain
  const rpc = await supa("/rest/v1/rpc/fn_whatauto_reply_v2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payload }),
  });

  let reply = "Recebi ✅";
  if (rpc.res.ok) {
    // expected: {reply:"..."}
    if (rpc.json && typeof rpc.json === "object" && rpc.json.reply) {
      reply = String(rpc.json.reply);
    }
  } else {
    console.log("[whatauto_ingest] rpc_failed", { trace: TRACE, status: rpc.res.status, body: rpc.text?.slice?.(0, 300) });
  }

  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ reply }),
  };
};

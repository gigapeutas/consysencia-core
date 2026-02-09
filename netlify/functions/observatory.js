// netlify/functions/observatory.js
// ConSySencI.A — Observatory
// GET  => read events (requires Bearer admin token)
// POST => ingest event into Supabase (requires Bearer admin token)
//
// ENV required:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - ADMIN_TOKEN (ou CONSYSENCIA_ADMIN_TOKEN_SECRET)

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ADMIN_TOKEN,
  CONSYSENCIA_ADMIN_TOKEN_SECRET,
} = process.env;

const ADMIN_SECRET = (ADMIN_TOKEN || CONSYSENCIA_ADMIN_TOKEN_SECRET || "").trim();

function json(statusCode, data, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
    body: JSON.stringify(data),
  };
}

function getBearer(event) {
  const h = event.headers || {};
  const raw = h.authorization || h.Authorization || "";
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

function safeParseJSON(str) {
  try {
    return { ok: true, value: JSON.parse(str || "{}") };
  } catch {
    return { ok: false, value: null };
  }
}

async function supabaseFetch(path, { method = "GET", body } = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("missing_supabase_env");
  }

  const url = `${SUPABASE_URL.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      accept: "application/json",
      prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data };
}

exports.handler = async (event) => {
  // CORS (seguro e simples)
  const origin = event.headers?.origin || event.headers?.Origin || "*";
  const cors = {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") return json(204, {}, cors);

  if (!["GET", "POST"].includes(event.httpMethod)) {
    return json(405, { ok: false, error: "method_not_allowed" }, cors);
  }

  // Auth
  const token = getBearer(event);

  if (!ADMIN_SECRET) {
    return json(500, { ok: false, error: "missing_admin_secret_env" }, cors);
  }

  if (!token || token !== ADMIN_SECRET) {
    return json(401, { ok: false, error: "unauthorized" }, cors);
  }

  // ===== GET: list events =====
  if (event.httpMethod === "GET") {
    try {
      const limitRaw = event.queryStringParameters?.limit || "50";
      const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 50, 1), 200);

      // TABELA-ALVO (mude aqui se o nome não for core_events)
      const q = `/rest/v1/core_events?select=*&order=created_at.desc&limit=${limit}`;

      const r = await supabaseFetch(q);
      if (!r.ok) {
        return json(
          r.status,
          { ok: false, error: "supabase_read_failed", details: r.data },
          cors
        );
      }

      return json(
        200,
        {
          ok: true,
          mode: "read",
          count: Array.isArray(r.data) ? r.data.length : 0,
          data: r.data,
        },
        cors
      );
    } catch (e) {
      return json(500, { ok: false, error: "server_error", details: String(e?.message || e) }, cors);
    }
  }

  // ===== POST: ingest event =====
  if (event.httpMethod === "POST") {
    const parsed = safeParseJSON(event.body);
    if (!parsed.ok) return json(400, { ok: false, error: "invalid_json" }, cors);

    const payload = parsed.value || {};

    const row = {
      source: payload.source || "panel",
      event_type: payload.event_type || payload.type || "event",
      affiliate_id: payload.affiliate_id || payload.afiliado || null,
      phone: payload.phone || payload.telefone || null,
      payload: payload,
    };

    try {
      const r = await supabaseFetch(`/rest/v1/core_events`, { method: "POST", body: row });
      if (!r.ok) {
        return json(
          r.status,
          { ok: false, error: "supabase_insert_failed", details: r.data },
          cors
        );
      }
      return json(200, { ok: true, mode: "ingest", inserted: r.data }, cors);
    } catch (e) {
      return json(500, { ok: false, error: "server_error", details: String(e?.message || e) }, cors);
    }
  }

  return json(500, { ok: false, error: "unexpected" }, cors);
};

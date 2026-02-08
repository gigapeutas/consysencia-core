export default async (req) => {
  try {
    if (req.method === "OPTIONS") return json(200, { ok: true }, corsHeaders());
    if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" }, corsHeaders());
    if (!isAuthed(req)) return json(401, { ok: false, error: "unauthorized" }, corsHeaders());

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SRK) return json(500, { ok: false, error: "missing_env" }, corsHeaders());

    let body = {};
    try { body = await req.json(); } catch { body = {}; }

    const alias = cleanAlias(body.alias);
    const kind = String(body.kind || "image").trim();
    const url = String(body.url || "").trim();
    const description = String(body.description || "").trim();
    const is_active = body.is_active === undefined ? true : !!body.is_active;

    let tags = body.tags ?? [];
    if (typeof tags === "string") {
      // aceita "a,b,c"
      tags = tags.split(",").map(s => s.trim()).filter(Boolean);
    }
    if (!Array.isArray(tags)) tags = [];

    if (!alias) return json(400, { ok: false, error: "missing_alias" }, corsHeaders());
    if (!url) return json(400, { ok: false, error: "missing_url" }, corsHeaders());

    const payload = [{
      alias,
      kind,
      url,
      description,
      tags,
      is_active
    }];

    const endpoint = `${SUPABASE_URL}/rest/v1/media_assets?on_conflict=alias`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "apikey": SRK,
        "Authorization": `Bearer ${SRK}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    if (!res.ok) {
      console.log("[media_upsert] supabase_error", res.status, text?.slice?.(0, 500));
      return json(500, { ok: false, error: "supabase_error", status: res.status, details: safeText(text) }, corsHeaders());
    }

    let rows = [];
    try { rows = JSON.parse(text); } catch { rows = []; }

    return json(200, { ok: true, item: rows?.[0] || null }, corsHeaders());

  } catch (e) {
    console.log("[media_upsert] fatal", String(e?.message || e));
    return json(500, { ok: false, error: "fatal", details: String(e?.message || e) }, corsHeaders());
  }
};

function cleanAlias(v) {
  const s = String(v || "").trim().toLowerCase();
  // alias amigável p/ usar como comando: sem espaço, sem acento, só a-z0-9_-.
  const norm = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const out = norm.replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
  return out.slice(0, 64);
}

function isAuthed(req) {
  const token = (process.env.ADMIN_TOKEN || "").trim();
  if (!token) return false;
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const got = (m?.[1] || "").trim();
  return got && timingSafeEq(got, token);
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
}

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function safeText(t) {
  const s = String(t ?? "");
  return s.length > 1200 ? s.slice(0, 1200) + "…" : s;
}

function timingSafeEq(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
    }

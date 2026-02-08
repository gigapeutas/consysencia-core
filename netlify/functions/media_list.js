export default async (req) => {
  try {
    if (req.method === "OPTIONS") return json(200, { ok: true }, corsHeaders());
    if (req.method !== "GET") return json(405, { ok: false, error: "method_not_allowed" }, corsHeaders());
    if (!isAuthed(req)) return json(401, { ok: false, error: "unauthorized" }, corsHeaders());

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SRK) return json(500, { ok: false, error: "missing_env" }, corsHeaders());

    const url = new URL(req.url);
    const limit = clampInt(url.searchParams.get("limit"), 1, 500, 200);
    const offset = clampInt(url.searchParams.get("offset"), 0, 1_000_000, 0);

    const kind = (url.searchParams.get("kind") || "").trim();       // image|link|file
    const q = (url.searchParams.get("q") || "").trim();             // busca em alias/desc/url
    const onlyActive = (url.searchParams.get("active") || "1") !== "0";

    const qs = new URLSearchParams();
    qs.set("select", "alias,kind,url,description,tags,is_active,created_at,updated_at");
    qs.set("order", "updated_at.desc");
    qs.set("limit", String(limit));
    qs.set("offset", String(offset));

    if (onlyActive) qs.set("is_active", "eq.true");
    if (kind) qs.set("kind", `eq.${escapeFilter(kind)}`);

    const endpoint = `${SUPABASE_URL}/rest/v1/media_assets?${qs.toString()}`;

    const res = await fetch(endpoint, {
      headers: {
        "apikey": SRK,
        "Authorization": `Bearer ${SRK}`,
        "Content-Type": "application/json",
      },
    });

    const text = await res.text();
    if (!res.ok) {
      console.log("[media_list] supabase_error", res.status, text?.slice?.(0, 500));
      return json(500, { ok: false, error: "supabase_error", status: res.status, details: safeText(text) }, corsHeaders());
    }

    let items = [];
    try { items = JSON.parse(text); } catch { items = []; }

    if (q) {
      const needle = q.toLowerCase();
      items = items.filter((it) => {
        const a = String(it.alias || "").toLowerCase();
        const u = String(it.url || "").toLowerCase();
        const d = String(it.description || "").toLowerCase();
        return a.includes(needle) || u.includes(needle) || d.includes(needle);
      });
    }

    return json(200, { ok: true, items, meta: { limit, offset, returned: items.length } }, corsHeaders());

  } catch (e) {
    console.log("[media_list] fatal", String(e?.message || e));
    return json(500, { ok: false, error: "fatal", details: String(e?.message || e) }, corsHeaders());
  }
};

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

function clampInt(v, min, max, def) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function escapeFilter(s) {
  return String(s).replace(/,/g, "%2C");
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

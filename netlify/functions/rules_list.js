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
    const q = (url.searchParams.get("q") || "").trim().toLowerCase(); // busca
    const onlyActive = (url.searchParams.get("active") || "1") !== "0";

    const qs = new URLSearchParams();
    qs.set("select", "id,is_active,priority,source,match_kind,match_text,match_group,match_sender,reply_text,created_at,updated_at");
    qs.set("order", "priority.asc");
    qs.set("limit", String(limit));
    qs.set("offset", String(offset));
    if (onlyActive) qs.set("is_active", "eq.true");

    const endpoint = `${SUPABASE_URL}/rest/v1/reply_rules?${qs.toString()}`;

    const res = await fetch(endpoint, {
      headers: {
        apikey: SRK,
        Authorization: `Bearer ${SRK}`,
        "Content-Type": "application/json",
      },
    });

    const text = await res.text();
    if (!res.ok) return json(500, { ok: false, error: "supabase_error", status: res.status, details: safeText(text) }, corsHeaders());

    let items = [];
    try { items = JSON.parse(text) || []; } catch { items = []; }

    if (q) {
      items = items.filter((it) => {
        const a = String(it.match_text || "").toLowerCase();
        const r = String(it.reply_text || "").toLowerCase();
        const s = String(it.match_sender || "").toLowerCase();
        const g = String(it.match_group || "").toLowerCase();
        const mk = String(it.match_kind || "").toLowerCase();
        return a.includes(q) || r.includes(q) || s.includes(q) || g.includes(q) || mk.includes(q);
      });
    }

    return json(200, { ok: true, items, meta: { limit, offset, returned: items.length } }, corsHeaders());
  } catch (e) {
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
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}
function clampInt(v, min, max, def) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
function safeText(t) { t = String(t ?? ""); return t.length > 1200 ? t.slice(0, 1200) + "…" : t; }
function timingSafeEq(a, b) {
  a = String(a ?? ""); b = String(b ?? "");
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
  }

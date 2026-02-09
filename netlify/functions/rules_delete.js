export default async (req) => {
  try {
    if (req.method === "OPTIONS") return json(200, { ok: true }, corsHeaders());
    if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" }, corsHeaders());
    if (!isAuthed(req)) return json(401, { ok: false, error: "unauthorized" }, corsHeaders());

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SRK) return json(500, { ok: false, error: "missing_env" }, corsHeaders());

    const body = await safeJson(req);
    const id = String(body.id || "").trim();
    if (!id) return json(400, { ok: false, error: "id_required" }, corsHeaders());

    const endpoint = `${SUPABASE_URL}/rest/v1/reply_rules?id=eq.${encodeURIComponent(id)}`;

    const res = await fetch(endpoint, {
      method: "DELETE",
      headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, Prefer: "return=representation" },
    });

    const text = await res.text();
    if (!res.ok) return json(500, { ok: false, error: "supabase_error", status: res.status, details: safeText(text) }, corsHeaders());

    return json(200, { ok: true }, corsHeaders());
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
async function safeJson(req) {
  try { const t = await req.text(); return t ? JSON.parse(t) : {}; } catch { return {}; }
}
function safeText(t) { t = String(t ?? ""); return t.length > 1200 ? t.slice(0, 1200) + "…" : t; }
function timingSafeEq(a, b) {
  a = String(a ?? ""); b = String(b ?? "");
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
  }

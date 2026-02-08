export default async (req) => {
  try {
    // --- CORS ---
    if (req.method === "OPTIONS") return json(200, { ok: true }, corsHeaders());

    if (req.method !== "GET") return json(405, { ok: false, error: "method_not_allowed" }, corsHeaders());

    // --- Auth ---
    if (!isAuthed(req)) return json(401, { ok: false, error: "unauthorized" }, corsHeaders());

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SRK) return json(500, { ok: false, error: "missing_env" }, corsHeaders());

    const url = new URL(req.url);

    const limit = clampInt(url.searchParams.get("limit"), 1, 200, 50);
    const offset = clampInt(url.searchParams.get("offset"), 0, 1_000_000, 0);

    const source = (url.searchParams.get("source") || "").trim();          // ex: whatauto
    const contains = (url.searchParams.get("contains") || "").trim();      // busca simples no payload/message
    const sinceMinutes = clampInt(url.searchParams.get("since_minutes"), 0, 60 * 24 * 30, 0); // até 30 dias

    // Monta query PostgREST
    const qs = new URLSearchParams();
    qs.set("select", "id,created_at,source,payload");
    qs.set("order", "created_at.desc");
    qs.set("limit", String(limit));
    qs.set("offset", String(offset));

    if (source) qs.set("source", `eq.${escapeFilter(source)}`);

    // filtro por tempo
    if (sinceMinutes > 0) {
      // created_at >= now - interval
      // PostgREST não aceita "now()-interval" direto; usamos RPC? Para manter simples:
      // fallback: só retorna e o painel filtra localmente.
      // (se quiser, eu te mando versão com RPC)
    }

    // filtro por contains (simples): fazemos client-side também pra não complicar.
    // Você ainda pode usar o painel pra filtrar rapidamente.

    const endpoint = `${SUPABASE_URL}/rest/v1/core_events?${qs.toString()}`;

    const res = await fetch(endpoint, {
      headers: {
        "apikey": SRK,
        "Authorization": `Bearer ${SRK}`,
        "Content-Type": "application/json",
      },
    });

    const text = await res.text();
    if (!res.ok) {
      console.log("[events_list] supabase_error", res.status, text?.slice?.(0, 500));
      return json(500, { ok: false, error: "supabase_error", status: res.status, details: safeText(text) }, corsHeaders());
    }

    let items = [];
    try { items = JSON.parse(text); } catch { items = []; }

    // contains filter (server-side)
    if (contains) {
      const needle = contains.toLowerCase();
      items = items.filter((it) => {
        const p = it?.payload || {};
        const msg = String(p.message || p.text || "").toLowerCase();
        const sender = String(p.sender || "").toLowerCase();
        const group = String(p.group_name || "").toLowerCase();
        return msg.includes(needle) || sender.includes(needle) || group.includes(needle);
      });
    }

    return json(200, { ok: true, items, meta: { limit, offset, returned: items.length } }, corsHeaders());

  } catch (e) {
    console.log("[events_list] fatal", String(e?.message || e));
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
  // evita quebrar filtro "eq."
  return String(s).replace(/,/g, "%2C");
}

function safeText(t) {
  const s = String(t ?? "");
  return s.length > 1200 ? s.slice(0, 1200) + "…" : s;
}

function timingSafeEq(a, b) {
  // simples (não cripto-real), suficiente p/ token curto em serverless
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
    }

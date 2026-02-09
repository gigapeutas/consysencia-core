export default async (req) => {
  try {
    if (req.method === "OPTIONS") return json(200, { ok: true }, corsHeaders());
    if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" }, corsHeaders());

    const ADMIN_LOGIN = (process.env.ADMIN_LOGIN || "").trim();
    const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "").trim();
    const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || "").trim();

    if (!ADMIN_LOGIN || !ADMIN_PASSWORD || !ADMIN_TOKEN) {
      return json(500, { ok: false, error: "missing_env" }, corsHeaders());
    }

    const body = await safeJson(req);
    const login = String(body?.login || "").trim();
    const senha = String(body?.senha || "").trim();

    const ok =
      timingSafeEq(login.toLowerCase(), ADMIN_LOGIN.toLowerCase()) &&
      timingSafeEq(senha, ADMIN_PASSWORD);

    if (!ok) return json(401, { ok: false, error: "invalid_credentials" }, corsHeaders());

    // token "fixo" do admin (mesmo que suas outras functions validam)
    return json(200, { ok: true, token: ADMIN_TOKEN }, corsHeaders());
  } catch (e) {
    return json(500, { ok: false, error: "fatal", details: String(e?.message || e) }, corsHeaders());
  }
};

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

async function safeJson(req) {
  try {
    const t = await req.text();
    return t ? JSON.parse(t) : {};
  } catch {
    return {};
  }
}

// comparação segura (evita timing attack básico)
function timingSafeEq(a, b) {
  a = String(a ?? "");
  b = String(b ?? "");
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// admin/boot.js — ConSySencI.A Admin Session Core
(function () {
  const LS_TOKEN_KEY = "ADMIN_TOKEN";

  function getToken() {
    return (localStorage.getItem(LS_TOKEN_KEY) || "").trim();
  }

  function redirectToLogin() {
    const here = location.pathname + location.search + location.hash;
    location.href = "/admin/index.html?next=" + encodeURIComponent(here);
  }

  const token = getToken();
  if (!token) {
    redirectToLogin();
    return;
  }

  async function parseJSONSafe(res) {
    const text = await res.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }

  window.ADMIN = {
    token,
    logout() {
      localStorage.removeItem(LS_TOKEN_KEY);
      redirectToLogin();
    },
    headers(extra = {}) {
      return {
        ...extra,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      };
    },
    async fetchJSON(url, opts = {}) {
      const res = await fetch(url, {
        ...opts,
        headers: window.ADMIN.headers(opts.headers || {}),
      });
      const data = await parseJSONSafe(res);
      return { res, data };
    },
    // normaliza listas vindas de {data:[]} ou {items:[]} ou [] puro
    normalizeList(payload) {
      if (!payload) return [];
      if (Array.isArray(payload)) return payload;
      if (Array.isArray(payload.data)) return payload.data;
      if (Array.isArray(payload.items)) return payload.items;
      if (payload.ok && Array.isArray(payload.data)) return payload.data;
      return [];
    },
    // util
    pretty(x) {
      try { return JSON.stringify(x, null, 2); } catch { return String(x); }
    }
  };
})();

// admin/boot.js — ConSySencI.A (Admin Session)
// 1) Reaproveita token salvo pelo painel
// 2) Bloqueia acesso a páginas internas se não tiver token
// 3) Fornece fetch com Authorization automático

(function () {
  const LS_TOKEN_KEY = "ADMIN_TOKEN";
  const token = (localStorage.getItem(LS_TOKEN_KEY) || "").trim();

  // Se não tiver token, volta para o painel
  if (!token) {
    const here = location.pathname + location.search + location.hash;
    location.href = "/admin/index.html?next=" + encodeURIComponent(here);
    return;
  }

  // expõe helpers globais
  window.ADMIN = {
    token,
    authHeaders(extra = {}) {
      return {
        ...extra,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      };
    },
    async fetchJSON(url, opts = {}) {
      const res = await fetch(url, {
        ...opts,
        headers: window.ADMIN.authHeaders(opts.headers || {}),
      });
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch { data = text; }
      return { res, data };
    },
  };
})();

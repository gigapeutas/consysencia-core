// netlify/functions/whatauto_ingest.js

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(obj),
  };
}

function truncate(str, n = 500) {
  if (str == null) return "";
  str = String(str);
  return str.length > n ? str.slice(0, n) + "…" : str;
}

function parseTextKV(raw) {
  // aceita:
  // "{a=b, c=d}"  OR  "a=b, c=d"  OR  "a=b&c=d"
  const out = {};
  let s = String(raw || "").trim();

  // remove chaves se existirem
  if (s.startsWith("{") && s.endsWith("}")) s = s.slice(1, -1).trim();

  // se parece querystring, tenta URLSearchParams primeiro
  if (s.includes("&") && s.includes("=")) {
    try {
      const usp = new URLSearchParams(s);
      for (const [k, v] of usp.entries()) out[k.trim()] = v;
      return out;
    } catch (_) {}
  }

  // fallback: split por vírgula e "="
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(v.replace(/\+/g, " "));
  }
  return out;
}

function normalizeFields(obj) {
  const src = obj || {};
  // aliases
  const sender = src.sender ?? src.from ?? src.name ?? "";
  const message = src.message ?? src.text ?? src.body ?? "";
  const phone = src.phone ?? src.number ?? src.msisdn ?? "";
  const group_name = src.group_name ?? src.group ?? src.groupName ?? "";

  const app = src.app ?? src.platform ?? "WhatsAuto";

  return { app, sender, phone, group_name, message };
}

exports.handler = async (event, context) => {
  try {
    // 1) AUTH (se você usa bearer admin token)
    const auth = event.headers?.authorization || event.headers?.Authorization || "";
    // Se quiser validar de verdade, compare com seu token/admin secret via ENV:
    // const expected = process.env.CS_ADMIN_TOKEN;
    // if (!expected || auth !== `Bearer ${expected}`) return json(401, { reply: "UNAUTHORIZED" });

    // 2) detect content-type
    const contentType = (event.headers?.["content-type"] || event.headers?.["Content-Type"] || "").toLowerCase();
    const rawBody = event.body || "";

    let parsed = null;
    let body_type_detected = "unknown";
    const parse_path = [];

    // JSON
    if (contentType.includes("application/json")) {
      parse_path.push("json");
      body_type_detected = "json";
      try {
        parsed = JSON.parse(rawBody);
      } catch (e) {
        return json(200, { reply: "Ajuste o formato do corpo (JSON inválido)." });
      }
    }

    // FORM
    if (!parsed && contentType.includes("application/x-www-form-urlencoded")) {
      parse_path.push("form");
      body_type_detected = "form";
      try {
        const usp = new URLSearchParams(rawBody);
        parsed = Object.fromEntries(usp.entries());
      } catch (e) {
        return json(200, { reply: "Ajuste o formato do corpo (form inválido)." });
      }
    }

    // TEXT/PLAIN (ou default)
    if (!parsed) {
      parse_path.push("text");
      body_type_detected = "text";
      parsed = parseTextKV(rawBody);
    }

    // 3) normalize
    const canonical = normalizeFields(parsed);

    // 4) Reply rules (WhatsAuto precisa de {"reply":"..."} sempre)
    if (!canonical.message || !canonical.sender || !canonical.phone) {
      // Mesmo faltando phone, não pode quebrar e tem que responder JSON
      return json(200, { reply: "Recebi seu webhook. Agora ajuste o envio do JSON (message/sender/phone)." });
    }

    // 5) OK
    return json(200, { reply: "aqui é oq o servidor responde, essa parte tem que ser reservada para pegar a resposta do servidor. certo?" });
  } catch (err) {
    // ERRO “blindado”: nunca deixe estourar HTML/stack pro WhatsAuto
    return json(200, { reply: "Recebi seu webhook, mas ocorreu um erro interno. Tente novamente." });
  }
};

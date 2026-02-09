// netlify/functions/_core/brain.js
// Brain: humano, sem menu, OFFLINE-first, multi-tenant via instance_key.

function safeText(s) { return (s || "").toString().trim(); }
function nowIso() { return new Date().toISOString(); }

function detectThreadType(p) {
  return p.group_name && safeText(p.group_name) ? "group" : "private";
}

function getThreadRef(type, p) {
  return type === "group" ? safeText(p.group_name) : safeText(p.phone);
}

function makeThreadId(type, instance_key, ref) {
  return `${type}:${instance_key}:${ref}`;
}

function classifyIntent({ message, thread_type }) {
  const m = safeText(message).toLowerCase();

  // intents diretos (humanos)
  if (m.includes("preço") || m.includes("preco") || m.includes("valor")) return "pricing";
  if (m.includes("catálogo") || m.includes("catalogo")) return "catalog";
  if (m.includes("suporte") || m.includes("erro") || m.includes("ajuda")) return "support";
  if (m.includes("funciona") || m.includes("como")) return "how_it_works";
  if (m.includes("ativar") || m.includes("ativacao") || m.includes("ativação")) return "activation";
  if (m.includes("comprar") || m.includes("pagar")) return "purchase";
  if (m.includes("robô") || m.includes("robo") || m.includes("bot") || m.includes("humano")) return "identity";

  // em grupo: engajar sem poluir
  if (thread_type === "group") return "group_engage";

  // fallback humano
  return "general";
}

function buildCtx(affiliate, payload) {
  return {
    agent_name: affiliate?.agent_name || "ConSySencI.A",
    sender_name: payload.sender || "",
    product_name: "Nível 1 — Ativação",
    product_price: "R$25",
    site_url: "https://consysencia.com/",
  };
}

function renderFallback({ ctx, intent, thread_type }) {
  if (intent === "pricing") {
    return `O acesso ao *${ctx.product_name}* é *${ctx.product_price}*.\n➡️ ${ctx.site_url}\n\nQuer que eu te guie na ativação agora?`;
  }
  if (intent === "catalog") {
    return `Hoje a entrada oficial é:\n✅ *${ctx.product_name}* — ${ctx.product_price}\n➡️ ${ctx.site_url}\n\nSeu foco é ganhar tempo ou vender mais?`;
  }
  if (intent === "support") {
    return `Me diga em uma frase onde travou.\nSe puder, manda print que eu resolvo contigo.`;
  }
  if (intent === "how_it_works") {
    return `Eu faço divulgação + atendimento no automático e conduzo a conversa até o próximo passo.\n\nInício oficial: *${ctx.product_name}* (${ctx.product_price}).\n➡️ ${ctx.site_url}\n\nVocê quer usar mais em grupos ou no privado?`;
  }
  if (thread_type === "group") {
    return `Se alguém quiser ativar um sistema automático de divulgação/atendimento, começa por *${ctx.product_name}* (${ctx.product_price}).\n➡️ ${ctx.site_url}`;
  }
  return `Entendi.\n\nVocê quer ativar agora ou prefere entender melhor antes?`;
}

function chooseTemplate(rows) {
  if (!rows || rows.length === 0) return null;

  // se existir score/uses/wins, ordena. se não, pega o primeiro
  const sorted = [...rows].sort((a, b) => {
    const sa = Number(a.score || 0), sb = Number(b.score || 0);
    if (sb !== sa) return sb - sa;
    const wa = Number(a.wins || 0), wb = Number(b.wins || 0);
    if (wb !== wa) return wb - wa;
    const ua = Number(a.uses || 0), ub = Number(b.uses || 0);
    return ub - ua;
  });

  // 85% melhor, 15% explorar top3
  const r = Math.random();
  if (r < 0.85 || sorted.length === 1) return sorted[0];
  const top = sorted.slice(0, Math.min(3, sorted.length));
  return top[Math.floor(Math.random() * top.length)];
}

async function decide({ supabase, instance_key, payload, provider = "whatauto" }) {
  const thread_type = detectThreadType(payload);
  const thread_ref = getThreadRef(thread_type, payload);
  const thread_id = makeThreadId(thread_type, instance_key, thread_ref);

  // 1) resolve instância via instance_key (multi-tenant)
  const inst = await supabase
    .from("core_whatsapp_instances")
    .select("affiliate_id, is_active")
    .eq("instance_key", instance_key)
    .maybeSingle();

  if (!inst.data || inst.data.is_active === false) {
    return { ok: false, reply: "Configuração inválida. Contate o suporte.", intent: "error" };
  }

  const affiliateId = inst.data.affiliate_id;

  // 2) carrega afiliado (opcional)
  const aff = await supabase
    .from("core_affiliates")
    .select("id, agent_name, agent_style, is_active")
    .eq("id", affiliateId)
    .maybeSingle();

  const affiliate = aff.data && aff.data.is_active !== false ? aff.data : null;

  const message = safeText(payload.message);
  const intent = classifyIntent({ message, thread_type });
  const style = affiliate?.agent_style || (thread_type === "group" ? "persuasivo_curto" : "persuasivo_humano");
  const ctx = buildCtx(affiliate, payload);

  // 3) tenta template (se existir)
  const tpls = await supabase
    .from("core_templates")
    .select("id, body, variant, score, uses, wins, enabled")
    .eq("enabled", true)
    .eq("intent", intent)
    .eq("style", style)
    .limit(50);

  const chosen = chooseTemplate(tpls.data || []);
  let reply = null;

  if (chosen && chosen.body) {
    reply = chosen.body
      .replaceAll("{{agent_name}}", ctx.agent_name)
      .replaceAll("{{sender_name}}", ctx.sender_name)
      .replaceAll("{{product_name}}", ctx.product_name)
      .replaceAll("{{product_price}}", ctx.product_price)
      .replaceAll("{{site_url}}", ctx.site_url);

    // contabiliza uso (se RPC existir)
    try { await supabase.rpc("fn_template_use", { p_template_id: chosen.id }); } catch (_) {}
  } else {
    reply = renderFallback({ ctx, intent, thread_type });
  }

  // 4) persist (se tabelas tiverem colunas — não quebra se não tiver)
  const preview = (reply || "").slice(0, 240);

  try {
    await supabase.from("core_threads").upsert({
      thread_id,
      instance_key,
      affiliate_id: affiliateId,
      thread_type,
      thread_ref,
      intent,
      style,
      last_in_at: nowIso(),
      last_out_at: nowIso(),
      last_reply_preview: preview,
      last_template_id: chosen?.id || null,
      last_template_variant: chosen?.variant || null
    }, { onConflict: "thread_id" });
  } catch (_) {}

  try {
    await supabase.from("core_events").insert({
      provider,
      instance_key,
      affiliate_id: affiliateId,
      thread_id,
      thread_type,
      thread_ref,
      sender: payload.sender || null,
      phone: payload.phone || null,
      group_name: payload.group_name || null,
      message,
      decision: { intent, style, template_id: chosen?.id || null, variant: chosen?.variant || null },
      reply_preview: preview,
      created_at: nowIso(),
    });
  } catch (_) {}

  return { ok: true, reply, intent, style, thread_id };
}

module.exports = { decide };

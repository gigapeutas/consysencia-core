// netlify/functions/_core/brain.js
// ConSySencI.A Core Brain — OFFLINE-first + learning (score/uses/wins) + menu 1/2/3

function nowIso() {
  return new Date().toISOString();
}
function safeText(s) {
  return (s || "").toString().trim();
}
function detectThreadType(payload) {
  const hasGroup = !!payload.group_name && safeText(payload.group_name).length > 0;
  return hasGroup ? "group" : "private";
}
function pickThreadRef({ thread_type, payload }) {
  if (thread_type === "group") return safeText(payload.group_name); // fallback (sem group_id)
  return safeText(payload.phone);
}
function pickThreadId({ thread_type, instance_key, thread_ref }) {
  if (thread_type === "group") return `group:${instance_key}:${thread_ref}`;
  return `private:${instance_key}:${thread_ref}`;
}

// ✅ INTENT ENGINE (comandos 1/2/3)
function classifyIntent({ message, thread_type }) {
  const raw = safeText(message);
  const m = raw.toLowerCase();

  // menu numérico
  if (raw === "1") return "pricing";
  if (raw === "2") return "catalog";
  if (raw === "3") return "support";

  // palavras do menu
  if (m === "preco" || m === "preço" || m.includes("preco") || m.includes("preço") || m.includes("valor")) return "pricing";
  if (m === "catalogo" || m === "catálogo" || m.includes("catalogo") || m.includes("catálogo")) return "catalog";
  if (m === "suporte" || m.includes("suporte") || m.includes("erro")) return "support";

  // intents principais
  if (m.includes("ativar") || m.includes("ativacao") || m.includes("ativação")) return "activation";
  if (m.includes("link")) return "link_request";
  if (m.includes("grupo")) return "group_access";
  if (m.includes("funciona") || m.includes("como")) return "how_it_works";
  if (m.includes("comprar") || m.includes("pagar")) return "purchase";
  if (m.includes("humano") || m.includes("robô") || m.includes("robo") || m.includes("bot")) return "identity";

  // grupo tem comportamento padrão
  if (thread_type === "group") return "group_engage";

  // fallback: mostrar menu
  return "menu";
}

function decideStyle({ thread_type, affiliate }) {
  if (affiliate?.agent_style) return affiliate.agent_style;
  return thread_type === "group" ? "persuasivo_curto" : "persuasivo_humano";
}
function decideStage({ intent, prior_stage }) {
  if (!prior_stage) return "s0_first_contact";
  if (intent === "purchase") return "s2_close";
  if (intent === "activation") return "s3_activation";
  return prior_stage;
}
function shouldRevealAutomation({ intent, thread_type }) {
  if (intent === "identity") return true;
  if (thread_type === "private" && (intent === "purchase" || intent === "activation")) return true;
  return false;
}
function isWinSignal(message) {
  const m = safeText(message).toUpperCase();
  return m.includes("ATIVADO") || m.includes("COMPREI") || m.includes("PAGUEI") || m.includes("APROVADO") || m.includes("CONFIRMADO");
}
function buildContext({ affiliate, payload, thread_type }) {
  return {
    affiliate_display: affiliate?.display_name || "Operador",
    agent_name: affiliate?.agent_name || "ConSySencI.A",
    product_name: "Nível 1 — Ativação",
    product_price: "R$25",
    site_url: "https://consysencia.com/",
    thread_type,
    sender_name: payload.sender || "",
  };
}

function renderFallback({ ctx, intent, thread_type }) {
  if (intent === "pricing") return `O acesso ao *${ctx.product_name}* custa ${ctx.product_price}.\n➡️ ${ctx.site_url}`;
  if (intent === "catalog") return `📦 Catálogo: *${ctx.product_name}* (${ctx.product_price})\n➡️ ${ctx.site_url}`;
  if (intent === "support") return `Me diga onde travou (ou mande print) que eu resolvo com você.`;
  if (intent === "menu") return `Comandos rápidos:\n1) preço\n2) catálogo\n3) suporte`;

  const baseGroup = `⚡ ${ctx.agent_name} ativo.\nQuer operar no automático?\n*${ctx.product_name}* (${ctx.product_price}).\n➡️ ${ctx.site_url}`;
  const basePrivate = `Eu te explico rápido.\n\n${ctx.agent_name} é um sistema que faz divulgação + atendimento no automático.\nInício oficial: *${ctx.product_name}* (${ctx.product_price}).\n➡️ ${ctx.site_url}`;

  return thread_type === "group" ? baseGroup : basePrivate;
}

// seleção exploit/explore
function chooseTemplateRow(rows) {
  if (!rows || rows.length === 0) return null;

  const sorted = [...rows].sort((a, b) => {
    const sa = Number(a.score || 0);
    const sb = Number(b.score || 0);
    if (sb !== sa) return sb - sa;
    const wa = Number(a.wins || 0);
    const wb = Number(b.wins || 0);
    if (wb !== wa) return wb - wa;
    const ua = Number(a.uses || 0);
    const ub = Number(b.uses || 0);
    return ub - ua;
  });

  const r = Math.random();
  if (r < 0.8 || sorted.length === 1) return sorted[0];

  const topK = sorted.slice(0, Math.min(3, sorted.length));
  return topK[Math.floor(Math.random() * topK.length)];
}

async function decide({ supabase, instance_key, payload, provider = "whatauto" }) {
  const thread_type = detectThreadType(payload);
  const thread_ref = pickThreadRef({ thread_type, payload });
  const thread_id = pickThreadId({ thread_type, instance_key, thread_ref });

  // resolve instância
  const inst = await supabase
    .from("core_whatsapp_instances")
    .select("id, instance_id, instance_key, affiliate_id, is_active")
    .eq("instance_key", instance_key)
    .maybeSingle();

  if (inst.error || !inst.data || inst.data.is_active === false) {
    return {
      ok: false,
      reply: "Configuração inválida. Contate o suporte.",
      intent: "error",
      style: "safe",
      stage: "s_err_no_instance",
      mode: "offline",
      template_id: null,
      affiliate_id: null,
      thread_id,
      meta: { provider, at: nowIso(), err: "instance_not_found" },
    };
  }

  const affiliateId = inst.data.affiliate_id;

  const aff = await supabase
    .from("core_affiliates")
    .select("id, display_name, agent_name, agent_style, is_active")
    .eq("id", affiliateId)
    .maybeSingle();

  const affiliate = aff.data && aff.data.is_active !== false ? aff.data : null;

  const prior = await supabase
    .from("core_threads")
    .select("thread_id, stage, last_template_id, last_out_at")
    .eq("thread_id", thread_id)
    .maybeSingle();

  const message = safeText(payload.message);
  const intent = classifyIntent({ message, thread_type });
  const style = decideStyle({ thread_type, affiliate });
  const stage = decideStage({ intent, prior_stage: prior.data?.stage });

  // learning: engage (+1) se respondeu após nosso último envio (<=6h)
  const lastTemplateId = prior.data?.last_template_id || null;
  const lastOutAt = prior.data?.last_out_at ? new Date(prior.data.last_out_at).getTime() : null;
  const within6h = lastOutAt && (Date.now() - lastOutAt) <= (6 * 60 * 60 * 1000);
  if (lastTemplateId && within6h) {
    await supabase.rpc("fn_template_engage", { p_template_id: lastTemplateId, p_delta: 1 });
  }

  // learning: win (+10, wins+1) por sinal
  if (lastTemplateId && isWinSignal(message)) {
    await supabase.rpc("fn_template_win", { p_template_id: lastTemplateId, p_delta: 10 });
  }

  // buscar templates compatíveis
  const tplRes = await supabase
    .from("core_templates")
    .select("id, body, variant, score, uses, wins")
    .eq("enabled", true)
    .eq("intent", intent)
    .eq("style", style)
    .limit(50);

  const ctx = buildContext({ affiliate, payload, thread_type });

  let reply = null;
  let template_id = null;
  let template_variant = null;
  let mode = "offline";

  const chosen = chooseTemplateRow(tplRes.data || []);
  if (chosen && chosen.body) {
    template_id = chosen.id;
    template_variant = chosen.variant || null;

    await supabase.rpc("fn_template_use", { p_template_id: template_id });

    reply = chosen.body
      .replaceAll("{{agent_name}}", ctx.agent_name)
      .replaceAll("{{product_name}}", ctx.product_name)
      .replaceAll("{{product_price}}", ctx.product_price)
      .replaceAll("{{site_url}}", ctx.site_url)
      .replaceAll("{{sender_name}}", ctx.sender_name);
  } else {
    reply = renderFallback({ ctx, intent, thread_type });
  }

  if (shouldRevealAutomation({ intent, thread_type }) && thread_type === "private") {
    reply += `\n\n(Transparência: eu sou uma automação operando o atendimento. Você também pode ativar isso com o ${ctx.product_name}.)`;
  }

  const reply_preview = (reply || "").slice(0, 280);

  await supabase
    .from("core_threads")
    .upsert({
      thread_id,
      instance_key,
      affiliate_id: affiliateId,
      thread_type,
      thread_ref,
      stage,
      intent,
      style,
      last_in_at: nowIso(),
      last_out_at: nowIso(),
      last_template_id: template_id,
      last_template_variant: template_variant,
      last_reply_preview: reply_preview,
    }, { onConflict: "thread_id" });

  await supabase
    .from("core_events")
    .insert({
      provider,
      instance_key,
      affiliate_id: affiliateId,
      thread_id,
      thread_type,
      thread_ref,
      sender: payload.sender || null,
      phone: payload.phone || null,
      group_name: payload.group_name || null,
      message: message || null,
      decision: { intent, style, stage, mode, template_id, variant: template_variant, scored_pick: true },
      reply_preview,
      created_at: nowIso(),
    });

  return { ok: true, reply, intent, style, stage, mode, template_id, variant: template_variant, affiliate_id: affiliateId, thread_id };
}

module.exports = { decide };

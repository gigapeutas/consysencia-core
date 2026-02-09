// netlify/functions/_core/brain.js
// ConSySencI.A Core Brain — OFFLINE-first with AI slot

function nowIso() {
  return new Date().toISOString();
}

function pickThreadId({ thread_type, instance_key, thread_ref }) {
  // canonical deterministic
  if (thread_type === "group") return `group:${instance_key}:${thread_ref}`;
  return `private:${instance_key}:${thread_ref}`;
}

function safeText(s) {
  return (s || "").toString().trim();
}

function detectThreadType(payload) {
  // WhatsAuto: group_name may exist for group messages
  const hasGroup = !!payload.group_name && safeText(payload.group_name).length > 0;
  return hasGroup ? "group" : "private";
}

function classifyIntent({ message, thread_type }) {
  const m = safeText(message).toLowerCase();

  // hard intents
  if (m.includes("ativar") || m.includes("ativacao") || m.includes("ativação")) return "activation";
  if (m.includes("preço") || m.includes("preco") || m.includes("valor")) return "pricing";
  if (m.includes("link")) return "link_request";
  if (m.includes("suporte") || m.includes("erro")) return "support";
  if (m.includes("grupo")) return "group_access";
  if (m.includes("funciona") || m.includes("como")) return "how_it_works";
  if (m.includes("comprar") || m.includes("pagar")) return "purchase";
  if (m.includes("humano") || m.includes("robô") || m.includes("robo") || m.includes("bot")) return "identity";
  if (thread_type === "group") return "group_engage";

  // fallback
  return "general";
}

function decideStyle({ thread_type }) {
  // default: persuasivo humano vendedor
  // em grupo: mais curto e chamativo
  return thread_type === "group" ? "persuasivo_curto" : "persuasivo_humano";
}

function decideStage({ intent, prior_stage }) {
  if (!prior_stage) return "s0_first_contact";
  if (intent === "purchase") return "s2_close";
  if (intent === "activation") return "s3_activation";
  return prior_stage;
}

function shouldRevealAutomation({ intent, stage }) {
  // reveal only after value / CTA, never if asked "are you human?" -> answer honestly
  if (intent === "identity") return true;
  if (stage === "s2_close") return true;
  return false;
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
  const base =
    thread_type === "group"
      ? `⚡ ${ctx.agent_name} ativa no automático.\nQuer operar também? Acesso ao *${ctx.product_name}* por ${ctx.product_price}.\n➡️ ${ctx.site_url}`
      : `Eu te explico rapidinho.\n\n${ctx.agent_name} é um sistema que faz vendas e anúncios no automático.\nA forma mais rápida de começar é o *${ctx.product_name}* (${ctx.product_price}).\n\n➡️ ${ctx.site_url}`;

  // small variations by intent
  if (intent === "pricing") return `O acesso ao *${ctx.product_name}* custa ${ctx.product_price}.\n➡️ ${ctx.site_url}`;
  if (intent === "how_it_works") return `${ctx.agent_name} opera assim: anuncia, responde, conduz e ativa.\nComeça pelo *${ctx.product_name}* (${ctx.product_price}).\n➡️ ${ctx.site_url}`;
  return base;
}

async function decide({
  supabase,
  instance_key,
  payload,
  provider = "whatauto",
}) {
  const thread_type = detectThreadType(payload);

  // thread_ref: private -> phone ; group -> group_name (fallback, until we get real group_id)
  const thread_ref = thread_type === "group" ? safeText(payload.group_name) : safeText(payload.phone);
  const thread_id = pickThreadId({ thread_type, instance_key, thread_ref });

  // resolve tenant by instance_key
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

  // load prior stage from core_threads
  const prior = await supabase
    .from("core_threads")
    .select("thread_id, stage, intent, last_seen_at")
    .eq("thread_id", thread_id)
    .maybeSingle();

  const message = safeText(payload.message);
  const intent = classifyIntent({ message, thread_type });
  const style = affiliate?.agent_style || decideStyle({ thread_type });
  const stage = decideStage({ intent, prior_stage: prior.data?.stage });

  // try template match (OFFLINE)
  const tpl = await supabase
    .from("core_templates")
    .select("id, body, intent, style, stage, is_active")
    .eq("is_active", true)
    .eq("intent", intent)
    .eq("style", style)
    .limit(1);

  const ctx = buildContext({ affiliate, payload, thread_type });

  let reply = null;
  let template_id = null;
  let mode = "offline";

  if (!tpl.error && tpl.data && tpl.data.length > 0 && tpl.data[0]?.body) {
    template_id = tpl.data[0].id;
    reply = tpl.data[0].body
      .replaceAll("{{agent_name}}", ctx.agent_name)
      .replaceAll("{{product_name}}", ctx.product_name)
      .replaceAll("{{product_price}}", ctx.product_price)
      .replaceAll("{{site_url}}", ctx.site_url)
      .replaceAll("{{sender_name}}", ctx.sender_name);
  } else {
    reply = renderFallback({ ctx, intent, thread_type });
  }

  // reveal automation only when appropriate
  if (shouldRevealAutomation({ intent, stage }) && thread_type === "private") {
    reply += `\n\n(Transparência: eu sou uma automação operando o atendimento. Você também pode ativar isso com o ${ctx.product_name}.)`;
  }

  // persist core_threads (upsert)
  await supabase
    .from("core_threads")
    .upsert({
      thread_id,
      provider,
      instance_key,
      affiliate_id: affiliateId,
      thread_type,
      thread_ref,
      stage,
      intent,
      style,
      updated_at: nowIso(),
      last_seen_at: nowIso(),
    }, { onConflict: "thread_id" });

  // persist core_events
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
      decision: {
        intent,
        style,
        stage,
        mode,
        template_id,
      },
      reply_preview: reply.slice(0, 280),
      created_at: nowIso(),
    });

  return {
    ok: true,
    reply,
    intent,
    style,
    stage,
    mode,
    template_id,
    affiliate_id: affiliateId,
    thread_id,
    meta: { provider, at: nowIso() },
  };
}

module.exports = { decide };
  

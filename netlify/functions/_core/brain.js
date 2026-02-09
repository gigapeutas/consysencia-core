// netlify/functions/_core/brain.js
// ConSySencI.A Core Brain — OFFLINE-first + learning (score/uses/wins)

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
  // WhatsAuto não fornece group_id no body; usar group_name como fallback
  if (thread_type === "group") return safeText(payload.group_name);
  return safeText(payload.phone);
}

function pickThreadId({ thread_type, instance_key, thread_ref }) {
  if (thread_type === "group") return `group:${instance_key}:${thread_ref}`;
  return `private:${instance_key}:${thread_ref}`;
}

function classifyIntent({ message, thread_type }) {
  const m = safeText(message).toLowerCase();

  // hard keywords
  if (m.includes("ativar") || m.includes("ativacao") || m.includes("ativação")) return "activation";
  if (m.includes("preço") || m.includes("preco") || m.includes("valor")) return "pricing";
  if (m.includes("link")) return "link_request";
  if (m.includes("suporte") || m.includes("erro")) return "support";
  if (m.includes("grupo")) return "group_access";
  if (m.includes("funciona") || m.includes("como")) return "how_it_works";
  if (m.includes("comprar") || m.includes("pagar")) return "purchase";
  if (m.includes("humano") || m.includes("robô") || m.includes("robo") || m.includes("bot")) return "identity";

  if (thread_type === "group") return "group_engage";
  return "general";
}

function decideStyle({ thread_type, affiliate }) {
  // padrão persuasivo (vendedor), mas curto em grupo
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
  // Transparência: se perguntarem, responde.
  if (intent === "identity") return true;
  // Só revela no privado, nunca em grupo
  if (thread_type === "private" && (intent === "purchase" || intent === "activation")) return true;
  return false;
}

function isWinSignal(message) {
  const m = safeText(message).toUpperCase();
  // win heurístico: confirmação de compra/ativação (até integrar pagamento real)
  return (
    m.includes("ATIVADO") ||
    m.includes("COMPREI") ||
    m.includes("PAGUEI") ||
    m.includes("APROVADO") ||
    m.includes("CONFIRMADO")
  );
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
  const baseGroup =
    `⚡ ${ctx.agent_name} ativo.\nQuer operar no automático?\n*${ctx.product_name}* (${ctx.product_price}).\n➡️ ${ctx.site_url}`;

  const basePrivate =
    `Eu te explico rápido.\n\n${ctx.agent_name} é um sistema que faz divulgação + atendimento no automático.\nO início oficial é o *${ctx.product_name}* (${ctx.product_price}).\n\n➡️ ${ctx.site_url}`;

  if (intent === "pricing") return `O acesso ao *${ctx.product_name}* custa ${ctx.product_price}.\n➡️ ${ctx.site_url}`;
  if (intent === "how_it_works") return `${ctx.agent_name} opera assim: anuncia, responde e conduz.\nComeça pelo *${ctx.product_name}* (${ctx.product_price}).\n➡️ ${ctx.site_url}`;
  if (intent === "activation") return `Ative em: ${ctx.site_url}\nDepois me diga “ATIVADO”.`;

  return thread_type === "group" ? baseGroup : basePrivate;
}

/**
 * Seleção inteligente:
 * - Exploit: pega o melhor score (top 1) na maior parte do tempo
 * - Explore: às vezes escolhe aleatoriamente entre os top 3 (para A/B)
 */
function chooseTemplateRow(rows) {
  if (!rows || rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => {
    const sa = Number(a.score || 0);
    const sb = Number(b.score || 0);
    if (sb !== sa) return sb - sa;
    // desempate: mais wins
    const wa = Number(a.wins || 0);
    const wb = Number(b.wins || 0);
    if (wb !== wa) return wb - wa;
    // depois: mais uses (mais testado)
    const ua = Number(a.uses || 0);
    const ub = Number(b.uses || 0);
    return ub - ua;
  });

  // 80% exploit, 20% explore
  const r = Math.random();
  if (r < 0.8 || sorted.length === 1) return sorted[0];

  const topK = sorted.slice(0, Math.min(3, sorted.length));
  return topK[Math.floor(Math.random() * topK.length)];
}

async function decide({ supabase, instance_key, payload, provider = "whatauto" }) {
  const thread_type = detectThreadType(payload);
  const thread_ref = pickThreadRef({ thread_type, payload });
  const thread_id = pickThreadId({ thread_type, instance_key, thread_ref });

  // 1) Resolve instância (TENANT) via instance_key (Bearer)
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

  // 2) Load thread state
  const prior = a

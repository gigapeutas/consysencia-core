// ConSySencI.A — Brain FINAL (humano, sem menu)

function safeText(s){ return (s||"").toString().trim(); }
function now(){ return new Date().toISOString(); }

function detectThreadType(p){
  return p.group_name && safeText(p.group_name) ? "group" : "private";
}

function threadRef(type,p){
  return type==="group" ? safeText(p.group_name) : safeText(p.phone);
}

function threadId(type,key,ref){
  return `${type}:${key}:${ref}`;
}

function classifyIntent({message,thread_type}){
  const m = safeText(message).toLowerCase();

  if(m.includes("preço")||m.includes("preco")||m.includes("valor")) return "pricing";
  if(m.includes("catálogo")||m.includes("catalogo")) return "catalog";
  if(m.includes("suporte")||m.includes("erro")) return "support";
  if(m.includes("funciona")||m.includes("como")) return "how_it_works";
  if(m.includes("ativar")||m.includes("ativação")) return "activation";

  if(thread_type==="group") return "group_engage";
  return "general";
}

function ctxBuild(aff,p){
  return {
    agent_name: aff?.agent_name || "ConSySencI.A",
    product_name: "Nível 1 — Ativação",
    product_price: "R$25",
    site_url: "https://consysencia.com/",
    sender_name: p.sender || ""
  };
}

async function decide({supabase,instance_key,payload}){
  const type = detectThreadType(payload);
  const ref  = threadRef(type,payload);
  const tid  = threadId(type,instance_key,ref);
  const msg  = safeText(payload.message);

  const inst = await supabase
    .from("core_whatsapp_instances")
    .select("affiliate_id,is_active")
    .eq("instance_key",instance_key)
    .maybeSingle();

  if(!inst.data || inst.data.is_active===false){
    return { reply:"Configuração inválida. Contate o suporte." };
  }

  const aff = await supabase
    .from("core_affiliates")
    .select("agent_name,agent_style,is_active")
    .eq("id",inst.data.affiliate_id)
    .maybeSingle();

  const intent = classifyIntent({message:msg,thread_type:type});
  const style  = aff.data?.agent_style || (type==="group"?"persuasivo_curto":"persuasivo_humano");
  const ctx    = ctxBuild(aff.data,payload);

  const tpls = await supabase
    .from("core_templates")
    .select("id,body")
    .eq("enabled",true)
    .eq("intent",intent)
    .eq("style",style)
    .limit(5);

  let reply;
  if(tpls.data?.length){
    const t = tpls.data[Math.floor(Math.random()*tpls.data.length)];
    reply = t.body
      .replaceAll("{{agent_name}}",ctx.agent_name)
      .replaceAll("{{product_name}}",ctx.product_name)
      .replaceAll("{{product_price}}",ctx.product_price)
      .replaceAll("{{site_url}}",ctx.site_url)
      .replaceAll("{{sender_name}}",ctx.sender_name);

    await supabase.rpc("fn_template_use",{p_template_id:t.id});
  } else {
    reply = type==="group"
      ? `Se alguém quiser ativar um sistema automático, começa pelo ${ctx.product_name} (${ctx.product_price}).\n➡️ ${ctx.site_url}`
      : `Me diz só uma coisa: você quer ativar agora ou entender melhor antes?`;
  }

  await supabase.from("core_threads").upsert({
    thread_id:tid,
    instance_key,
    affiliate_id:inst.data.affiliate_id,
    thread_type:type,
    thread_ref:ref,
    intent,
    style,
    last_in_at:now(),
    last_out_at:now(),
    last_reply_preview:reply.slice(0,200)
  },{onConflict:"thread_id"});

  return { reply };
}

module.exports = { decide };

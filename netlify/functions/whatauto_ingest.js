const { createClient } = require("@supabase/supabase-js");
const querystring = require("querystring"); // Para ler o formato do WhatsAuto

exports.handler = async (event) => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    // 1. TRADUTOR INTELIGENTE: Lê tanto JSON quanto Formulário
    let body;
    if (event.headers["content-type"] === "application/x-www-form-urlencoded") {
      body = querystring.parse(event.body);
    } else {
      body = JSON.parse(event.body || "{}");
    }

    const numero = body.phone || body.from || body.sender;
    const mensagem = body.message || body.text;

    // 2. A SINAPSE REAL: Agora ela consegue chegar ao SQL
    const { data: respostaSQL, error } = await supabase.rpc('processar_conversa_consysencia', {
      numero_remetente: numero,
      texto_recebido: mensagem
    });

    if (error) throw new Error(error.message);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: respostaSQL })
    };

  } catch (err) {
    // 3. Se ainda der erro, ela te dirá o porquê sem travar
    return {
      statusCode: 200,
      body: JSON.stringify({ reply: `⚠️ Erro de Sinapse: ${err.message}` })
    };
  }
};

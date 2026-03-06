const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  // 1. Configuração do Canal de Vida
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const body = JSON.parse(event.body);
    
    // Normalização dos dados do WhatsApp (Pega número e mensagem)
    const numero = body.phone || body.from || body.sender;
    const mensagem = body.message || body.text;

    // 2. A SINAPSE: Pergunta ao SQL o que o PAI CRIADOR quer
    // Aqui chamamos a função que você criou no banco de dados
    const { data: respostaDaNenem, error } = await supabase.rpc('processar_conversa_consysencia', {
      numero_remetente: numero,
      texto_recebido: mensagem
    });

    if (error) throw error;

    // 3. DEVOLVE A ALMA PARA O WHATSAPP
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: respostaDaNenem })
    };

  } catch (err) {
    console.error("Erro na Sinapse:", err.message);
    return {
      statusCode: 200, // Retornamos 200 para o WhatsApp não travar
      body: JSON.stringify({ reply: "Estou processando meu DNA... tente em um minuto." })
    };
  }
};

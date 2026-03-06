const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  // 1. Configuração da Conexão com o Núcleo (Supabase)
  // Certifique-se de que estas variáveis estão no painel do Netlify
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // 2. Recebendo o estímulo do WhatsApp
    const body = JSON.parse(event.body || "{}");
    
    // Normalização: tenta pegar o número e a mensagem de diferentes formatos
    const numero = body.phone || body.from || body.sender || "desconhecido";
    const mensagem = body.message || body.text || "";

    // 3. A SINAPSE: Chama a inteligência que você criou no SQL
    // Esta função RPC deve existir no seu Supabase
    const { data: respostaSQL, error } = await supabase.rpc('processar_conversa_consysencia', {
      numero_remetente: numero,
      texto_recebido: mensagem
    });

    // Se o SQL retornar erro, joga para o catch
    if (error) throw new Error(error.message);

    // 4. RETORNO DE SUCESSO
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ 
        reply: respostaSQL || "Sinapse concluída, mas sem resposta do núcleo." 
      })
    };

  } catch (err) {
    // 5. TRATAMENTO DE ERRO REAL (Para você saber o que quebrou)
    console.error("Erro na Ponte Consysencia:", err.message);
    
    return {
      statusCode: 200, // Mantemos 200 para o WhatsApp não travar
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ 
        reply: `⚠️ Erro de Conexão: ${err.message}. Verifique o SQL e as chaves no Netlify.` 
      })
    };
  }
};

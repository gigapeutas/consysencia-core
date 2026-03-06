const { createClient } = require("@supabase/supabase-js");
const querystring = require("querystring"); // O tradutor de formulários que faltava

exports.handler = async (event) => {
  const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // 1. O TRADUTOR: Identifica se o WhatsApp mandou JSON ou Formulário
    let body;
    const contentType = event.headers["content-type"] || "";
    
    if (contentType.includes("application/x-www-form-urlencoded")) {
      body = querystring.parse(event.body); // Traduz o "app=WhatsA..."
    } else {
      body = JSON.parse(event.body || "{}");
    }

    // 2. EXTRAÇÃO: Pega o seu número e a sua mensagem
    const numero = body.phone || body.from || body.sender;
    const mensagem = body.message || body.text;

    // 3. A SINAPSE: Chama o SQL que você criou (O cérebro real)
    // O 'reply' aqui NÃO é uma string fixa, é o resultado do seu banco de dados
    const { data: respostaDoNucleo, error } = await supabase.rpc('processar_conversa_consysencia', {
      numero_remetente: numero,
      texto_recebido: mensagem
    });

    if (error) throw new Error(error.message);

    // 4. DEVOLUÇÃO: O que o SQL calculou, o WhatsApp responde
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ reply: respostaDoNucleo }) 
    };

  } catch (err) {
    // Se a conexão falhar, ele avisa o motivo técnico
    return {
      statusCode: 200,
      body: JSON.stringify({ reply: `⚠️ Falha na comunicação com o SQL: ${err.message}` })
    };
  }
};

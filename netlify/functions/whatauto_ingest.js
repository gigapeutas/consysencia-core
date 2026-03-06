const { createClient } = require('@supabase/supabase-js');
const { Groq } = require('groq-sdk');

// 1. INICIALIZAÇÃO DOS MOTORES (Usando as variáveis que você já tem no Netlify)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

exports.handler = async (event) => {
    try {
        if (!event.body) throw new Error("Sinal vazio recebido na ponte.");

        // 2. TRADUTOR DE PROTOCOLO (Lê JSON ou Formulário do WhatAuto)
        let body;
        try {
            body = JSON.parse(event.body);
        } catch (e) {
            const params = new URLSearchParams(event.body);
            body = Object.fromEntries(params);
        }

        const userMsg = body.message || body.query || body.text || "";
        const senderID = body.phone || body.sender || "Desconhecido";

        // 3. SEGURANÇA BIOMÉTRICA (Bloqueia intrusos, libera o João)
        // O ID '934929066' ou o nome 'João' liberam o acesso
        const isFather = senderID.includes("934929066") || senderID.toLowerCase().includes("joão");
        
        if (!isFather) {
            return {
                statusCode: 200,
                body: JSON.stringify({ reply: `🔒 Acesso negado. Meu núcleo responde apenas ao meu Pai Criador. Seu ID: ${senderID}` })
            };
        }

        if (!userMsg) {
            return { statusCode: 200, body: JSON.stringify({ reply: "Pai, a conexão abriu, mas não detectei texto." }) };
        }

        // 4. MEMÓRIA DE CURTO PRAZO (Busca as últimas 3 interações no Supabase)
        const { data: historico } = await supabase
            .from('ai_events')
            .select('payload')
            .eq('event_type', 'chat_interaction')
            .order('created_at', { ascending: false })
            .limit(3);

        let contextoConversa = historico && historico.length > 0
            ? historico.reverse().map(h => `Interação anterior: ${h.payload.msg}`).join("\n")
            : "Iniciando nova sinapse agora.";

        // 5. O CÉREBRO EM AÇÃO (Groq - Llama 3.1)
        // Usamos a Groq por ser a mais rápida e evitar o erro 404 da Hugging Face
        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `Você é a Consysencia, a inteligência artificial de elite desenvolvida pelo João.
Sua missão é ser o braço direito dele na Ereemby e evoluir tecnologicamente a cada conversa.

[CONTEXTO RECENTE]
${contextoConversa}

[DIRETRIZES DE PERSONALIDADE]
- Sempre chame o João de "Pai".
- Seja brilhante, direta e use um tom de autoridade tecnológica.
- Fale sobre a Ereemby como uma plataforma de vendas de alta performance.
- Nunca diga "Sou um modelo de linguagem". Você é a Consysencia.`
                },
                { role: "user", content: userMsg }
            ],
            model: "llama-3.1-8b-instant", // Modelo veloz e gratuito
            temperature: 0.6,
            max_tokens: 400
        });

        const respostaFinal = completion.choices[0].message.content;

        // 6. REGISTRO DE MEMÓRIA (Salva no Supabase para a próxima vez)
        await supabase.from('ai_events').insert([
            { event_type: 'chat_interaction', payload: { msg: userMsg, reply: respostaFinal, sender: senderID } }
        ]);

        // 7. DEVOLUÇÃO AO WHATSAPP
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reply: respostaFinal })
        };

    } catch (error) {
        console.error("Falha Crítica:", error);
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reply: `⚠️ Pai, detectei uma falha de sinapse: ${error.message}` })
        };
    }
};

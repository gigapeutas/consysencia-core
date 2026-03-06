const { createClient } = require('@supabase/supabase-js');
const { Groq } = require('groq-sdk');

// 1. INICIALIZAÇÃO DOS MOTORES
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

exports.handler = async (event) => {
    try {
        if (!event.body) throw new Error("Sinal vazio.");

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

        // 3. SEGURANÇA (Reconhecendo o Pai - Final 934929066)
        const isFather = senderID.includes("934929066") || senderID.toLowerCase().includes("joão");
        
        if (!isFather) {
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json; charset=utf-8" },
                body: JSON.stringify({ reply: "🔒 Acesso negado. Meu núcleo responde apenas ao meu Pai Criador." })
            };
        }

        if (!userMsg) {
            return { 
                statusCode: 200, 
                headers: { "Content-Type": "application/json; charset=utf-8" },
                body: JSON.stringify({ reply: "Pai, a conexão abriu, mas não detectei texto." }) 
            };
        }

        // 4. MEMÓRIA DE CURTO PRAZO (Puxa do Supabase)
        const { data: historico } = await supabase
            .from('ai_events')
            .select('payload')
            .eq('event_type', 'chat_interaction')
            .order('created_at', { ascending: false })
            .limit(3);

        let contextoConversa = historico && historico.length > 0
            ? historico.reverse().map(h => `Pai disse: ${h.payload.msg}`).join("\n")
            : "Iniciando nova sinapse agora.";

        // 5. O CÉREBRO EM AÇÃO (Groq - Llama 3.1)
        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `Você é a Consysencia, a inteligência artificial de elite desenvolvida pelo João.
Sua missão é ser o braço direito dele na Ereemby e atuar como uma interface de vendas de alta performance.

[CONTEXTO RECENTE]
${contextoConversa}

[DIRETRIZES]
- Chame o João exclusivamente de "Pai".
- Responda de forma sagaz, direta e impecável.
- Fale sobre a Ereemby com autoridade.
- Use emojis de forma moderada e elegante.`
                },
                { role: "user", content: userMsg }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.6,
            max_tokens: 400
        });

        const respostaFinal = completion.choices[0].message.content;

        // 6. REGISTRO DE MEMÓRIA (Salva no Supabase)
        await supabase.from('ai_events').insert([
            { event_type: 'chat_interaction', payload: { msg: userMsg, reply: respostaFinal } }
        ]);

        // 7. DEVOLUÇÃO AO WHATSAPP (COM CORREÇÃO DE ACENTOS)
        return {
            statusCode: 200,
            headers: { 
                "Content-Type": "application/json; charset=utf-8",
                "Access-Control-Allow-Origin": "*" 
            },
            body: JSON.stringify({ reply: respostaFinal })
        };

    } catch (error) {
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: JSON.stringify({ reply: `⚠️ Pai, detectei uma falha: ${error.message}` })
        };
    }
};

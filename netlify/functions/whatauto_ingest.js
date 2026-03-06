const { createClient } = require('@supabase/supabase-js');
const { Groq } = require('groq-sdk');

// Inicialização rápida
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

exports.handler = async (event) => {
    try {
        if (!event.body) throw new Error("Sinal vazio.");
        
        let body;
        try {
            body = JSON.parse(event.body);
        } catch (e) {
            const params = new URLSearchParams(event.body);
            body = Object.fromEntries(params);
        }
        
        const userMsg = body.message || body.query || body.text || ""; 
        const senderID = body.phone || body.sender || "Desconhecido";

        // BLINDAGEM (Seu número final 934929066)
        if (!senderID.includes("934929066") && !senderID.toLowerCase().includes("joão")) {
            return { statusCode: 200, body: JSON.stringify({ reply: "🔒 Acesso negado ao núcleo." }) };
        }

        // CÉREBRO GROQ (Llama 3) - Sem busca vetorial, apenas DNA Puro
        const completion = await groq.chat.completions.create({
            messages: [
                { 
                    role: "system", 
                    content: `Você é a Consysencia, a IA de elite criada pelo João. 
                    Seu objetivo é ser a melhor interface para a plataforma Ereemby e para os projetos do João. 
                    Responda sempre como "Consysencia", chame o João de "Pai" e seja extremamente sagaz e direta.` 
                },
                { role: "user", content: userMsg }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.7,
            max_tokens: 300,
        });

        const respostaFinal = completion.choices[0].message.content;

        // Salva apenas o log da conversa no Supabase (Opcional)
        await supabase.from('ai_events').insert([{ event_type: 'chat', payload: { msg: userMsg, reply: respostaFinal } }]);

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reply: respostaFinal })
        };

    } catch (error) {
        return {
            statusCode: 200, 
            body: JSON.stringify({ reply: `⚠️ Erro no núcleo: ${error.message}` })
        };
    }
};

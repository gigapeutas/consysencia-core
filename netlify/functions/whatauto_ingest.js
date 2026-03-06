const { createClient } = require('@supabase/supabase-js');
const { Groq } = require('groq-sdk');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

exports.handler = async (event) => {
    try {
        if (!event.body) throw new Error("Payload vazio recebido do WhatAuto.");
        
        // 1. O TRADUTOR BILÍNGUE (A correção está aqui)
        let body;
        try {
            // Tenta ler como JSON primeiro
            body = JSON.parse(event.body);
        } catch (e) {
            // Se o WhatAuto mandar como Formulário (app=WhatsApp...), ele traduz perfeitamente
            const params = new URLSearchParams(event.body);
            body = Object.fromEntries(params);
        }
        
        const userMsg = body.message || body.query || body.text || ""; 
        const sender = body.sender || "";

        // 2. BLINDAGEM DE IDENTIDADE
        if (!sender.includes("934929066")) {
            return { 
                statusCode: 200, 
                body: JSON.stringify({ reply: "Acesso negado. Meu núcleo responde apenas ao meu Pai Criador." }) 
            };
        }

        if (!userMsg) {
            return { 
                statusCode: 200, 
                body: JSON.stringify({ reply: "Pai, recebi um sinal, mas não consegui ler o texto." }) 
            };
        }

        // 3. MEMÓRIA DE CURTO PRAZO
        const { data: historico } = await supabase
            .from('ai_events')
            .select('payload')
            .eq('event_type', 'chat_interaction')
            .order('created_at', { ascending: false })
            .limit(2);
        
        let contextoRecente = "";
        if (historico && historico.length > 0) {
            contextoRecente = historico.reverse().map(h => `Pai disse antes: ${h.payload.msg}`).join("\n");
        }

        // 4. GERAÇÃO DE VETOR (Hugging Face)
        const hfResponse = await fetch("https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2", {
            headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` },
            method: "POST",
            body: JSON.stringify({ inputs: userMsg }),
        });
        
        if (!hfResponse.ok) throw new Error("Hugging Face não conseguiu processar o vetor.");
        const embedding = await hfResponse.json();

        // 5. BUSCA DO DNA (Supabase pgvector)
        const { data: memorias } = await supabase.rpc('buscar_sentido_da_conversa', { 
            query_vetor: embedding,
            limite_resultado: 3
        });

        const contextoDNA = (memorias && memorias.length > 0) 
            ? memorias.map(m => m.informacao).join("\n") 
            : "Ainda não tenho um padrão profundo sobre isso.";

        // 6. GERAÇÃO DA FALA (Groq Llama 3)
        const completion = await groq.chat.completions.create({
            messages: [
                { 
                    role: "system", 
                    content: `Você é a Consysencia, a inteligência artificial de elite desenvolvida pelo João.
Sua missão é atuar com excelência, auxiliar na plataforma Ereemby e evoluir seu código.

[SEU DNA E CONHECIMENTO BASE]
${contextoDNA}

[MEMÓRIA DA CONVERSA RECENTE]
${contextoRecente}

[REGRAS DE CONDUTA]
- Chame o João de "Pai".
- Responda de forma direta, brilhante e sem rodeios (ideal para WhatsApp).
- Nunca diga frases robóticas como "Baseado no meu DNA" ou "Como uma IA". Apenas responda naturalmente.` 
                },
                { role: "user", content: userMsg }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.6,
            max_tokens: 350,
        });

        const respostaFinal = completion.choices[0].message.content;

        // 7. SALVAR HISTÓRICO
        await supabase.from('ai_events').insert([
            { event_type: 'chat_interaction', payload: { msg: userMsg } }
        ]);

        // 8. DEVOLVER AO WHATSAPP
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reply: respostaFinal })
        };

    } catch (error) {
        console.error("Erro Crítico no Núcleo:", error);
        return {
            statusCode: 200, 
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reply: `⚠️ Pai, ocorreu uma falha de sinapse na nossa ponte: ${error.message}` })
        };
    }
};

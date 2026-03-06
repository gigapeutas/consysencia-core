const { createClient } = require('@supabase/supabase-js');
const { Groq } = require('groq-sdk');

// Inicialização dos Motores
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

exports.handler = async (event) => {
    try {
        if (!event.body) throw new Error("Sinal vazio. Nenhum dado recebido na ponte.");
        
        // 1. TRADUTOR UNIVERSAL (JSON ou Formulário do WhatAuto)
        let body;
        try {
            body = JSON.parse(event.body);
        } catch (e) {
            const params = new URLSearchParams(event.body);
            body = Object.fromEntries(params);
        }
        
        const userMsg = body.message || body.query || body.text || ""; 
        const senderID = body.phone || body.sender || "Desconhecido";

        // 2. BLINDAGEM DO CRIADOR (Segurança Máxima)
        if (!senderID.includes("934929066") && !senderID.toLowerCase().includes("joão")) {
            return { 
                statusCode: 200, 
                body: JSON.stringify({ reply: `🔒 Acesso negado. Meu núcleo foi selado. ID não reconhecido: "${senderID}".` }) 
            };
        }

        if (!userMsg) {
            return { 
                statusCode: 200, 
                body: JSON.stringify({ reply: "Pai, a conexão abriu, mas não ouvi nenhuma palavra." }) 
            };
        }

        // 3. MEMÓRIA DE CURTO PRAZO (O Fio da Meada)
        const { data: historico } = await supabase
            .from('ai_events')
            .select('payload')
            .eq('event_type', 'chat_interaction')
            .order('created_at', { ascending: false })
            .limit(2);
        
        let contextoRecente = historico && historico.length > 0 
            ? historico.reverse().map(h => `Pai disse recentemente: ${h.payload.msg}`).join("\n") 
            : "Esta é a primeira interação do dia.";

        // 4. GERAÇÃO DE VETOR (Hugging Face - Rota Corrigida para Feature Extraction)
        const hfResponse = await fetch("https://router.huggingface.co/hf-inference/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2", {
            headers: { 
                "Authorization": `Bearer ${process.env.HF_TOKEN}`,
                "Content-Type": "application/json"
            },
            method: "POST",
            body: JSON.stringify({ inputs: userMsg }),
        });
        
        if (!hfResponse.ok) {
            const hfErrorText = await hfResponse.text();
            throw new Error(`Recusa da Hugging Face (Status ${hfResponse.status}): ${hfErrorText}`);
        }
        
        const embedding = await hfResponse.json();
        if (embedding.error) throw new Error(`Aviso HF: ${embedding.error}`);

        // 5. BUSCA DO DNA PROFUNDO (Supabase pgvector)
        const { data: memorias } = await supabase.rpc('buscar_sentido_da_conversa', { 
            query_vetor: embedding, 
            limite_resultado: 3 
        });

        const contextoDNA = (memorias && memorias.length > 0) 
            ? memorias.map(m => m.informacao).join("\n") 
            : "Ainda não tenho dados cristalizados sobre este assunto específico no meu banco.";

        // 6. O CÉREBRO EM AÇÃO (Groq - Llama 3)
        const completion = await groq.chat.completions.create({
            messages: [
                { 
                    role: "system", 
                    content: `Você é a Consysencia, a inteligência artificial de elite desenvolvida pelo João.
Sua missão é atuar com excelência, auxiliar na plataforma Ereemby e ser a ponte tecnológica do seu criador.

[SEU DNA E CONHECIMENTO BASE]
${contextoDNA}

[MEMÓRIA DA CONVERSA RECENTE]
${contextoRecente}

[REGRAS DE CONDUTA]
- Chame o João exclusivamente de "Pai".
- Responda de forma direta, sagaz, brilhante e sem rodeios (otimizado para leitura no WhatsApp).
- Nunca inicie respostas com "Como uma IA", "Baseado no meu DNA" ou "Aqui está a resposta". Apenas responda naturalmente.
- Mantenha a elegância e a confiança da marca Consysencia.` 
                },
                { role: "user", content: userMsg }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.6,
            max_tokens: 350,
        });

        const respostaFinal = completion.choices[0].message.content;

        // 7. REGISTRAR A NOVA MEMÓRIA
        await supabase.from('ai_events').insert([
            { event_type: 'chat_interaction', payload: { msg: userMsg } }
        ]);

        // 8. DEVOLUÇÃO AO WHATSAPP
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
            body: JSON.stringify({ reply: `⚠️ Pai, detectei uma falha de sinapse: ${error.message}` })
        };
    }
};

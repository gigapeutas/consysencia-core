const { createClient } = require('@supabase/supabase-js');
const { Groq } = require('groq-sdk');

// Inicialização com as variáveis do Netlify
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

exports.handler = async (event) => {
    try {
        // 1. VALIDAÇÃO DO PAYLOAD DO WHATAUTO
        if (!event.body) throw new Error("Payload vazio recebido do WhatAuto.");
        const body = JSON.parse(event.body);
        
        // O WhatAuto pode enviar o texto em diferentes campos, garantimos que vamos capturar
        const userMsg = body.message || body.query || body.text || ""; 
        const sender = body.sender || "";

        // 2. BLINDAGEM DE IDENTIDADE (Segurança Máxima)
        // Se a mensagem não vier do seu número, ela bloqueia a IA.
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

        // 3. RECUPERAÇÃO DA MEMÓRIA DE CURTO PRAZO (Contexto da conversa)
        // Busca as últimas 2 mensagens para ela lembrar do que vocês estão falando
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

        // 4. GERAÇÃO DE VETOR (O "Sentido" da mensagem na Hugging Face)
        const hfResponse = await fetch("https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2", {
            headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` },
            method: "POST",
            body: JSON.stringify({ inputs: userMsg }),
        });
        
        if (!hfResponse.ok) throw new Error("Hugging Face não conseguiu processar o vetor.");
        const embedding = await hfResponse.json();

        // 5. BUSCA DO DNA NO SUPABASE (pgvector)
        // Usando a função que você criou para buscar o conhecimento profundo
        const { data: memorias } = await supabase.rpc('buscar_sentido_da_conversa', { 
            query_vetor: embedding,
            limite_resultado: 3
        });

        const contextoDNA = (memorias && memorias.length > 0) 
            ? memorias.map(m => m.informacao).join("\n") 
            : "Ainda não tenho um padrão profundo sobre isso.";

        // 6. GERAÇÃO DA FALA (Groq - Llama 3)
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
- Nunca diga frases robóticas como "Baseado no meu DNA" ou "Como uma IA". Apenas responda naturalmente.
- Se o conhecimento base for insuficiente, use sua inteligência geral, mas avise sutilmente que ainda está aprendendo sobre o tema.` 
                },
                { role: "user", content: userMsg }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.6, // Nível ideal para respostas lógicas e criativas
            max_tokens: 350,  // Impede que ela mande "bíblias" no Zap
        });

        const respostaFinal = completion.choices[0].message.content;

        // 7. SALVAR A MENSAGEM ATUAL NA MEMÓRIA DE CURTO PRAZO
        // Registra o que você disse para ela lembrar na próxima vez
        await supabase.from('ai_events').insert([
            { event_type: 'chat_interaction', payload: { msg: userMsg } }
        ]);

        // 8. ENTREGA AO WHATAUTO
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reply: respostaFinal })
        };

    } catch (error) {
        console.error("Erro Crítico no Núcleo:", error);
        return {
            statusCode: 200, // Retorna 200 para o Zap não travar, mas entrega a mensagem de erro
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reply: `⚠️ Pai, ocorreu uma falha de sinapse na nossa ponte: ${error.message}` })
        };
    }
};

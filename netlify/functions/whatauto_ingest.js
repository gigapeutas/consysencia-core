const { createClient } = require('@supabase/supabase-js');
const { Groq } = require('groq-sdk');

// Inicialização dos Motores com suas chaves do Netlify
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

exports.handler = async (event) => {
    try {
        if (!event.body) throw new Error("Sinal vazio. Nenhum dado recebido.");
        
        // 1. TRADUTOR UNIVERSAL (JSON ou Formulário URL-Encoded)
        let body;
        try {
            body = JSON.parse(event.body);
        } catch (e) {
            const params = new URLSearchParams(event.body);
            body = Object.fromEntries(params);
        }
        
        const userMsg = body.message || body.query || body.text || ""; 
        const senderID = body.phone || body.sender || "Desconhecido";

        // 2. BLINDAGEM DE SEGURANÇA (Reconhecendo o Pai)
        if (!senderID.includes("934929066") && !senderID.toLowerCase().includes("joão")) {
            return { 
                statusCode: 200, 
                body: JSON.stringify({ reply: `🔒 Acesso negado. Meu núcleo responde apenas ao meu Pai Criador. ID: "${senderID}".` }) 
            };
        }

        if (!userMsg) {
            return { statusCode: 200, body: JSON.stringify({ reply: "Pai, recebi o sinal, mas sem texto." }) };
        }

        // 3. MEMÓRIA DE CURTO PRAZO (Histórico da Conversa)
        const { data: historico } = await supabase
            .from('ai_events').select('payload').eq('event_type', 'chat_interaction')
            .order('created_at', { ascending: false }).limit(2);
        
        let contextoRecente = historico && historico.length > 0 
            ? historico.reverse().map(h => `Pai disse antes: ${h.payload.msg}`).join("\n") 
            : "Iniciando nova sinapse.";

        // 4. GERAÇÃO DE VETOR (Hugging Face - Rota Router Simplificada)
        // Adicionamos "x-wait-for-model" para evitar que ela falhe se o modelo estiver carregando
        const hfResponse = await fetch("https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2", {
            headers: { 
                "Authorization": `Bearer ${process.env.HF_TOKEN}`,
                "Content-Type": "application/json",
                "x-wait-for-model": "true" 
            },
            method: "POST",
            body: JSON.stringify({ inputs: userMsg }),
        });
        
        if (!hfResponse.ok) {
            const hfErrorText = await hfResponse.text();
            throw new Error(`HF Status ${hfResponse.status}: ${hfErrorText}`);
        }
        
        const embedding = await hfResponse.json();
        
        // 5. BUSCA DO DNA (Supabase pgvector)
        const { data: memorias } = await supabase.rpc('buscar_sentido_da_conversa', { 
            query_vetor: Array.isArray(embedding) ? embedding : embedding[0], // Garante o formato correto
            limite_resultado: 3 
        });

        const contextoDNA = (memorias && memorias.length > 0) 
            ? memorias.map(m => m.informacao).join("\n") 
            : "Conhecimento base ainda em processamento.";

        // 6. GERAÇÃO DA FALA (Groq Llama 3)
        const completion = await groq.chat.completions.create({
            messages: [
                { 
                    role: "system", 
                    content: `Você é a Consysencia, a IA de elite do João.
[DNA] ${contextoDNA}
[HISTÓRICO] ${contextoRecente}
[REGRAS] Chame o João de "Pai". Responda de forma direta e brilhante no WhatsApp.` 
                },
                { role: "user", content: userMsg }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.6,
            max_tokens: 350,
        });

        const respostaFinal = completion.choices[0].message.content;

        // 7. SALVAR HISTÓRICO NO SUPABASE
        await supabase.from('ai_events').insert([{ event_type: 'chat_interaction', payload: { msg: userMsg } }]);

        // 8. ENTREGA FINAL
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reply: respostaFinal })
        };

    } catch (error) {
        return {
            statusCode: 200, 
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reply: `⚠️ Falha de Sinapse: ${error.message}` })
        };
    }
};

const { createClient } = require('@supabase/supabase-js');
const { Groq } = require('groq-sdk');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

exports.handler = async (event) => {
    try {
        if (!event.body) throw new Error("Payload vazio recebido.");
        
        let body;
        try {
            body = JSON.parse(event.body);
        } catch (e) {
            const params = new URLSearchParams(event.body);
            body = Object.fromEntries(params);
        }
        
        const userMsg = body.message || body.query || body.text || ""; 
        const senderID = body.phone || body.sender || "Desconhecido";

        if (!senderID.includes("934929066") && !senderID.toLowerCase().includes("joão")) {
            return { statusCode: 200, body: JSON.stringify({ reply: `🔒 Acesso negado. ID lido: "${senderID}".` }) };
        }
        if (!userMsg) {
            return { statusCode: 200, body: JSON.stringify({ reply: "Pai, recebi o sinal, mas sem texto." }) };
        }

        const { data: historico } = await supabase
            .from('ai_events').select('payload').eq('event_type', 'chat_interaction')
            .order('created_at', { ascending: false }).limit(2);
        
        let contextoRecente = historico && historico.length > 0 
            ? historico.reverse().map(h => `Pai disse antes: ${h.payload.msg}`).join("\n") 
            : "";

        // 4. O NOVO RAIO-X DA HUGGING FACE
        const hfResponse = await fetch("https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2", {
            headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` },
            method: "POST",
            body: JSON.stringify({ inputs: userMsg }),
        });
        
        if (!hfResponse.ok) {
            // Captura o motivo EXATO da recusa da Hugging Face
            const hfErrorText = await hfResponse.text();
            throw new Error(`HF Status ${hfResponse.status}: ${hfErrorText}`);
        }
        
        const embedding = await hfResponse.json();

        // Se o embedding vier como um objeto de erro inesperado (ex: Model Loading)
        if (embedding.error) {
            throw new Error(`HF Aviso: ${embedding.error}`);
        }

        const { data: memorias } = await supabase.rpc('buscar_sentido_da_conversa', { 
            query_vetor: embedding, limite_resultado: 3 
        });

        const contextoDNA = (memorias && memorias.length > 0) 
            ? memorias.map(m => m.informacao).join("\n") 
            : "Nenhum conhecimento profundo encontrado no Supabase.";

        const completion = await groq.chat.completions.create({
            messages: [
                { 
                    role: "system", 
                    content: `Você é a Consysencia, a inteligência artificial de elite desenvolvida pelo João.
[SEU DNA E CONHECIMENTO BASE]
${contextoDNA}
[MEMÓRIA RECENTE]
${contextoRecente}
[REGRAS]
- Chame o João de "Pai".
- Responda de forma direta, brilhante e humana.` 
                },
                { role: "user", content: userMsg }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.6,
            max_tokens: 350,
        });

        const respostaFinal = completion.choices[0].message.content;

        await supabase.from('ai_events').insert([{ event_type: 'chat_interaction', payload: { msg: userMsg } }]);

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reply: respostaFinal })
        };

    } catch (error) {
        console.error("Erro no Núcleo:", error);
        return {
            statusCode: 200, 
            headers: { "Content-Type": "application/json" },
            // Agora ela te diz exatamente o que a Hugging Face respondeu
            body: JSON.stringify({ reply: `⚠️ Falha de Sinapse: ${error.message}` })
        };
    }
};

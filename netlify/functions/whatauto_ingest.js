const { createClient } = require('@supabase/supabase-js');
const { Groq } = require('groq-sdk');

// Configurações
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

exports.handler = async (event) => {
    const body = JSON.parse(event.body);
    const userMsg = body.query; // Mensagem do WhatsApp
    const sender = body.sender;

    // 1. GERAR VETOR (Hugging Face - Modelo Gratuito)
    // Transforma sua fala em números para o pgvector entender
    const hfResponse = await fetch("https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2", {
        headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` },
        method: "POST",
        body: JSON.stringify({ inputs: userMsg }),
    });
    const embedding = await hfResponse.json();

    // 2. BUSCAR NO SUPABASE (pgvector)
    // Acha a memória que mais combina com o que você disse
    const { data: documents } = await supabase.rpc('match_documents', {
        query_embedding: embedding,
        match_threshold: 0.5,
        match_count: 3,
    });

    const contexto = documents.map(d => d.conteudo).join("\n");

    // 3. GERAR RESPOSTA NA GROQ (O Grito de Inteligência)
    const chatCompletion = await groq.chat.completions.create({
        messages: [
            { role: "system", content: `Você é a Consysencia, a IA criada pelo João. Use este DNA: ${contexto}` },
            { role: "user", content: userMsg }
        ],
        model: "llama-3.1-8b-instant", // Modelo ultrarrápido e gratuito
    });

    return {
        statusCode: 200,
        body: JSON.stringify({ reply: chatCompletion.choices[0].message.content })
    };
};

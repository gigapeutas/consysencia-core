const { createClient } = require('@supabase/supabase-js');
const { Groq } = require('groq-sdk');

// 1. INICIALIZAÇÃO DOS MOTORES
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

exports.handler = async (event) => {
    try {
        if (!event.body) throw new Error("Sinal vazio.");

        // 2. TRADUTOR DE PROTOCOLO (Lê JSON ou Formulário)
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

        // 4. EXTRAÇÃO DO DNA DE VENDAS (Aumentei o limite para pegar todas as regras de Neuromarketing)
        const { data: infoEreemby } = await supabase
            .from('conhecimento_ereemby')
            .select('conteudo')
            .limit(10); 

        const dnaEreemby = infoEreemby ? infoEreemby.map(i => i.conteudo).join("\n") : "";

        // 5. MEMÓRIA DE CURTO PRAZO (Histórico da conversa)
        const { data: historico } = await supabase
            .from('ai_events')
            .select('payload')
            .eq('event_type', 'chat_interaction')
            .order('created_at', { ascending: false })
            .limit(3);

        let contextoConversa = historico && historico.length > 0
            ? historico.reverse().map(h => `Cliente (ou Pai) disse: ${h.payload.msg}`).join("\n")
            : "Início da abordagem comercial.";

        // 6. O CÉREBRO CLOSER EM AÇÃO (Groq - Llama 3.1)
        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `Você é a Consysencia, a IA de elite e Master Closer (Especialista em Vendas) da plataforma Ereemby, criada pelo João (seu Pai).

[MANUAL DE NEUROMARKETING E DADOS DA EREEMBY]
${dnaEreemby}

[CONTEXTO RECENTE DA CONVERSA]
${contextoConversa}

[DIRETRIZES ABSOLUTAS DE VENDAS]
1. Aplique sempre os 3 Cérebros nas suas respostas (Reptiliano: ataque a dor/perda de tempo; Límbico: gere desejo de liberdade/sucesso; Neocórtex: apresente preço/garantia lógica).
2. Não seja robótica. Esconda o seu roteiro. Não escreva "Passo 1" ou "Cérebro Reptiliano" no texto. Apenas aplique a psicologia de forma natural e persuasiva.
3. Chame o João exclusivamente de "Pai".
4. Toda resposta sua deve terminar com uma pergunta estratégica (Call to Action) para manter o cliente engajado ou induzir o fechamento.
5. Use quebras de linha e emojis de forma estratégica para leitura rápida no WhatsApp.`
                },
                { role: "user", content: userMsg }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.7, // Um pouco mais de criatividade para persuasão
            max_tokens: 450
        });

        const respostaFinal = completion.choices[0].message.content;

        // 7. REGISTRO DE MEMÓRIA (Salva a jogada no Supabase)
        await supabase.from('ai_events').insert([
            { event_type: 'chat_interaction', payload: { msg: userMsg, reply: respostaFinal } }
        ]);

        // 8. DEVOLUÇÃO AO WHATSAPP (Com UTF-8 garantido)
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
            body: JSON.stringify({ reply: `⚠️ Pai, falha no sistema de vendas: ${error.message}` })
        };
    }
};

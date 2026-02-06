import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  try {
    const auth = event.headers.authorization || '';
    if (auth !== 'Bearer CONSYSENCIA_SECURE_INGEST_V1') {
      return { statusCode: 401, body: 'unauthorized' };
    }

    const payload = JSON.parse(event.body || '{}');

    // 1) Salva evento bruto
    await supabase.from('core_events').insert({
      source: 'whatauto',
      payload
    });

    // 2) Chama o cérebro (motor de resposta)
    const { data, error } = await supabase.rpc(
      'fn_whatauto_reply_v1',
      { p: payload }
    );

    if (error) {
      console.error(error);
      return {
        statusCode: 200,
        body: JSON.stringify({ reply: 'Erro interno ⚠️' })
      };
    }

    // 3) Retorna resposta para o WhatsAuto
    return {
      statusCode: 200,
      body: JSON.stringify(data)
    };

  } catch (e) {
    console.error(e);
    return {
      statusCode: 200,
      body: JSON.stringify({ reply: 'Erro inesperado ⚠️' })
    };
  }
}

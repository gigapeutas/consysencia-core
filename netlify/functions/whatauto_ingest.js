// netlify/functions/whatauto_ingest.js

exports.handler = async (event) => {
  // Só aceita POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "method_not_allowed" }),
    };
  }

  // Resposta neutra para o WhatsAuto (não vaza nada)
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply: "" }),
  };
};

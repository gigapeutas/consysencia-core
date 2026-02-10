let rawBody = event.body || '';
let parsed = {};
let parsePath = 'none';

try {
  if (rawBody && rawBody.trim().startsWith('{')) {
    parsed = JSON.parse(rawBody);
    parsePath = 'json';
  }
} catch {}

if (Object.keys(parsed).length === 0 && rawBody) {
  try {
    const params = new URLSearchParams(rawBody);
    for (const [k, v] of params.entries()) parsed[k] = v;
    if (Object.keys(parsed).length) parsePath = 'form';
  } catch {}
}

if (Object.keys(parsed).length === 0 && event.queryStringParameters) {
  parsed = { ...event.queryStringParameters };
  parsePath = 'query';
}

const extracted_fields = {
  message: parsed.message || parsed.text || null,
  sender: parsed.sender || parsed.from || null,
  phone: parsed.phone || parsed.number || null,
  group_name: parsed.group_name || null
};

const payload = {
  content_type: event.headers['content-type'] || null,
  parse_path: parsePath,
  raw_body_preview: rawBody?.slice(0, 500) || null,
  parsed_body_preview: parsed,
  extracted_fields,
  canonical: extracted_fields
};

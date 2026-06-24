exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const data = JSON.parse(event.body || '{}');
    const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK;

    if (!webhookUrl) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Google Sheets webhook not configured' }) };
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: event.body
    });

    if (!response.ok) throw new Error(`Webhook returned ${response.status}`);

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('save-to-sheets error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Save to sheets failed: ' + err.message })
    };
  }
};

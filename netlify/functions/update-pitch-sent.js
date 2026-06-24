const { getSupabaseClient, getGeminiClient, updatePitchHistoryAndExtractCorrections } = require('./shared');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const { historyId, finalSent } = body;

    if (!historyId || !finalSent) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'History ID and final sent text are required' })
      };
    }

    const supabase = getSupabaseClient();
    const ai = getGeminiClient();

    const updatedRow = await updatePitchHistoryAndExtractCorrections(supabase, ai, historyId, finalSent);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, updatedRow })
    };

  } catch (err) {
    console.error('update-pitch-sent error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to update sent pitch: ' + err.message })
    };
  }
};

const { getSupabaseClient, getGeminiClient, extractVoiceProfile } = require('./shared');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const supabase = getSupabaseClient();
    const ai = getGeminiClient();

    const { profile, count } = await extractVoiceProfile(supabase, ai);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        count,
        profile
      })
    };
  } catch (err) {
    console.error('refresh-voice error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to refresh voice profile: ' + err.message })
    };
  }
};

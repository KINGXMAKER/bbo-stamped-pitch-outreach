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
    const body = JSON.parse(event.body || '{}');
    const { channel, venueType, gapType, content, outcome } = body;

    if (!channel || !content) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Channel and content are required' })
      };
    }

    const supabase = getSupabaseClient();
    const ai = getGeminiClient();

    let outcomeScore = 50;
    if (outcome === 'booked') outcomeScore = 100;
    if (outcome === 'replied') outcomeScore = 50;
    if (outcome === 'ghosted') outcomeScore = 0;

    // 1. Insert pitch example
    const { data: example, error: insertError } = await supabase
      .from('pitch_examples')
      .insert({
        channel,
        venue_type: venueType || null,
        gap_type: gapType || null,
        content,
        outcome: outcome || 'pending',
        outcome_score: outcomeScore,
        is_user_example: true
      })
      .select()
      .single();

    if (insertError) {
      console.error('Insert example error:', insertError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to insert example: ' + insertError.message })
      };
    }

    // 2. Automatically trigger voice profile extraction/refresh
    let voiceProfile = null;
    try {
      const result = await extractVoiceProfile(supabase, ai);
      voiceProfile = result.profile;
    } catch (profileErr) {
      console.error('Failed to auto-refresh voice profile:', profileErr);
      // We don't fail the request if voice profile extraction fails, just log it.
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        example,
        voiceProfileRefreshed: !!voiceProfile
      })
    };

  } catch (err) {
    console.error('save-examples error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to save example: ' + err.message })
    };
  }
};

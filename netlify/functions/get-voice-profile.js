const { getSupabaseClient, getMatchingExamples } = require('./shared');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  
  // Allow GET or POST
  const isPost = event.httpMethod === 'POST';
  let venueType, gapType, channel;
  
  try {
    if (isPost) {
      const body = JSON.parse(event.body || '{}');
      venueType = body.venueType;
      gapType = body.gapType;
      channel = body.channel;
    } else {
      const params = event.queryStringParameters || {};
      venueType = params.venueType;
      gapType = params.gapType;
      channel = params.channel;
    }

    const supabase = getSupabaseClient();

    // 1. Fetch latest voice profile
    const { data: profileRow, error: profileErr } = await supabase
      .from('voice_profiles')
      .select('*')
      .order('last_refreshed', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (profileErr) {
      console.error('Fetch profile error:', profileErr);
    }

    // 2. Fetch top matching examples for the channel
    const targetChannel = channel || 'email';
    const examples = await getMatchingExamples(supabase, targetChannel, venueType, gapType);

    // Also get overall stats
    const { count: totalExamplesCount } = await supabase
      .from('pitch_examples')
      .select('*', { count: 'exact', head: true });

    const { data: recentHistory } = await supabase
      .from('pitch_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    let bookedCount = 0;
    let repliedCount = 0;
    let totalPitches = 0;
    if (recentHistory) {
      totalPitches = recentHistory.length;
      recentHistory.forEach(h => {
        if (h.outcome === 'booked') bookedCount++;
        if (h.outcome === 'replied') repliedCount++;
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        voiceProfile: profileRow ? profileRow.profile_data : null,
        lastRefreshed: profileRow ? profileRow.last_refreshed : null,
        examples,
        history: recentHistory || [],
        stats: {
          totalExamples: totalExamplesCount || 0,
          totalPitches,
          bookedCount,
          repliedCount,
          winRate: totalPitches > 0 ? Math.round(((bookedCount + repliedCount) / totalPitches) * 100) : 0
        }
      })
    };

  } catch (err) {
    console.error('get-voice-profile error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to get voice profile: ' + err.message })
    };
  }
};


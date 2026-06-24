const { getGeminiClient, generateText } = require('./shared');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { handle } = JSON.parse(event.body || '{}');
    if (!handle) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No handle provided' }) };

    const cleanHandle = handle.replace('@', '').trim();
    const igUrl = `https://www.instagram.com/${cleanHandle}/`;

    let profileData = '';
    try {
      const jinaRes = await fetch(`https://r.jina.ai/${igUrl}`, {
        headers: { 'Accept': 'text/markdown' }
      });
      if (!jinaRes.ok) throw new Error(`Jina returned ${jinaRes.status}`);
      profileData = await jinaRes.text();
    } catch (e) {
      profileData = '';
    }

    if (!profileData || profileData.length < 50) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          error: 'Could not reach Instagram. Please paste profile details manually into Content Snapshot.'
        })
      };
    }

    // Use Gemini to analyze the Instagram profile
    const ai = getGeminiClient();

    const prompt = `Analyze this Instagram profile data and extract business intelligence for a sales pitch tool.

Profile data:
${profileData.slice(0, 2000)}

Return ONLY JSON (no markdown):
{
  "businessName": "business name from profile",
  "location": "city/location if visible",
  "bio": "the bio text",
  "vibe": "2-3 sentence description of their aesthetic, content style, energy, and audience",
  "igNotes": "detailed observations about content type, posting patterns, engagement, what's missing",
  "primaryGap": "most critical gap: The \"No People\" Gap | The \"Empty Room\" Gap | The \"Product-Only\" Gap | The \"No Social Proof\" Gap | The \"Good Business, Weak Perception\" Gap | The \"No Vibe\" Gap | The \"No Target Customer\" Gap | The \"Flyer-Only Marketing\" Gap | The \"General Pitch\" Angle | The \"Low Engagement\" Gap",
  "secondaryGap": "second gap from same list",
  "followers": "follower count if visible",
  "vertical": "Restaurant | Bar/Lounge | Cafe | Beauty/Wellness | Retail | Other"
}`;

    const text = (await generateText(ai, prompt)).trim();
    const cleaned = text.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
    const data = JSON.parse(cleaned);

    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (err) {
    console.error('scrape-ig error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Could not reach Instagram. Please paste profile details manually into Content Snapshot.' })
    };
  }
};

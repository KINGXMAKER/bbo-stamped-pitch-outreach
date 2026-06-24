const { getGeminiClient, generateWithImage } = require('./shared');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { image } = JSON.parse(event.body || '{}');
    if (!image) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No image provided' }) };

    const ai = getGeminiClient();

    // Strip data URL prefix if present
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

    const prompt = `You are analyzing an Instagram profile screenshot for a sales pitch tool called BBO Stamped.

Extract ALL visible details from this screenshot and return a JSON object with these exact fields:
{
  "businessName": "the business/restaurant/venue name visible",
  "location": "city, state if visible",
  "instagram": "@handle if visible",
  "websiteUrl": "website URL if visible in bio",
  "vibe": "2-3 sentence description of their aesthetic, content style, energy level, and what type of audience they attract",
  "igNotes": "detailed observations: what content they post (food shots, lifestyle, people, events, reels, stories), posting frequency, engagement style, what's missing, overall quality",
  "primaryGap": "the single most critical content gap from this list: The \\"No People\\" Gap | The \\"Empty Room\\" Gap | The \\"Product-Only\\" Gap | The \\"No Social Proof\\" Gap | The \\"Good Business, Weak Perception\\" Gap | The \\"No Vibe\\" Gap | The \\"No Target Customer\\" Gap | The \\"Flyer-Only Marketing\\" Gap | The \\"General Pitch\\" Angle | The \\"Low Engagement\\" Gap",
  "secondaryGap": "second most critical gap from the same list",
  "vertical": "Restaurant | Bar | Lounge | Speakeasy | Cafe | Club | Other",
  "confidence": 1-10
}

Be specific and detailed. If you can't determine something, use an empty string. Return ONLY valid JSON, no markdown.`;

    const text = await generateWithImage(ai, prompt, base64Data, 'image/jpeg');
    const cleaned = text.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
    const data = JSON.parse(cleaned);

    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (err) {
    console.error('analyze-screenshot error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Screenshot analysis failed: ' + err.message })
    };
  }
};

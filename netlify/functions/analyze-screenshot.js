const {
  getGeminiClient,
  generateWithImage,
  isHardError,
  isModelUnavailable
} = require('./shared');

const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const MAX_BASE64_CHARS = 12 * 1024 * 1024; // ~9MB binary, generous headroom over the 8MB client cap

// Map any thrown error to a stable code + friendly message. Raw details stay in logs only.
function classifyError(err) {
  const msg = (err && err.message) ? err.message : '';
  if (/SUPABASE|supabaseUrl/i.test(msg)) {
    return { code: 'API_ERROR', message: 'Service is temporarily unavailable. Please try again shortly.' };
  }
  if (err && err.allModelsFailed) {
    return { code: 'MODEL_OVERLOADED', message: 'Screenshot scan is temporarily busy. Please try again in a minute or enter the details manually.' };
  }
  if (/deadline exceeded|timeout|timed out/i.test(msg)) {
    return { code: 'TIMEOUT', message: 'Screenshot scan timed out. Please try again or enter the details manually.' };
  }
  if (isModelUnavailable(err)) {
    return { code: 'API_ERROR', message: 'Screenshot scan is temporarily unavailable. Please enter the details manually.' };
  }
  if (isHardError(err)) {
    if (/API key|api_key|401|403|permission/i.test(msg)) {
      return { code: 'API_ERROR', message: 'Screenshot scan is not configured correctly. Please enter the details manually.' };
    }
    return { code: 'INVALID_IMAGE', message: 'That image could not be read. Try a clearer PNG or JPG screenshot.' };
  }
  return { code: 'API_ERROR', message: 'Screenshot scan failed. Please try again or enter the details manually.' };
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ ok: false, code: 'API_ERROR', message: 'Method not allowed' }) };
  }

  try {
    const { image } = JSON.parse(event.body || '{}');

    // --- Image validation (server-side guard) ---
    if (!image || typeof image !== 'string') {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, code: 'INVALID_IMAGE', message: 'No screenshot was received. Please upload a PNG or JPG.' }) };
    }

    const mimeMatch = image.match(/^data:(image\/[a-zA-Z+]+);base64,/);
    if (mimeMatch && !ALLOWED_MIME.includes(mimeMatch[1].toLowerCase())) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, code: 'INVALID_IMAGE', message: 'Unsupported image type. Please upload a PNG, JPG, or WEBP.' }) };
    }

    const base64Data = image.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
    if (base64Data.length > MAX_BASE64_CHARS) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, code: 'INVALID_IMAGE', message: 'That screenshot is too large. Please upload an image under 8MB.' }) };
    }
    if (base64Data.length < 100) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, code: 'INVALID_IMAGE', message: 'That image could not be read. Try a clearer screenshot.' }) };
    }

    const mimeType = (mimeMatch && mimeMatch[1]) ? mimeMatch[1] : 'image/jpeg';
    const ai = getGeminiClient();

    const prompt = `You are analyzing an Instagram profile screenshot for a pitch tool called BBO Stamped.

Your job is ONLY to observe and describe the feed so the founder can personalize a pitch. You must NOT choose a pitch angle, primary gap, or secondary gap — the founder decides that themselves.

Extract what's visible and return a JSON object with these exact fields:
{
  "businessName": "the business name visible, or empty string",
  "location": "city, state if visible, or empty string",
  "instagram": "@handle if visible, or empty string",
  "inferredBusinessType": "what kind of business this appears to be (e.g. restaurant, bar, lounge, med spa, esthetician, beauty studio, nightlife spot, brunch spot, local experience business)",
  "confidence": 1-10,
  "feedSummary": "2-3 sentences on what the feed is selling visually and what it's mostly made of",
  "visualVibe": "the aesthetic, energy level, and overall feeling — e.g. packed, empty, premium, menu-heavy, service-heavy, flyer-heavy, content-light, trust-building, or low-engagement",
  "socialProofNotes": "what social proof is or isn't present: real people, customers, tags, reactions, reviews, crowd energy",
  "contentStyleNotes": "content mix and cadence: product/food shots vs lifestyle vs reels vs stories vs flyers, posting frequency, engagement signals",
  "personalizationDetails": "specific concrete details worth referencing in a pitch (signature items, standout posts, location cues, aesthetic hooks)",
  "suggestedPitchContext": "a short read on the social-media context that could help personalize a pitch — NOT a chosen gap, just useful framing"
}

Be specific and detailed. If you can't determine something, use an empty string. Do NOT include any gap or pitch-angle selection. Return ONLY valid JSON, no markdown.`;

    const { text, modelUsed } = await generateWithImage(ai, prompt, base64Data, mimeType, { json: true });
    const cleaned = text.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();

    let data;
    try {
      data = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('[analyze-screenshot] JSON parse failed. Raw model output:', cleaned);
      return { statusCode: 502, headers, body: JSON.stringify({ ok: false, code: 'API_ERROR', message: 'Could not read the screenshot details. Please try again or enter them manually.' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, data, modelUsed }) };

  } catch (err) {
    // Full detail to server logs only.
    console.error('[analyze-screenshot] error:', err && err.stack ? err.stack : err);
    const { code, message } = classifyError(err);
    const status = code === 'INVALID_IMAGE' ? 400 : (code === 'MODEL_OVERLOADED' || code === 'TIMEOUT' ? 503 : 500);
    return { statusCode: status, headers, body: JSON.stringify({ ok: false, code, message }) };
  }
};

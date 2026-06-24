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

    const { text, modelUsed } = await generateWithImage(ai, prompt, base64Data, mimeType);
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

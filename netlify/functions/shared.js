const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

// Load environment variables for local development
try {
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    lines.forEach(line => {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const val = parts.slice(1).join('=').trim();
        process.env[key] = val;
      }
    });
  }
} catch(e) {
  console.error('Failed to load .env:', e);
}

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase is not configured on the server — missing SUPABASE_URL or SUPABASE_ANON_KEY. ' +
      'Set these env vars in the Netlify project (all contexts) and redeploy.'
    );
  }
  return createClient(url, key);
}

function getGeminiClient() {
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

function getModelName() {
  return process.env.GEMINI_MODEL_PRIMARY || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
}

// Ordered list of models to try: primary first, then fallbacks. De-duped.
function getModelChain() {
  const primary = getModelName();
  const fallbacks = (process.env.GEMINI_MODEL_FALLBACKS || 'gemini-2.5-flash-lite,gemini-2.0-flash')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
}

const TRANSIENT_CODES = ['429', '500', '502', '503', '504'];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry these — temporary overload / capacity. Backoff then fall back to next model.
function isTransientError(err) {
  const m = (err && err.message) ? err.message : '';
  return TRANSIENT_CODES.some(c => m.includes(c)) ||
    /overload|unavailable|high demand|try again later|deadline|timeout|ETIMEDOUT|ECONNRESET/i.test(m);
}

// A missing/removed model (404) is not transient, but we should still skip to the next model in the chain.
function isModelUnavailable(err) {
  const m = (err && err.message) ? err.message : '';
  return /404|not found|is not supported/i.test(m);
}

// Hard failures — never retry, never fall back. Auth, bad key, malformed request, invalid image.
function isHardError(err) {
  const m = (err && err.message) ? err.message : '';
  if (isModelUnavailable(err)) return false; // 404 handled separately (try next model)
  return /401|403|400|API key|api_key|permission|invalid argument|invalid image|unsupported/i.test(m);
}

// Core resilient caller. contentArg is whatever the SDK's generateContent accepts
// (a string for text, or a parts array for multimodal). Returns { text, modelUsed }.
// deadlineMs caps total wall-clock so we never blow past the Netlify function timeout.
async function generateContentResilient(genAI, contentArg, modelConfigExtra, deadlineMs) {
  const models = getModelChain();
  const deadline = Date.now() + (deadlineMs || 25000);
  const MAX_ATTEMPTS = 3;
  let lastErr;

  for (const modelName of models) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (Date.now() >= deadline) {
        const e = new Error(`Gemini deadline exceeded before completing. Last error: ${lastErr ? lastErr.message : 'none'}`);
        e.lastError = lastErr;
        throw e;
      }
      try {
        const model = genAI.getGenerativeModel({ model: modelName, ...(modelConfigExtra || {}) });
        const result = await model.generateContent(contentArg);
        if (attempt > 0 || modelName !== models[0]) {
          console.log(`[gemini] succeeded on ${modelName} (attempt ${attempt + 1})`);
        }
        return { text: result.response.text(), modelUsed: modelName };
      } catch (err) {
        lastErr = err;

        if (isHardError(err)) {
          console.error(`[gemini] hard error on ${modelName} — not retrying: ${err.message}`);
          throw err;
        }

        if (isTransientError(err) && attempt < MAX_ATTEMPTS - 1) {
          const backoff = 800 * Math.pow(2, attempt) + Math.floor(Math.random() * 400); // 800/1600/3200 + jitter
          if (Date.now() + backoff >= deadline) {
            console.warn(`[gemini] ${modelName} transient but no time left to retry — falling back.`);
            break;
          }
          console.warn(`[gemini] ${modelName} transient (attempt ${attempt + 1}): ${err.message}. retrying in ${backoff}ms`);
          await sleep(backoff);
          continue;
        }

        // Out of retries, or a non-transient model-availability issue — move to next model.
        console.warn(`[gemini] ${modelName} exhausted/unavailable: ${err.message}. trying next model.`);
        break;
      }
    }
  }

  const e = new Error(`All Gemini models failed. Last error: ${lastErr ? lastErr.message : 'unknown'}`);
  e.allModelsFailed = true;
  e.lastError = lastErr;
  throw e;
}

async function generateText(genAI, prompt, systemInstruction) {
  const extra = systemInstruction ? { systemInstruction } : {};
  const { text } = await generateContentResilient(genAI, prompt, extra);
  return text;
}

// Returns { text, modelUsed } so callers can report which model handled the request.
async function generateWithImage(genAI, textPrompt, base64Image, mimeType) {
  const parts = [
    { text: textPrompt },
    { inlineData: { mimeType: mimeType || 'image/jpeg', data: base64Image } }
  ];
  return generateContentResilient(genAI, parts, {});
}

async function extractVoiceProfile(supabase, genAI) {
  const { data: examples, error } = await supabase
    .from('pitch_examples').select('*').order('created_at', { ascending: false });
  if (error) throw new Error('Failed to fetch pitch examples: ' + error.message);
  if (!examples || examples.length === 0) return { profile: null, count: 0 };

  const { data: corrections } = await supabase
    .from('pitch_history')
    .select('channel, ai_draft, final_sent, edit_diff')
    .neq('edit_diff', 'No changes made').neq('edit_diff', 'Failed to compute diff')
    .is('edit_diff', 'not.null').order('created_at', { ascending: false }).limit(10);

  const formattedExamples = examples.map((e, i) => `Example #${i + 1}
Channel: ${e.channel}
Venue Type: ${e.venue_type || 'Unknown'}
Gap Type: ${e.gap_type || 'Unknown'}
Outcome: ${e.outcome || 'Unknown'}
Outcome Score: ${e.outcome_score || 50}
Message content:\n"""\n${e.content}\n"""`).join('\n\n---\n\n');

  let correctionsText = '';
  if (corrections && corrections.length > 0) {
    correctionsText = `\n\nRecent Correction Signals:\n` +
      corrections.map((c, i) => `Correction #${i+1} (${c.channel}):\n- Edit: "${c.edit_diff}"\n- Draft: "${c.ai_draft}"\n- Sent: "${c.final_sent}"`).join('\n\n');
  }

  const systemInstruction = `You are a linguistic analyst. Analyze outreach pitches and extract a structured Voice Profile JSON. Return ONLY raw JSON — no markdown, no backticks.
{
  "tone": "...",
  "opener_style": "...",
  "sentence_structure": "...",
  "vocabulary_preferences": ["..."],
  "forbidden_phrases": ["..."],
  "signature_moves": ["..."],
  "dm_structure": "...",
  "email_structure": "...",
  "emotional_register": "..."
}`;

  const text = await generateText(genAI, `Analyze these pitches and extract the Voice Profile JSON:\n\n${formattedExamples}${correctionsText}`, systemInstruction);
  const cleaned = text.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
  const profileData = JSON.parse(cleaned);

  const { data: insertedData, error: insertError } = await supabase
    .from('voice_profiles')
    .insert({ profile_data: profileData, example_count: examples.length, last_refreshed: new Date().toISOString() })
    .select().single();
  if (insertError) throw new Error('Failed to save voice profile: ' + insertError.message);

  return { profile: insertedData, count: examples.length };
}

async function updatePitchHistoryAndExtractCorrections(supabase, genAI, historyId, finalSent) {
  const { data: historyRow, error: fetchErr } = await supabase
    .from('pitch_history').select('*').eq('id', historyId).single();
  if (fetchErr || !historyRow) throw new Error('Failed to fetch pitch history: ' + (fetchErr?.message || 'not found'));

  const aiDraft = historyRow.ai_draft;
  let editDiff = 'No changes made';

  if (aiDraft && finalSent && aiDraft.trim() !== finalSent.trim()) {
    try {
      const systemInstruction = `You are a linguistic coach. Extract 1-3 concise correction signals (max 15 words each) as a bulleted list explaining what style changes the user preferred.`;
      editDiff = await generateText(genAI, `AI Draft:\n"""\n${aiDraft}\n"""\n\nUser Sent:\n"""\n${finalSent}\n"""\n\nCorrection Signals:`, systemInstruction);
    } catch (e) {
      editDiff = 'Failed to compute diff';
    }
  }

  const { data: updatedHistory, error: updateErr } = await supabase
    .from('pitch_history')
    .update({ final_sent: finalSent, edit_diff: editDiff, outcome: 'pending', outcome_score: 50 })
    .eq('id', historyId).select().single();
  if (updateErr) throw new Error('Failed to update pitch history: ' + updateErr.message);

  return updatedHistory;
}

async function getMatchingExamples(supabase, channel, venueType, gapType) {
  let results = [];
  const fetchMore = async (filters, limit) => {
    const excl = results.map(r => r.id);
    let q = supabase.from('pitch_examples').select('*').eq('channel', channel);
    filters.forEach(([k, v]) => { if (v) q = q.eq(k, v); });
    if (excl.length) q = q.not('id', 'in', `(${excl.join(',')})`);
    const { data } = await q.order('outcome_score', { ascending: false }).limit(limit);
    if (data) results = results.concat(data);
  };

  if (venueType && gapType) await fetchMore([['venue_type', venueType], ['gap_type', gapType]], 3);
  if (results.length < 3) await fetchMore([['gap_type', gapType]], 3 - results.length);
  if (results.length < 3) await fetchMore([['venue_type', venueType]], 3 - results.length);
  if (results.length < 3) await fetchMore([], 3 - results.length);

  return results;
}

module.exports = {
  getSupabaseClient,
  getGeminiClient,
  getModelName,
  getModelChain,
  generateText,
  generateWithImage,
  generateContentResilient,
  isTransientError,
  isModelUnavailable,
  isHardError,
  extractVoiceProfile,
  getMatchingExamples,
  updatePitchHistoryAndExtractCorrections
};

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
        // Don't clobber vars already set by the platform/shell — those take precedence.
        if (process.env[key] === undefined) process.env[key] = val;
      }
    });
  }
} catch(e) {
  console.error('Failed to load .env:', e);
}

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase is not configured on the server — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
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
// An optional primaryOverride is prepended (the regular chain becomes its fallback).
function getModelChain(primaryOverride) {
  const primary = getModelName();
  const fallbacks = (process.env.GEMINI_MODEL_FALLBACKS || 'gemini-2.5-flash-lite,gemini-2.0-flash')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const chain = primaryOverride ? [primaryOverride, primary, ...fallbacks] : [primary, ...fallbacks];
  return [...new Set(chain)];
}

const TRANSIENT_CODES = ['429', '500', '502', '503', '504'];
const HARD_CODES = ['400', '401', '403'];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// The Gemini SDK renders HTTP errors as "[NNN Reason] ...", e.g. "[429 Too Many Requests]".
// Anchor on that bracketed form instead of a bare substring search — a naive `.includes('400')`
// can false-positive on unrelated 3-digit numbers elsewhere in the message (a retry-delay like
// "2.199104009s" contains "400" and was misclassifying transient 429 quota errors as hard errors).
function getStatusCode(err) {
  const m = (err && err.message) ? err.message : '';
  const match = m.match(/\[(\d{3})[\s\]]/);
  return match ? match[1] : null;
}

// Retry these — temporary overload / capacity. Backoff then fall back to next model.
// Includes SDK-level request-timeout aborts ("This operation was aborted") — the
// @google/generative-ai SDK implements its `timeout` option via AbortController, and an
// abort is functionally identical to a timeout: worth retrying, not a reason to give up.
function isTransientError(err) {
  const m = (err && err.message) ? err.message : '';
  const code = getStatusCode(err);
  return (code && TRANSIENT_CODES.includes(code)) ||
    /overload|unavailable|high demand|try again later|deadline|timeout|ETIMEDOUT|ECONNRESET|aborted|AbortError/i.test(m);
}

// A missing/removed model (404) is not transient, but we should still skip to the next model in the chain.
function isModelUnavailable(err) {
  const code = getStatusCode(err);
  const m = (err && err.message) ? err.message : '';
  return code === '404' || /not found|is not supported/i.test(m);
}

// Hard failures — never retry, never fall back. Auth, bad key, malformed request, invalid image.
function isHardError(err) {
  if (isModelUnavailable(err)) return false; // 404 handled separately (try next model)
  const code = getStatusCode(err);
  const m = (err && err.message) ? err.message : '';
  return (code && HARD_CODES.includes(code)) ||
    /API key|api_key|permission|invalid argument|invalid image|unsupported/i.test(m);
}

// Rate-limit / quota (429). On the FREE tier each model has its OWN per-minute quota bucket,
// so the right move is to skip straight to the NEXT model (separate bucket) rather than retry
// the same one — our sub-4s backoffs can't outwait a per-minute reset and just burn more quota.
function isQuotaError(err) {
  const m = (err && err.message) ? err.message : '';
  return getStatusCode(err) === '429' || /quota|rate.?limit|too many requests|resource_exhausted/i.test(m);
}

// Cross-provider fallback: NVIDIA NIM (OpenAI-compatible, free tier).
// Text-only — fires when every Gemini model in the chain has failed.
async function generateWithNvidia(prompt, systemInstruction, timeoutMs) {
  const key = process.env.NVIDIA_API_KEY;
  const model = process.env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
          { role: 'user', content: prompt }
        ],
        temperature: 0.6,
        max_tokens: 4096,
        stream: false
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`NVIDIA fallback returned ${res.status}: ${detail}`);
    }
    const data = await res.json();
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) throw new Error('NVIDIA fallback returned an empty response');
    console.log(`[nvidia] fallback succeeded on ${model}`);
    return { text, modelUsed: `nvidia:${model}` };
  } finally {
    clearTimeout(timer);
  }
}

// Core resilient caller. contentArg is whatever the SDK's generateContent accepts
// (a string for text, or a parts array for multimodal). Returns { text, modelUsed }.
// deadlineMs caps total wall-clock so we never blow past the Netlify function timeout.
// opts:
//   json              — force valid JSON output (Gemini responseMimeType)
//   primaryModel      — prepend this model; the regular chain becomes its fallback
//   primaryTimeoutMs  — cap the primary's request time so fallbacks still fit in the deadline
//   primaryMaxAttempts— attempts allowed for the primary (default: same as fallbacks)
async function generateContentResilient(genAI, contentArg, modelConfigExtra, deadlineMs, opts) {
  opts = opts || {};
  const models = getModelChain(opts.primaryModel);
  const deadline = Date.now() + (deadlineMs || 25000);
  const MAX_ATTEMPTS = 3;
  let lastErr;

  const config = { ...(modelConfigExtra || {}) };
  if (opts.json) {
    config.generationConfig = { ...(config.generationConfig || {}), responseMimeType: 'application/json' };
  }

  // Below this, a request is essentially guaranteed to abort before Gemini can respond —
  // don't bother issuing it, just move on (next attempt/model/NVIDIA/give up).
  const MIN_REQUEST_TIMEOUT_MS = 3000;

  for (const modelName of models) {
    const isPrimary = modelName === models[0];
    const attemptsAllowed = (isPrimary && opts.primaryMaxAttempts) ? opts.primaryMaxAttempts : MAX_ATTEMPTS;
    for (let attempt = 0; attempt < attemptsAllowed; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_REQUEST_TIMEOUT_MS) {
        console.warn(`[gemini] ${modelName} skipped — only ${remaining}ms left in budget (floor is ${MIN_REQUEST_TIMEOUT_MS}ms).`);
        break;
      }
      const attemptStart = Date.now();
      // Per-request timeout: never let one slow call eat the whole deadline.
      const reqTimeout = (isPrimary && opts.primaryTimeoutMs) ? Math.min(remaining, opts.primaryTimeoutMs) : remaining;
      console.log(`[gemini] → ${modelName} attempt ${attempt + 1}/${attemptsAllowed}, timeout=${reqTimeout}ms, budget left=${remaining}ms`);
      try {
        const model = genAI.getGenerativeModel({ model: modelName, ...config }, { timeout: reqTimeout });
        const result = await model.generateContent(contentArg);
        console.log(`[gemini] ✓ ${modelName} responded in ${Date.now() - attemptStart}ms (attempt ${attempt + 1})`);
        return { text: result.response.text(), modelUsed: modelName };
      } catch (err) {
        const elapsed = Date.now() - attemptStart;
        lastErr = err;

        if (isHardError(err)) {
          console.error(`[gemini] ✗ hard error on ${modelName} after ${elapsed}ms — not retrying: ${err.message}`);
          throw err;
        }

        // Quota/429: don't retry THIS model (separate free-tier bucket per model) — jump to the
        // next model immediately. This turns the fallback chain into free-tier quota spreading.
        if (isQuotaError(err)) {
          console.warn(`[gemini] ✗ ${modelName} quota/429 after ${elapsed}ms — skipping to next model (separate quota bucket).`);
          break;
        }

        if (isTransientError(err) && attempt < attemptsAllowed - 1) {
          const backoff = 800 * Math.pow(2, attempt) + Math.floor(Math.random() * 400); // 800/1600/3200 + jitter
          if (Date.now() + backoff >= deadline) {
            console.warn(`[gemini] ✗ ${modelName} transient after ${elapsed}ms but no time left to retry — falling back.`);
            break;
          }
          console.warn(`[gemini] ✗ ${modelName} transient after ${elapsed}ms (attempt ${attempt + 1}): ${err.message}. retrying in ${backoff}ms`);
          await sleep(backoff);
          continue;
        }

        // Out of retries, or a non-transient model-availability issue — move to next model.
        console.warn(`[gemini] ✗ ${modelName} exhausted/unavailable after ${elapsed}ms: ${err.message}. trying next model.`);
        break;
      }
    }
  }

  // Last rung: cross-provider NVIDIA fallback (text prompts only).
  const remaining = deadline - Date.now();
  if (process.env.NVIDIA_API_KEY && typeof contentArg === 'string' && remaining > 3000) {
    try {
      console.warn('[gemini] all Gemini models failed — trying NVIDIA fallback');
      const systemInstruction = (modelConfigExtra && modelConfigExtra.systemInstruction) || null;
      return await generateWithNvidia(contentArg, systemInstruction, remaining);
    } catch (nvErr) {
      console.error('[nvidia] fallback failed:', nvErr.message);
      lastErr = nvErr;
    }
  }

  const e = new Error(`All Gemini models failed. Last error: ${lastErr ? lastErr.message : 'unknown'}`);
  e.allModelsFailed = true;
  e.lastError = lastErr;
  throw e;
}

async function generateText(genAI, prompt, systemInstruction, opts) {
  const extra = systemInstruction ? { systemInstruction } : {};
  const { text } = await generateContentResilient(genAI, prompt, extra, opts && opts.deadlineMs, opts);
  return text;
}

// Returns { text, modelUsed } so callers can report which model handled the request.
async function generateWithImage(genAI, textPrompt, base64Image, mimeType, opts) {
  const parts = [
    { text: textPrompt },
    { inlineData: { mimeType: mimeType || 'image/jpeg', data: base64Image } }
  ];
  return generateContentResilient(genAI, parts, {}, opts && opts.deadlineMs, opts);
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

  const text = await generateText(genAI, `Analyze these pitches and extract the Voice Profile JSON:\n\n${formattedExamples}${correctionsText}`, systemInstruction, { json: true });
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
  // Outcome does not matter — the AI copies the user's voice from ALL of their
  // examples. We surface the most relevant ones first (matching gap/venue), then
  // fill with the most recent examples so the voice stays current. Ordering is by
  // recency, never by outcome score.
  // Capped at 3 (was 6): injecting fewer, more relevant examples keeps the prompt
  // small enough that generation reliably finishes inside the function timeout.
  const TARGET = 3;
  let results = [];
  const fetchMore = async (filters, limit) => {
    if (limit <= 0) return;
    const excl = results.map(r => r.id);
    let q = supabase.from('pitch_examples').select('*').eq('channel', channel);
    filters.forEach(([k, v]) => { if (v) q = q.eq(k, v); });
    if (excl.length) q = q.not('id', 'in', `(${excl.join(',')})`);
    const { data } = await q.order('created_at', { ascending: false }).limit(limit);
    if (data) results = results.concat(data);
  };

  if (gapType) await fetchMore([['gap_type', gapType]], TARGET);
  if (venueType) await fetchMore([['venue_type', venueType]], TARGET - results.length);
  await fetchMore([], TARGET - results.length);

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
  isQuotaError,
  extractVoiceProfile,
  getMatchingExamples,
  updatePitchHistoryAndExtractCorrections
};

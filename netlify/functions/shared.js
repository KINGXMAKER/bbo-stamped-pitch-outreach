const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const aiConfig = require('./ai/config');
const aiRouter = require('./ai/router');
const { isTransientError, isModelUnavailable, isHardError, isQuotaError } = require('./ai/errors');

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

// Primary Gemini model for the current routing config (first non-disabled Gemini candidate).
function getModelName() {
  const first = aiConfig.getRoute().find(c => c.provider === 'gemini' && !c.disabled);
  return first ? first.model : 'gemini-3.5-flash-lite';
}

// Ordered Gemini models normal traffic may use: primary first, then fallbacks. Disabled models excluded.
// An optional primaryOverride is prepended (the regular chain becomes its fallback).
function getModelChain(primaryOverride) {
  return aiConfig.getRoute(primaryOverride).filter(c => c.provider === 'gemini' && !c.disabled).map(c => c.model);
}

// Core resilient caller — delegates to the deadline-bounded, circuit-aware router (ai/router.js).
// contentArg is a string (text) or a parts array (multimodal). Returns { text, modelUsed, provider, usage, estCostUsd }.
// opts: json, primaryModel, generationId, task, trace, budget, noTokenCap.
async function generateContentResilient(genAI, contentArg, modelConfigExtra, deadlineMs, opts) {
  return aiRouter.generate(genAI, contentArg, modelConfigExtra, deadlineMs, opts);
}

async function generateText(genAI, prompt, systemInstruction, opts) {
  const extra = systemInstruction ? { systemInstruction } : {};
  const { text, modelUsed } = await generateContentResilient(genAI, prompt, extra, opts && opts.deadlineMs, opts);
  // Let callers observe which model actually answered (for operational metadata/logs).
  if (opts && typeof opts.onModel === 'function') { try { opts.onModel(modelUsed); } catch (e) {} }
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

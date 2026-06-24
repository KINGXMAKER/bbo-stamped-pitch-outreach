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
  return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
}

function getModel(genAI) {
  const modelName = getModelName();
  return genAI.getGenerativeModel({ model: modelName });
}

async function generateText(genAI, prompt, systemInstruction) {
  const modelName = getModelName();
  try {
    const model = genAI.getGenerativeModel({
      model: modelName,
      ...(systemInstruction ? { systemInstruction } : {})
    });
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    if (err.message && (err.message.includes('404') || err.message.includes('not found'))) {
      throw new Error(`Gemini model "${modelName}" unavailable — check GEMINI_MODEL env var. Original: ${err.message}`);
    }
    throw err;
  }
}

async function generateWithImage(genAI, textPrompt, base64Image, mimeType) {
  const modelName = getModelName();
  try {
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent([
      { text: textPrompt },
      { inlineData: { mimeType: mimeType || 'image/jpeg', data: base64Image } }
    ]);
    return result.response.text();
  } catch (err) {
    if (err.message && (err.message.includes('404') || err.message.includes('not found'))) {
      throw new Error(`Gemini model "${modelName}" unavailable — check GEMINI_MODEL env var. Original: ${err.message}`);
    }
    throw err;
  }
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
  generateText,
  generateWithImage,
  extractVoiceProfile,
  getMatchingExamples,
  updatePitchHistoryAndExtractCorrections
};

'use strict';
// Persists one logical record per pitch-generation request (pitch_generations) and its provider
// attempts (pitch_generation_attempts). Written to degrade gracefully: until the migration
// supabase/migrations/20260917_pitch_generations.sql is applied, every call is a no-op and pitch
// generation behaves exactly as before. Nothing here may throw into, or noticeably slow, a request.

const { scrub } = require('./errors');

const MISSING_CODES = new Set(['42P01', 'PGRST205', 'PGRST204', '42703']);
let tablesAvailable = true;

const isMissing = (error) => !!error && (MISSING_CODES.has(error.code) || /does not exist|could not find/i.test(error.message || ''));

function disableIfMissing(error, where) {
  if (!isMissing(error)) return false;
  if (tablesAvailable) console.warn(`[generation-log] ${where}: tables/columns missing — apply supabase/migrations/20260917_pitch_generations.sql. Generation logging disabled for this instance.`);
  tablesAvailable = false;
  return true;
}

const withTimeout = (promise, ms) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve({ error: { message: 'timeout' } }), ms))]);

// Returns a small handle. start() is fire-and-forget so generation begins immediately; finish() awaits.
function createGenerationLog(supabase, { generationId, businessName, fastMode, payload }) {
  let created = Promise.resolve(false);
  const available = () => tablesAvailable;

  return {
    start() {
      if (!available()) return;
      created = (async () => {
        const { error } = await withTimeout(supabase.from('pitch_generations').insert({
          generation_id: generationId, status: 'pending', business_name: businessName || null,
          fast_mode: !!fastMode, request_payload: payload,
        }), 3000);
        if (error) { if (!disableIfMissing(error, 'create')) console.warn('[generation-log] create failed:', scrub(error.message)); return false; }
        const upd = await withTimeout(supabase.from('pitch_generations')
          .update({ status: 'generating', started_at: new Date().toISOString() }).eq('generation_id', generationId), 3000);
        if (upd.error) console.warn('[generation-log] generating update failed:', scrub(upd.error.message));
        return true;
      })().catch(() => false);
    },

    // True once the parent row exists — pitch_history.generation_id has an FK to it.
    async isCreated() { return created; },

    async finish({ status, summary, latencyMs, compact, fallbackUsed, error, finalPitch, attempts }) {
      if (!(await created)) return;
      const updates = {
        status,
        provider_used: summary.providerUsed, model_used: summary.modelUsed, attempts_count: summary.attemptsCount,
        input_tokens: summary.inputTokens, output_tokens: summary.outputTokens, estimated_cost_usd: summary.estimatedCostUsd,
        latency_ms: latencyMs, compact: !!compact, fallback_used: !!fallbackUsed,
        error_code: error ? String(error.code || error.errorClass || error.failureKind || 'error') : null,
        error_message: error ? scrub(error.message) : null,
        final_pitch: finalPitch || null,
        completed_at: new Date().toISOString(),
      };
      const rows = (attempts || []).map(a => ({
        generation_id: generationId, attempt_number: a.attempt, task: a.task, provider: a.provider, model: a.model,
        status: a.status, window_ms: a.windowMs || null, latency_ms: a.latencyMs || 0, error_code: a.errorCode || null,
        error_class: a.errorClass || null, error_message: a.errorMessage || null, fallback_reason: a.fallbackReason || null,
        input_tokens: a.inputTokens || null, output_tokens: a.outputTokens || null, estimated_cost_usd: a.estCostUsd || null,
        started_at: a.startedAt || null, completed_at: a.completedAt || null,
      }));
      const [u, i] = await Promise.all([
        withTimeout(supabase.from('pitch_generations').update(updates).eq('generation_id', generationId), 2500),
        rows.length ? withTimeout(supabase.from('pitch_generation_attempts').insert(rows), 2500) : Promise.resolve({}),
      ]);
      if (u.error && !disableIfMissing(u.error, 'finish')) console.warn('[generation-log] finish failed:', scrub(u.error.message));
      if (i.error && !disableIfMissing(i.error, 'attempts')) console.warn('[generation-log] attempts insert failed:', scrub(i.error.message));
    },
  };
}

// Inserts both channel rows in ONE request (atomic: both or neither). Adds generation_id when the
// column exists and the parent generation row was created; otherwise falls back to the old shape.
async function insertPitchHistoryRows(supabase, rows, generationId, log) {
  const linked = tablesAvailable && generationId && (await log.isCreated());
  const attempt = async (withId) => supabase.from('pitch_history')
    .insert(rows.map(r => (withId ? { ...r, generation_id: generationId } : r)))
    .select('id, channel');
  let { data, error } = await attempt(linked);
  if (error && linked && disableIfMissing(error, 'pitch_history.generation_id')) ({ data, error } = await attempt(false));
  if (error) throw error;
  const idFor = (channel) => ((data || []).find(r => r.channel === channel) || {}).id || null;
  return { dm: idFor('dm'), email: idFor('email') };
}

module.exports = { createGenerationLog, insertPitchHistoryRows, _resetForTests: () => { tablesAvailable = true; } };

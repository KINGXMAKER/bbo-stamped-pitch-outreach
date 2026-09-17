'use strict';
// Authoritative daily AI spend: summed from persisted pitch_generations rows (UTC day), not from the
// shared runtime store, which loses concurrent increments. Cached briefly per instance so it costs at
// most one small query a minute. Returns null when the table is unreachable, so callers can fall back.

const CACHE_TTL_MS = 60 * 1000;
const QUERY_TIMEOUT_MS = 1500;
let cache = { date: null, usd: null, at: 0 };

const utcDayStart = () => `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;

async function getDailySpendUsd(supabase, { fresh = false } = {}) {
  const date = utcDayStart().slice(0, 10);
  if (!fresh && cache.date === date && Date.now() - cache.at < CACHE_TTL_MS) return cache.usd;
  try {
    const query = supabase.from('pitch_generations').select('estimated_cost_usd').gte('created_at', utcDayStart());
    const { data, error } = await Promise.race([
      query, new Promise(resolve => setTimeout(() => resolve({ error: { message: 'timeout' } }), QUERY_TIMEOUT_MS)),
    ]);
    if (error) throw new Error(error.message);
    const usd = +(data || []).reduce((sum, r) => sum + Number(r.estimated_cost_usd || 0), 0).toFixed(6);
    cache = { date, usd, at: Date.now() };
    return usd;
  } catch (e) {
    console.warn(`[ai-spend] daily spend query failed (${e.message}) — daily budget check uses in-request spend only`);
    return null;
  }
}

module.exports = { getDailySpendUsd, _resetForTests: () => { cache = { date: null, usd: null, at: 0 }; } };

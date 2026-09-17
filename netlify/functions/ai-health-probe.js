'use strict';
// Scheduled (netlify.toml) health prober. Normal traffic never touches OPEN / PROBING models; this is
// the only path that restores them, after cooldown, with consecutive successful lightweight probes.
// Disabled models (AI_DISABLED_MODELS, e.g. gemini-3.8-flash) are probed on a slower interval for
// telemetry only — a passing probe NEVER puts them back into production routing.

const { getGeminiClient } = require('./shared');
const config = require('./ai/config');
const circuit = require('./ai/circuit');
const { callCandidate } = require('./ai/providers');
const { errorCodeOf, scrub } = require('./ai/errors');
const { initAiRequest, finishAiRequest } = require('./ai/request-context');

const PROBE_TIMEOUT_MS = 8000;
const PROBE_PROMPT = 'Health check. Reply with exactly {"ok":true}';

async function probe(genAI, candidate) {
  const t0 = Date.now();
  try {
    const out = await callCandidate(candidate, { genAI, contentArg: PROBE_PROMPT, modelConfigExtra: {}, json: true, maxOutputTokens: 20, timeoutMs: PROBE_TIMEOUT_MS });
    return { ok: /"ok"\s*:\s*true/.test(out.text), latencyMs: Date.now() - t0, errorCode: null, usage: out.usage };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, errorCode: errorCodeOf(err), error: scrub(err.message, 200) };
  }
}

exports.handler = async (event) => {
  initAiRequest(event);
  await circuit.load({ force: true });
  const cfg = config.getCircuitConfig();
  const now = Date.now();
  const genAI = getGeminiClient();
  const results = [];

  for (const candidate of config.getProbeTargets()) {
    const entry = circuit.get(candidate.key);
    const due = candidate.disabled
      ? now - circuit.lastProbeAt(candidate.key) >= cfg.disabledProbeIntervalMs
      : circuit.isDueForProbe(entry, now);
    if (!due) continue;
    // A price-less non-Gemini model is never probed (no cost ceiling).
    if (candidate.price === null && candidate.provider !== 'gemini') continue;

    const r = await probe(genAI, candidate);
    circuit.recordProbe(candidate.key, r.ok, r.errorCode, r.latencyMs);
    const after = circuit.get(candidate.key);
    const line = { key: candidate.key, disabled: candidate.disabled, ok: r.ok, latencyMs: r.latencyMs, errorCode: r.errorCode,
      stateBefore: entry ? entry.state : 'HEALTHY', stateAfter: after ? after.state : 'HEALTHY', error: r.error };
    console.log('[ai-probe] ' + JSON.stringify(line));
    results.push(line);
  }

  await finishAiRequest(2000);
  return { statusCode: 200, body: JSON.stringify({ probed: results.length, results, store: circuit.storeKind() }) };
};

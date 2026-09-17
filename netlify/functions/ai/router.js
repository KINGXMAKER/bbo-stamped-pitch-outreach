'use strict';
// Deadline-bounded, circuit-aware model router.
//
// Rules:
//   * One total deadline per call. Each candidate gets a BOUNDED window:
//       window = min(slotCap, remaining - reserve for the next candidate)
//     so no single model can consume the whole request deadline.
//   * No same-model retries by default: a 429 / 503 / timeout fails over immediately.
//   * Models whose circuit is OPEN/PROBING or that are disabled are skipped without a network call.
//   * Paid-rate cost is estimated before each attempt and enforced against per-call / daily ceilings.
//   * Every attempt is logged as one structured line and appended to opts.trace.attempts.

const config = require('./config');
const circuit = require('./circuit');
const { callCandidate } = require('./providers');
const { classifyError, errorCodeOf, failureKindOf, FAILURE_RANK, scrub } = require('./errors');

const CHARS_PER_TOKEN = 4;
// Headroom on top of the next candidate's minimum window, so timer overhead can't push it below the floor.
const RESERVE_SLACK_MS = 100;

function estimateInputTokens(contentArg, modelConfigExtra) {
  const sys = modelConfigExtra && modelConfigExtra.systemInstruction;
  const text = typeof contentArg === 'string'
    ? contentArg
    : (contentArg || []).map(p => p.text || '').join(' ');
  const imageTokens = typeof contentArg === 'string' ? 0 : (contentArg || []).filter(p => p.inlineData).length * 1300;
  return Math.ceil(((text || '').length + (typeof sys === 'string' ? sys.length : 0)) / CHARS_PER_TOKEN) + imageTokens;
}

const costOf = (price, inputTokens, outputTokens) =>
  price ? (inputTokens * price[0] + outputTokens * price[1]) / 1e6 : 0;

// Fail-safe when every circuit is open: try ONE candidate — the one that opened longest ago — rather
// than failing instantly. Its result feeds the breaker like a probe.
function pickFailSafe(candidates) {
  return [...candidates].sort((a, b) => ((circuit.get(a.key) || {}).openedAt || 0) - ((circuit.get(b.key) || {}).openedAt || 0))[0];
}

function logAttempt(record) {
  console.log('[ai-attempt] ' + JSON.stringify(record));
}

async function generate(genAI, contentArg, modelConfigExtra, deadlineMs, opts) {
  opts = opts || {};
  const cfg = config.getRouterConfig();
  const trace = opts.trace || { attempts: [] };
  const budget = opts.budget || { maxUsd: cfg.maxCostPerPitchUsd, spentUsd: 0 };
  const task = opts.task || 'generate';
  const startedAt = Date.now();
  const deadline = startedAt + (deadlineMs || 25000);
  const isText = typeof contentArg === 'string';
  const maxOutputTokens = opts.noTokenCap ? 0 : cfg.maxOutputTokens;
  const inputEstimate = estimateInputTokens(contentArg, modelConfigExtra);

  await circuit.load();

  const route = config.getRoute(opts.primaryModel).filter(c => isText || c.supportsImages);
  const skipped = [];
  let candidates = [];
  for (const c of route) {
    if (c.disabled) skipped.push([c, 'disabled']);
    else if (!circuit.isRoutable(circuit.get(c.key))) skipped.push([c, `circuit_${(circuit.get(c.key) || {}).state}`]);
    else candidates.push(c);
  }
  let failSafe = false;
  if (!candidates.length) {
    const openOnes = route.filter(c => !c.disabled);
    if (openOnes.length) { candidates = [pickFailSafe(openOnes)]; failSafe = true; }
  }

  const record = (c, fields) => {
    const completedAt = new Date();
    const r = {
      generationId: opts.generationId || null, task, attempt: trace.attempts.length + 1,
      provider: c.provider, model: c.model, ...fields,
      startedAt: new Date(completedAt.getTime() - (fields.latencyMs || 0)).toISOString(),
      completedAt: completedAt.toISOString(),
    };
    trace.attempts.push(r);
    logAttempt(r);
    return r;
  };
  for (const [c, reason] of skipped) record(c, { status: 'skipped', fallbackReason: reason, latencyMs: 0 });

  let best = null;          // most actionable failure { err, errorClass, model }
  let prevFailure = null;   // why we moved on from the previous candidate
  const blockedProviders = new Set();

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const reasonPrefix = failSafe ? 'all_circuits_open' : prevFailure;
    if (blockedProviders.has(c.provider)) {
      record(c, { status: 'skipped', fallbackReason: `provider_blocked:${reasonPrefix}`, latencyMs: 0 });
      continue;
    }

    const remaining = deadline - Date.now();
    const hasNext = i < candidates.length - 1;
    const windows = opts.attemptWindowsMs || cfg.attemptWindowsMs;
    const cap = windows[i] !== undefined ? windows[i] : Infinity;
    let windowMs = Math.min(cap, hasNext ? remaining - cfg.minAttemptMs - RESERVE_SLACK_MS : remaining);
    if (windowMs < cfg.minAttemptMs) windowMs = Math.min(cap, remaining); // next can't fit anyway
    if (windowMs < cfg.minAttemptMs) {
      record(c, { status: 'skipped', fallbackReason: 'insufficient_budget', windowMs: Math.max(0, remaining), latencyMs: 0 });
      continue;
    }

    const worstCaseUsd = costOf(c.price, inputEstimate, maxOutputTokens || 4096);
    if (c.price === null && c.provider !== 'gemini') {
      record(c, { status: 'skipped', fallbackReason: 'no_price_ceiling', latencyMs: 0 });
      continue;
    }
    if (budget.spentUsd + worstCaseUsd > budget.maxUsd) {
      record(c, { status: 'skipped', fallbackReason: `cost_ceiling(${budget.maxUsd})`, estCostUsd: +worstCaseUsd.toFixed(6), latencyMs: 0 });
      continue;
    }
    if (worstCaseUsd > 0 && circuit.spentTodayUsd() + worstCaseUsd > cfg.dailyBudgetUsd) {
      record(c, { status: 'skipped', fallbackReason: `daily_budget(${cfg.dailyBudgetUsd})`, latencyMs: 0 });
      continue;
    }

    for (let retry = 0; retry <= cfg.sameModelRetries; retry++) {
      const t0 = Date.now();
      const timeoutMs = Math.min(windowMs, deadline - t0);
      if (timeoutMs < cfg.minAttemptMs) break;
      try {
        const out = await callCandidate(c, { genAI, contentArg, modelConfigExtra, json: !!opts.json, maxOutputTokens, timeoutMs });
        const latencyMs = Date.now() - t0;
        const estCostUsd = costOf(c.price, out.usage.inputTokens, out.usage.outputTokens);
        budget.spentUsd += estCostUsd;
        circuit.addSpend(estCostUsd);
        if (failSafe) circuit.recordProbe(c.key, true, null, latencyMs); else circuit.recordSuccess(c.key);
        record(c, { status: 'success', windowMs: timeoutMs, latencyMs, fallbackReason: reasonPrefix || null,
          inputTokens: out.usage.inputTokens, outputTokens: out.usage.outputTokens, estCostUsd: +estCostUsd.toFixed(6) });
        console.log('[ai-call] ' + JSON.stringify({ generationId: opts.generationId || null, task, status: 'success',
          provider: c.provider, model: c.model, attempts: trace.attempts.length, totalLatencyMs: Date.now() - startedAt }));
        return {
          text: out.text,
          modelUsed: c.provider === 'gemini' ? c.model : `${c.provider}:${c.model}`,
          provider: c.provider,
          usage: out.usage,
          estCostUsd,
        };
      } catch (err) {
        const latencyMs = Date.now() - t0;
        const errorClass = classifyError(err);
        const errorCode = errorCodeOf(err);
        if (failSafe) circuit.recordProbe(c.key, false, errorCode, latencyMs);
        else circuit.recordFailure(c.key, errorClass, errorCode);
        record(c, { status: 'failed', windowMs: timeoutMs, latencyMs, errorCode, errorClass,
          errorMessage: scrub(err.message, 300), fallbackReason: reasonPrefix || null });
        if (!best || FAILURE_RANK[errorClass] > FAILURE_RANK[best.errorClass]) best = { err, errorClass, model: c.model };
        prevFailure = `${c.model}:${errorClass}${/^\d{3}$/.test(errorCode) ? ':' + errorCode : ''}`;

        // Auth / malformed request: other models on the SAME provider share the key and request shape.
        if (errorClass === 'auth' || errorClass === 'bad_request') { blockedProviders.add(c.provider); break; }
        // Only a transient 5xx/network blip is worth one short same-model retry, and only if configured.
        const retryable = errorClass === 'transient' || errorClass === 'network';
        if (!retryable || retry >= cfg.sameModelRetries || deadline - Date.now() < windowMs + cfg.minAttemptMs) break;
      }
    }
  }

  const errorClass = best ? best.errorClass : 'other';
  // Config/input problems keep their original error so callers' isHardError()/classifiers still work.
  if (best && (errorClass === 'auth' || errorClass === 'bad_request')) throw best.err;

  const tried = trace.attempts.filter(a => a.task === task).map(a => `${a.model}(${a.status})`).join(', ');
  const e = new Error(
    `All AI models failed (tried ${tried || 'none'}). ` +
    `Most actionable failure — ${errorClass}${best ? ` on ${best.model}` : ''}: ${best ? scrub(best.err.message, 300) : 'no routable model within the deadline'}`
  );
  e.allModelsFailed = true;
  e.failureKind = failureKindOf(errorClass);
  e.errorClass = errorClass;
  e.actionableError = best ? best.err : null;
  console.warn('[ai-call] ' + JSON.stringify({ generationId: opts.generationId || null, task, status: 'failed',
    errorClass, attempts: trace.attempts.length, totalLatencyMs: Date.now() - startedAt }));
  throw e;
}

module.exports = { generate, estimateInputTokens };

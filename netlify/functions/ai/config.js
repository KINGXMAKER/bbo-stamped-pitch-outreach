'use strict';
// Central AI routing configuration. Everything is env-driven so production routing can change with
// an env edit + redeploy, never a code change. Nothing here reads or returns secret VALUES — only
// whether a key is present.

// USD per 1M tokens [input, output]. Gemini paid-tier list prices from
// ai.google.dev/gemini-api/docs/pricing, read 2026-09-17 (3.6–3.8 Flash are the through-2026 rates;
// they double on 2027-01-01). Override with AI_MODEL_PRICES_JSON='{"model":[in,out]}'.
const DEFAULT_PRICES = {
  'gemini-3.5-flash-lite': [0.30, 2.50],
  'gemini-3.6-flash': [0.75, 3.75],
  'gemini-3.7-flash': [0.75, 3.75],
  'gemini-3.8-flash': [0.75, 3.75],
  'gemini-2.5-flash-lite': [0.10, 0.40],
  'gemini-2.5-flash': [0.30, 2.50],
};

const env = (name) => {
  const v = process.env[name];
  return v === undefined || String(v).trim() === '' ? undefined : String(v).trim();
};
const int = (name, def) => { const n = parseInt(env(name), 10); return Number.isFinite(n) ? n : def; };
const num = (name, def) => { const n = parseFloat(env(name)); return Number.isFinite(n) ? n : def; };
const list = (value) => String(value || '').split(',').map(s => s.trim()).filter(Boolean);

function getPrices() {
  let overrides = {};
  try { overrides = env('AI_MODEL_PRICES_JSON') ? JSON.parse(env('AI_MODEL_PRICES_JSON')) : {}; }
  catch (e) { console.warn('[ai-config] AI_MODEL_PRICES_JSON is not valid JSON — using defaults'); }
  return { ...DEFAULT_PRICES, ...overrides };
}

// Models kept OUT of normal synchronous traffic (health probes may still call them).
// gemini-3.8-flash: 0/6 production successes on 2026-09-17 (503 high demand, aborts, then 429).
function getDisabledModels() {
  return list(env('AI_DISABLED_MODELS') !== undefined ? env('AI_DISABLED_MODELS') : 'gemini-3.8-flash');
}

// Ordered candidates for one generation:
//   Gemini primary → Gemini fallbacks → OpenRouter (only with an explicit price ceiling) → NVIDIA.
// primaryOverride (GEMINI_MODEL_PITCH) is prepended when a caller asks for it.
function getRoute(primaryOverride) {
  const prices = getPrices();
  const disabled = new Set(getDisabledModels());
  const geminiModels = [
    primaryOverride,
    env('GEMINI_MODEL_PRIMARY') || env('GEMINI_MODEL') || 'gemini-3.5-flash-lite',
    ...list(env('GEMINI_MODEL_FALLBACKS') || 'gemini-3.6-flash'),
  ].filter(Boolean);

  const route = [];
  const seen = new Set();
  for (const model of geminiModels) {
    if (seen.has(model)) continue;
    seen.add(model);
    route.push({ provider: 'gemini', model, key: `gemini:${model}`, supportsImages: true,
      price: prices[model] || null, disabled: disabled.has(model) });
  }

  // OpenRouter is the cross-provider fallback for a Google-wide outage. It is only enabled with an
  // explicit per-token price ceiling so an emergency fallback can never silently be expensive.
  const orModel = env('AI_OPENROUTER_MODEL');
  if (orModel && env('OPENROUTER_API_KEY')) {
    const pin = num('AI_OPENROUTER_PRICE_IN', NaN), pout = num('AI_OPENROUTER_PRICE_OUT', NaN);
    if (Number.isFinite(pin) && Number.isFinite(pout)) {
      route.push({ provider: 'openrouter', model: orModel, key: `openrouter:${orModel}`, supportsImages: false,
        price: [pin, pout], disabled: disabled.has(orModel) });
    } else {
      console.warn('[ai-config] AI_OPENROUTER_MODEL set but AI_OPENROUTER_PRICE_IN/OUT missing — OpenRouter fallback NOT enabled (a price ceiling is required).');
    }
  }

  if (env('NVIDIA_API_KEY') && env('AI_NVIDIA_FALLBACK') !== 'false') {
    const nvModel = env('NVIDIA_MODEL') || 'meta/llama-3.3-70b-instruct';
    route.push({ provider: 'nvidia', model: nvModel, key: `nvidia:${nvModel}`, supportsImages: false,
      price: [0, 0], disabled: disabled.has(nvModel) });
  }
  return route;
}

// Everything the health prober watches: the live route plus disabled Gemini models that are no longer
// configured in the route (e.g. gemini-3.8-flash) — probed for telemetry, never routed.
function getProbeTargets() {
  const route = getRoute();
  const prices = getPrices();
  const inRoute = new Set(route.map(c => c.model));
  const extra = getDisabledModels().filter(m => /^gemini-/.test(m) && !inRoute.has(m)).map(model => ({
    provider: 'gemini', model, key: `gemini:${model}`, supportsImages: true, price: prices[model] || null, disabled: true,
  }));
  return [...route, ...extra];
}

function getRouterConfig() {
  return {
    // Per-slot attempt caps (ms), in routable order. A slot beyond the list is capped only by the deadline
    // (minus a reserve for the next candidate). 11s covers gemini-3.5-flash-lite's measured full-pitch
    // max (10.3s over 5 real inputs, p95 9.3s) while leaving the secondary a real window when the
    // primary fails fast.
    attemptWindowsMs: list(env('AI_ATTEMPT_WINDOWS_MS') || '11000').map(Number).filter(Number.isFinite),
    // Below this an attempt cannot realistically return — don't issue it.
    minAttemptMs: int('AI_MIN_ATTEMPT_MS', 3000),
    // Same-model retries for synchronous requests. 0 = fail over immediately on 429/503/timeout.
    sameModelRetries: int('AI_SAME_MODEL_RETRIES', 0),
    maxOutputTokens: int('LLM_MAX_OUTPUT_TOKENS', 3500),
    maxCostPerPitchUsd: num('AI_MAX_COST_PER_PITCH_USD', 0.05),
    dailyBudgetUsd: num('AI_DAILY_PITCH_BUDGET_USD', 5),
    freeTier: env('GEMINI_FREE_TIER') === 'true',
  };
}

function getCircuitConfig() {
  return {
    failureThreshold: int('AI_CIRCUIT_FAILURE_THRESHOLD', 3),
    windowMs: int('AI_CIRCUIT_WINDOW_MS', 5 * 60 * 1000),
    cooldownMs: int('AI_CIRCUIT_COOLDOWN_MS', 2 * 60 * 1000),
    maxCooldownMs: int('AI_CIRCUIT_MAX_COOLDOWN_MS', 30 * 60 * 1000),
    probeSuccessesRequired: int('AI_CIRCUIT_PROBE_SUCCESSES', 2),
    disabledProbeIntervalMs: int('AI_DISABLED_PROBE_INTERVAL_MS', 30 * 60 * 1000),
  };
}

module.exports = { getRoute, getProbeTargets, getRouterConfig, getCircuitConfig, getPrices, getDisabledModels, DEFAULT_PRICES };

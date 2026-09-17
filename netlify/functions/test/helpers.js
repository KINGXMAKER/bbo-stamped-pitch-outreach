'use strict';
// Fake Gemini client: behavior[model] is a function (attemptIndex) => {text} | {error} | {hangMs}.
// Honors the SDK's per-request timeout like the real client (aborts at requestOptions.timeout).
function fakeGenAI(behavior, calls = []) {
  return {
    calls,
    getGenerativeModel(modelCfg, requestOptions) {
      return {
        async generateContent() {
          const model = modelCfg.model;
          const n = calls.filter(c => c.model === model).length;
          calls.push({ model, timeout: requestOptions && requestOptions.timeout, generationConfig: modelCfg.generationConfig });
          const b = behavior[model] ? behavior[model](n) : { error: `[404 Not Found] models/${model} is not found` };
          if (b.hangMs !== undefined) {
            const timeout = (requestOptions && requestOptions.timeout) || 1e9;
            await new Promise(r => setTimeout(r, Math.min(b.hangMs, timeout)));
            if (b.hangMs >= timeout) throw new Error('[GoogleGenerativeAI Error]: Error fetching from https://x/models/' + model + ':generateContent: This operation was aborted');
          }
          if (b.error) throw new Error(`[GoogleGenerativeAI Error]: Error fetching from https://x/models/${model}:generateContent: ${b.error}`);
          return { response: { text: () => b.text || '{"ok":true}', usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500 } } };
        },
      };
    },
  };
}

const ENV_KEYS = ['GEMINI_MODEL_PRIMARY', 'GEMINI_MODEL', 'GEMINI_MODEL_FALLBACKS', 'AI_DISABLED_MODELS', 'NVIDIA_API_KEY',
  'OPENROUTER_API_KEY', 'AI_OPENROUTER_MODEL', 'AI_OPENROUTER_PRICE_IN', 'AI_OPENROUTER_PRICE_OUT', 'AI_ATTEMPT_WINDOWS_MS',
  'AI_MIN_ATTEMPT_MS', 'AI_SAME_MODEL_RETRIES', 'AI_MAX_COST_PER_PITCH_USD', 'AI_DAILY_PITCH_BUDGET_USD',
  'AI_CIRCUIT_FAILURE_THRESHOLD', 'AI_CIRCUIT_COOLDOWN_MS', 'AI_CIRCUIT_PROBE_SUCCESSES', 'GEMINI_THINKING_LEVEL'];

function setEnv(values) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, {
    GEMINI_MODEL_PRIMARY: 'gemini-3.5-flash-lite',
    GEMINI_MODEL_FALLBACKS: 'gemini-3.6-flash',
    AI_MIN_ATTEMPT_MS: '50',
    ...values,
  });
}

const quiet = () => { const o = [console.log, console.warn]; console.log = console.warn = () => {}; return () => { [console.log, console.warn] = o; }; };

module.exports = { fakeGenAI, setEnv, quiet };

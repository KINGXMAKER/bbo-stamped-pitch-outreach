'use strict';
// Provider adapters. Each call(...) takes a bounded timeoutMs and resolves to
// { text, usage: { inputTokens, outputTokens } } or throws an Error whose message starts with
// "[NNN Reason]" for HTTP failures, so errors.js classifies every provider the same way.

const THINKING_LEVEL = () => process.env.GEMINI_THINKING_LEVEL || 'low';
const THINKING_BUDGET = () => parseInt(process.env.GEMINI_THINKING_BUDGET || '0', 10);

// Thinking models reason before answering — the single biggest cause of slow pitch generation. The
// two Gemini families take DIFFERENT fields and the wrong one is a 400: gemini-3.5-flash-lite rejects
// thinkingBudget (verified against the live API 2026-09-16).
//   gemini-3.x → thinkingLevel (default "low"; GEMINI_THINKING_LEVEL=high for deeper reasoning)
//   gemini-2.5 → thinkingBudget (default 0)
function thinkingConfigFor(model) {
  if (/^gemini-3/.test(model)) return { thinkingLevel: THINKING_LEVEL() };
  const budget = THINKING_BUDGET();
  if (/2\.5/.test(model) && Number.isFinite(budget)) return { thinkingBudget: budget };
  return null;
}

async function callGemini({ genAI, model, contentArg, modelConfigExtra, json, maxOutputTokens, timeoutMs }) {
  const config = { ...(modelConfigExtra || {}) };
  const generationConfig = { ...(config.generationConfig || {}) };
  if (json) generationConfig.responseMimeType = 'application/json';
  if (maxOutputTokens > 0) generationConfig.maxOutputTokens = maxOutputTokens;
  const thinkingConfig = thinkingConfigFor(model);
  if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig;
  config.generationConfig = generationConfig;

  const m = genAI.getGenerativeModel({ model, ...config }, { timeout: timeoutMs });
  const result = await m.generateContent(contentArg);
  const u = result.response.usageMetadata || {};
  return {
    text: result.response.text(),
    usage: {
      inputTokens: u.promptTokenCount || 0,
      // Thinking tokens are billed as output.
      outputTokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
    },
  };
}

// OpenAI-compatible chat completions (OpenRouter, NVIDIA NIM). Text prompts only.
async function callChatCompletions({ url, apiKey, model, prompt, systemInstruction, json, maxOutputTokens, timeoutMs, extraBody, extraHeaders }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...(extraHeaders || {}) },
      body: JSON.stringify({
        model,
        messages: [
          ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
          { role: 'user', content: prompt },
        ],
        temperature: 0.6,
        max_tokens: maxOutputTokens > 0 ? maxOutputTokens : 4096,
        stream: false,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        ...(extraBody || {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`[${res.status} ${res.statusText || 'Error'}] ${detail}`);
    }
    const data = await res.json();
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) throw new Error('[502 Empty Response] provider returned no content');
    const u = data.usage || {};
    return { text, usage: { inputTokens: u.prompt_tokens || 0, outputTokens: u.completion_tokens || 0 } };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`request timed out after ${timeoutMs}ms (aborted)`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const systemTextOf = (modelConfigExtra) => {
  const s = modelConfigExtra && modelConfigExtra.systemInstruction;
  if (!s) return null;
  if (typeof s === 'string') return s;
  return (s.parts || []).map(p => p.text || '').join('\n') || null;
};

async function callCandidate(candidate, args) {
  if (candidate.provider === 'gemini') return callGemini({ ...args, model: candidate.model });
  if (typeof args.contentArg !== 'string') throw new Error('[400 Unsupported] provider supports text prompts only');

  const common = { model: candidate.model, prompt: args.contentArg, systemInstruction: systemTextOf(args.modelConfigExtra),
    json: args.json, maxOutputTokens: args.maxOutputTokens, timeoutMs: args.timeoutMs };

  if (candidate.provider === 'openrouter') {
    const [pin, pout] = candidate.price;
    return callChatCompletions({
      ...common,
      url: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: process.env.OPENROUTER_API_KEY,
      extraHeaders: { 'X-Title': 'BBO Stamped Pitch' },
      // Server-side price ceiling: OpenRouter refuses to route to a more expensive host than this.
      extraBody: { provider: { max_price: { prompt: pin, completion: pout } } },
    });
  }
  if (candidate.provider === 'nvidia') {
    // No response_format: the existing NVIDIA fallback never sent it, and not every NIM model accepts it.
    return callChatCompletions({ ...common, json: false, url: 'https://integrate.api.nvidia.com/v1/chat/completions', apiKey: process.env.NVIDIA_API_KEY });
  }
  throw new Error(`[400 Unsupported] unknown provider ${candidate.provider}`);
}

module.exports = { callCandidate, thinkingConfigFor };

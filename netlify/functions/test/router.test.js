'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeGenAI, setEnv, quiet } = require('./helpers');
const circuit = require('../ai/circuit');
const router = require('../ai/router');

const OK = () => ({ text: '{"ok":true}' });
const fail = (msg) => () => ({ error: msg });

async function run(behavior, { env = {}, deadlineMs = 2000, opts = {}, contentArg = 'prompt' } = {}) {
  setEnv(env);
  const calls = [];
  const trace = { attempts: [] };
  const restore = quiet();
  const t0 = Date.now();
  try {
    const out = await router.generate(fakeGenAI(behavior, calls), contentArg, {}, deadlineMs, { json: true, trace, ...opts });
    return { out, calls, trace, ms: Date.now() - t0 };
  } catch (err) {
    return { err, calls, trace, ms: Date.now() - t0 };
  } finally {
    restore();
  }
}

test.beforeEach(() => circuit._reset());

test('healthy primary answers with a single attempt', async () => {
  const r = await run({ 'gemini-3.5-flash-lite': OK });
  assert.equal(r.out.modelUsed, 'gemini-3.5-flash-lite');
  assert.equal(r.calls.length, 1);
  assert.equal(r.trace.attempts[0].status, 'success');
});

test('503 on primary fails over immediately — no same-model retry', async () => {
  const r = await run({ 'gemini-3.5-flash-lite': fail('[503 Service Unavailable] high demand'), 'gemini-3.6-flash': OK });
  assert.equal(r.out.modelUsed, 'gemini-3.6-flash');
  assert.deepEqual(r.calls.map(c => c.model), ['gemini-3.5-flash-lite', 'gemini-3.6-flash']);
  assert.equal(r.trace.attempts[1].fallbackReason, 'gemini-3.5-flash-lite:transient:503');
});

test('429 on primary fails over immediately', async () => {
  const r = await run({ 'gemini-3.5-flash-lite': fail('[429 Too Many Requests] quota'), 'gemini-3.6-flash': OK });
  assert.equal(r.out.modelUsed, 'gemini-3.6-flash');
  assert.equal(r.calls.length, 2);
});

test('a hanging primary is cut at its window and the secondary still completes inside the deadline', async () => {
  const r = await run(
    { 'gemini-3.5-flash-lite': () => ({ hangMs: 5000 }), 'gemini-3.6-flash': OK },
    { env: { AI_ATTEMPT_WINDOWS_MS: '300', AI_MIN_ATTEMPT_MS: '200' }, deadlineMs: 1000 },
  );
  assert.equal(r.out.modelUsed, 'gemini-3.6-flash');
  assert.ok(r.calls[0].timeout <= 300, `primary window ${r.calls[0].timeout}ms must be capped`);
  assert.ok(r.ms < 1000, `finished in ${r.ms}ms, inside the deadline`);
  assert.equal(r.trace.attempts[0].errorClass, 'timeout');
});

test('without a slot cap, the primary still leaves the minimum window for the next candidate', async () => {
  const r = await run(
    { 'gemini-3.5-flash-lite': () => ({ hangMs: 5000 }), 'gemini-3.6-flash': OK },
    { env: { AI_ATTEMPT_WINDOWS_MS: '99999', AI_MIN_ATTEMPT_MS: '300' }, deadlineMs: 1000 },
  );
  assert.ok(r.calls[0].timeout <= 700, `primary got ${r.calls[0].timeout}ms of a 1000ms deadline`);
  assert.equal(r.out.modelUsed, 'gemini-3.6-flash');
});

test('repeated failures open the circuit and later requests skip the model without calling it', async () => {
  const behavior = { 'gemini-3.5-flash-lite': fail('[503 Service Unavailable] overloaded'), 'gemini-3.6-flash': OK };
  for (let i = 0; i < 3; i++) await run(behavior, { env: { AI_CIRCUIT_FAILURE_THRESHOLD: '3' } });
  assert.equal(circuit.get('gemini:gemini-3.5-flash-lite').state, 'OPEN');
  const r = await run(behavior, { env: { AI_CIRCUIT_FAILURE_THRESHOLD: '3' } });
  assert.deepEqual(r.calls.map(c => c.model), ['gemini-3.6-flash']);
  assert.equal(r.trace.attempts[0].status, 'skipped');
  assert.equal(r.trace.attempts[0].fallbackReason, 'circuit_OPEN');
});

test('gemini-3.8-flash is disabled for normal traffic by default even if configured first', async () => {
  const r = await run({ 'gemini-3.8-flash': OK, 'gemini-3.5-flash-lite': OK }, { env: { GEMINI_MODEL_PRIMARY: 'gemini-3.8-flash', GEMINI_MODEL_FALLBACKS: 'gemini-3.5-flash-lite' } });
  assert.deepEqual(r.calls.map(c => c.model), ['gemini-3.5-flash-lite']);
  assert.equal(r.trace.attempts[0].fallbackReason, 'disabled');
});

test('gemini-3.x requests carry thinkingLevel "low"', async () => {
  const r = await run({ 'gemini-3.5-flash-lite': OK });
  assert.deepEqual(r.calls[0].generationConfig.thinkingConfig, { thinkingLevel: 'low' });
  assert.equal(r.calls[0].generationConfig.responseMimeType, 'application/json');
});

test('per-pitch cost ceiling skips a candidate before calling it', async () => {
  const r = await run({ 'gemini-3.5-flash-lite': OK }, { env: { AI_MAX_COST_PER_PITCH_USD: '0.000001' } });
  assert.equal(r.calls.length, 0);
  assert.match(r.trace.attempts[0].fallbackReason, /^cost_ceiling/);
  assert.equal(r.err.allModelsFailed, true);
});

test('auth errors stop the provider and surface the original error', async () => {
  const r = await run({ 'gemini-3.5-flash-lite': fail('[400 Bad Request] API key not valid'), 'gemini-3.6-flash': OK });
  assert.equal(r.calls.length, 1);
  assert.match(r.err.message, /API key not valid/);
  assert.equal(r.err.allModelsFailed, undefined);
});

test('when everything fails, the most actionable failure is reported', async () => {
  const r = await run({ 'gemini-3.5-flash-lite': fail('[429 Too Many Requests] quota'), 'gemini-3.6-flash': fail('[503 Service Unavailable] overloaded') });
  assert.equal(r.err.allModelsFailed, true);
  assert.equal(r.err.failureKind, 'quota');
  assert.match(r.err.message, /\[429 /);
});

test('image requests only route to image-capable providers', async () => {
  const r = await run({ 'gemini-3.5-flash-lite': fail('[503 Service Unavailable] x'), 'gemini-3.6-flash': fail('[503 Service Unavailable] x') },
    { env: { NVIDIA_API_KEY: 'test' }, contentArg: [{ text: 'x' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }] });
  assert.ok(!r.trace.attempts.some(a => a.provider === 'nvidia'));
  assert.equal(r.err.allModelsFailed, true);
});

test('OpenRouter is not routed without an explicit price ceiling', async () => {
  setEnv({ OPENROUTER_API_KEY: 'test', AI_OPENROUTER_MODEL: 'some/model' });
  const restore = quiet();
  try {
    const route = require('../ai/config').getRoute();
    assert.ok(!route.some(c => c.provider === 'openrouter'));
    process.env.AI_OPENROUTER_PRICE_IN = '0.1'; process.env.AI_OPENROUTER_PRICE_OUT = '0.4';
    assert.ok(require('../ai/config').getRoute().some(c => c.provider === 'openrouter'));
  } finally { restore(); }
});

test('attempt logs never contain API keys', async () => {
  const r = await run({ 'gemini-3.5-flash-lite': fail('[503 Service Unavailable] key=AIzaSyA1234567890abcdefghijklmnop Bearer sk-or-v1-secretvalue') , 'gemini-3.6-flash': OK });
  const logged = JSON.stringify(r.trace.attempts);
  assert.doesNotMatch(logged, /AIzaSyA1234567890abcdefghijklmnop|sk-or-v1-secretvalue/);
});

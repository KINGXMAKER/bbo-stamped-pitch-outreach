'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../ai/circuit');

const cfg = { failureThreshold: 3, windowMs: 60000, cooldownMs: 1000, maxCooldownMs: 8000, probeSuccessesRequired: 2 };

test('failures below threshold degrade but stay routable', () => {
  let e = c.applyFailure(null, 'transient', '503', 0, cfg);
  assert.equal(e.state, 'DEGRADED');
  assert.equal(c.isRoutable(e), true);
});

test('threshold failures within the window open the circuit and stop routing', () => {
  let e = null;
  for (const t of [0, 10, 20]) e = c.applyFailure(e, 'quota', '429', t, cfg);
  assert.equal(e.state, 'OPEN');
  assert.equal(c.isRoutable(e), false);
});

test('failures outside the window do not accumulate', () => {
  let e = c.applyFailure(null, 'timeout', 'timeout', 0, cfg);
  e = c.applyFailure(e, 'timeout', 'timeout', 70000, cfg);
  e = c.applyFailure(e, 'timeout', 'timeout', 70010, cfg);
  assert.equal(e.state, 'DEGRADED');
});

test('auth / bad-request errors never trip the breaker', () => {
  let e = null;
  for (const t of [0, 1, 2, 3]) e = c.applyFailure(e, 'auth', '401', t, cfg);
  assert.equal(e.state, 'HEALTHY');
});

test('open circuit is due for probe only after cooldown; needs consecutive probe successes', () => {
  let e = null;
  for (const t of [0, 1, 2]) e = c.applyFailure(e, 'transient', '503', t, cfg);
  assert.equal(c.isDueForProbe(e, 500), false);
  assert.equal(c.isDueForProbe(e, 1002), true);
  e = c.applyProbeResult(e, true, null, 1002, cfg);
  assert.equal(e.state, 'PROBING');
  assert.equal(c.isRoutable(e), false, 'one probe success is not enough to restore traffic');
  e = c.applyProbeResult(e, true, null, 1300, cfg);
  assert.equal(e.state, 'HEALTHY');
});

test('a failed probe re-opens with a doubled, capped cooldown', () => {
  let e = null;
  for (const t of [0, 1, 2]) e = c.applyFailure(e, 'transient', '503', t, cfg);
  e = c.applyProbeResult(e, false, '503', 1500, cfg);
  assert.equal(e.state, 'OPEN');
  assert.equal(e.cooldownMs, 2000);
  for (let i = 0; i < 5; i++) e = c.applyProbeResult(e, false, '503', 2000 + i, cfg);
  assert.equal(e.cooldownMs, 8000);
});

test('transition functions do not mutate their input', () => {
  const before = c.applyFailure(null, 'transient', '503', 0, cfg);
  const snapshot = JSON.stringify(before);
  c.applyFailure(before, 'transient', '503', 1, cfg);
  assert.equal(JSON.stringify(before), snapshot);
});

test('DEGRADED expires to HEALTHY once its failures leave the window (idle secondary)', () => {
  const e = c.applyFailure(c.applyFailure(null, 'quota', '429', 0, cfg), 'quota', '429', 10, cfg);
  assert.equal(e.state, 'DEGRADED');
  assert.equal(c.effectiveEntry(e, 30000, cfg).state, 'DEGRADED', 'still inside the window');
  assert.equal(c.effectiveEntry(e, 70000, cfg).state, 'HEALTHY', 'window elapsed with no new failures');
  let open = null;
  for (const t of [0, 1, 2]) open = c.applyFailure(open, 'transient', '503', t, cfg);
  assert.equal(c.effectiveEntry(open, 999999, cfg).state, 'OPEN', 'only probes restore an OPEN circuit');
});

test('probe recovery persists through the shared store and is what other instances load', async () => {
  const saved = {};
  const store = { kind: 'test', getJSON: async (k) => (saved[k] ? JSON.parse(saved[k]) : null), setJSON: async (k, v) => { saved[k] = JSON.stringify(v); } };
  const keys = ['AI_CIRCUIT_FAILURE_THRESHOLD', 'AI_CIRCUIT_COOLDOWN_MS', 'AI_CIRCUIT_PROBE_SUCCESSES'];
  const prev = keys.map(k => process.env[k]);
  Object.assign(process.env, { AI_CIRCUIT_FAILURE_THRESHOLD: '2', AI_CIRCUIT_COOLDOWN_MS: '0', AI_CIRCUIT_PROBE_SUCCESSES: '2' });
  const quiet = console.warn; console.warn = () => {};
  try {
    c._reset(); c.bindStore(store);
    c.recordFailure('gemini:m', 'transient', '503'); c.recordFailure('gemini:m', 'transient', '503');
    await c.flush();
    c._reset(); c.bindStore(store); await c.load({ force: true });          // another instance
    assert.equal(c.get('gemini:m').state, 'OPEN');
    c.recordProbe('gemini:m', true, null, 10); await c.flush();
    c._reset(); c.bindStore(store); await c.load({ force: true });
    assert.equal(c.get('gemini:m').state, 'PROBING', 'one probe is not enough');
    c.recordProbe('gemini:m', true, null, 10); await c.flush();
    c._reset(); c.bindStore(store); await c.load({ force: true });
    assert.equal(c.get('gemini:m').state, 'HEALTHY', 'recovered state is persisted and loaded elsewhere');
  } finally {
    console.warn = quiet; c._reset();
    keys.forEach((k, i) => { if (prev[i] === undefined) delete process.env[k]; else process.env[k] = prev[i]; });
  }
});

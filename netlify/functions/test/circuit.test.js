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

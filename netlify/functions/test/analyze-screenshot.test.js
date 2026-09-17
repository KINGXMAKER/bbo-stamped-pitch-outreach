'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeGenAI, setEnv } = require('./helpers');
const shared = require('../shared');
const circuit = require('../ai/circuit');

test('screenshot scan fails cleanly when every Gemini model is quota-limited', async () => {
  setEnv({});
  circuit._reset();
  const realClient = shared.getGeminiClient;
  const quota = () => ({ error: '[429 Too Many Requests] You exceeded your current quota' });
  shared.getGeminiClient = () => fakeGenAI({ 'gemini-3.5-flash-lite': quota, 'gemini-3.6-flash': quota });
  delete require.cache[require.resolve('../analyze-screenshot')];
  const handler = require('../analyze-screenshot').handler;
  const logged = [];
  const saved = [console.log, console.warn, console.error];
  console.log = console.warn = () => {}; console.error = (...a) => logged.push(a.join(' '));
  try {
    const image = 'data:image/png;base64,' + 'A'.repeat(200);
    const res = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ image }) });
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 503);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'MODEL_OVERLOADED');
    assert.match(body.message, /try again/i);
    assert.equal(body.data, undefined, 'no partial business data is returned');
    assert.ok(logged.some(l => l.includes('[analyze-screenshot] error')), 'failure is logged');
  } finally {
    [console.log, console.warn, console.error] = saved;
    shared.getGeminiClient = realClient;
    circuit._reset();
  }
});

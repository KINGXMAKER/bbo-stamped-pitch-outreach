'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const spend = require('../ai/spend');

const fakeSb = (rows, error = null) => ({
  queries: 0,
  from(table) {
    this.queries++;
    assert.equal(table, 'pitch_generations');
    return { select: () => ({ gte: async () => ({ data: rows, error }) }) };
  },
});

test('daily spend is the sum of persisted generation costs, cached per instance', async () => {
  spend._resetForTests();
  const sb = fakeSb([{ estimated_cost_usd: '0.005078' }, { estimated_cost_usd: 0.004922 }, { estimated_cost_usd: null }]);
  assert.equal(await spend.getDailySpendUsd(sb), 0.01);
  await spend.getDailySpendUsd(sb);
  assert.equal(sb.queries, 1);
});

test('an unreachable table returns null so callers fall back', async () => {
  spend._resetForTests();
  const o = console.warn; console.warn = () => {};
  try { assert.equal(await spend.getDailySpendUsd(fakeSb(null, { message: 'boom' })), null); } finally { console.warn = o; }
});

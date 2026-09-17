'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const e = require('../ai/errors');
const log = require('../ai/generation-log');

test('classification uses the bracketed status code, not stray digits', () => {
  assert.equal(e.classifyError(new Error('model returned 0 candidates with maxOutputTokens: 3500')), 'other');
  assert.equal(e.classifyError(new Error('failed after 4294ms')), 'other');
  assert.equal(e.classifyError(new Error('[429 Too Many Requests] retryDelay 2.199104009s')), 'quota');
  assert.equal(e.classifyError(new Error('[503 Service Unavailable] high demand')), 'transient');
  assert.equal(e.classifyError(new Error('This operation was aborted')), 'timeout');
  assert.equal(e.classifyError(new Error('[404 Not Found] no longer available')), 'unavailable');
});

function fakeSupabase({ missingTables = false, missingColumn = false } = {}) {
  const ops = [];
  const result = (table, op, payload) => {
    ops.push({ table, op, payload });
    if (missingTables && table !== 'pitch_history') return { error: { code: 'PGRST205', message: "Could not find the table 'public.pitch_generations'" } };
    if (missingColumn && table === 'pitch_history' && op === 'insert' && payload.some(r => r.generation_id)) {
      return { error: { code: 'PGRST204', message: "Could not find the 'generation_id' column" } };
    }
    if (table === 'pitch_history') return { data: payload.map((r, i) => ({ id: `id-${r.channel}-${i}`, channel: r.channel })), error: null };
    return { error: null };
  };
  const builder = (table) => ({
    insert(payload) {
      const rows = Array.isArray(payload) ? payload : [payload];
      const res = result(table, 'insert', rows);
      return { select: async () => res, then: (ok, ko) => Promise.resolve(res).then(ok, ko) };
    },
    update(payload) { return { eq: async () => result(table, 'update', payload) }; },
  });
  return { ops, from: builder };
}

const rows = [{ channel: 'dm', ai_draft: 'a' }, { channel: 'email', ai_draft: 'b' }];

test('pitch_history channel rows are written in ONE insert, linked to the generation', async () => {
  log._resetForTests();
  const sb = fakeSupabase();
  const g = log.createGenerationLog(sb, { generationId: 'gen-1', businessName: 'X', fastMode: false, payload: {} });
  g.start();
  const ids = await log.insertPitchHistoryRows(sb, rows, 'gen-1', g);
  const inserts = sb.ops.filter(o => o.table === 'pitch_history' && o.op === 'insert');
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].payload.length, 2);
  assert.ok(inserts[0].payload.every(r => r.generation_id === 'gen-1'));
  assert.deepEqual(ids, { dm: 'id-dm-0', email: 'id-email-1' });
  await g.finish({ status: 'success', summary: { attemptsCount: 1 }, latencyMs: 10, attempts: [{ attempt: 1, provider: 'gemini', model: 'm', status: 'success' }] });
  assert.ok(sb.ops.some(o => o.table === 'pitch_generations' && o.op === 'update' && o.payload.status === 'success'));
  assert.equal(sb.ops.filter(o => o.table === 'pitch_generation_attempts').length, 1);
});

test('before the migration, generation logging is a no-op and history still writes without generation_id', async () => {
  log._resetForTests();
  const sb = fakeSupabase({ missingTables: true, missingColumn: true });
  const restore = (() => { const o = console.warn; console.warn = () => {}; return () => { console.warn = o; }; })();
  try {
    const g = log.createGenerationLog(sb, { generationId: 'gen-2', businessName: 'X', fastMode: false, payload: {} });
    g.start();
    const ids = await log.insertPitchHistoryRows(sb, rows, 'gen-2', g);
    assert.deepEqual(ids, { dm: 'id-dm-0', email: 'id-email-1' });
    const inserts = sb.ops.filter(o => o.table === 'pitch_history' && o.op === 'insert');
    assert.equal(inserts.length, 1, 'no generation row → no generation_id attempt → single insert');
    assert.ok(inserts[0].payload.every(r => r.generation_id === undefined));
  } finally { restore(); }
});

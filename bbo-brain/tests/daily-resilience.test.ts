import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get, run, type Db } from '@/lib/db/client';
import { setProviderFetch } from '@/lib/ai/providers/registry';
import { setGenerator } from '@/lib/ai/run';
import { writeMetrics } from '@/lib/ingest/ingest';
import { runPipeline } from '@/lib/sync/registry';
import { makePost, testDb } from './helpers';

// Synthetic fixture; every provider is faked. Proves the daily loop's non-AI
// work survives an AI outage and a budget pause.
const STEPS = ['score', 'ai-enrich', 'mine-lessons', 'graph', 'search'];
const ENV_KEYS = ['AI_CODING_CORPUS_LIMIT', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'AI_RETRY_BACKOFF_MS', 'AI_DAILY_BUDGET_USD', 'AI_MAX_COST_PER_JOB_USD'];
const saved: Record<string, string | undefined> = {};

function seed(db: Db) {
  for (let i = 0; i < 16; i++) {
    const publishedAt = new Date(Date.UTC(2026, 5, 1 + i * 3)).toISOString();
    const { contentId, postId } = makePost(db, { publishedAt, durationS: 30, caption: `post ${i}` });
    writeMetrics(db, postId, { reach: 1000 + i * 40, shares: 5 + (i % 5) * 6, comments: 4 + (i % 3) * 3, saves: 4, likes: 60, avg_watch_time_ms: 9000 + i * 300 }, new Date(Date.UTC(2026, 7, 20)).toISOString(), 'test');
    run(db, 'UPDATE content SET thumb_path = ?, media_fetched_at = ? WHERE id = ?', `/tmp/fixture-${contentId}.jpg`, publishedAt, contentId);
    run(db, `INSERT INTO transcripts (content_id, source, model, text, segments_json) VALUES (?, 'whisper_cpp', 'test', 'words', '[{"start":0,"end":1,"text":"words"}]')`, contentId);
  }
}

const unavailable = (() => async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => 'overloaded' }) as unknown as Response)() as unknown as typeof fetch;

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  setGenerator(null);
  process.env.GEMINI_API_KEY = 'test';
  process.env.OPENROUTER_API_KEY = 'test';
  process.env.NVIDIA_API_KEY = 'test';
  process.env.AI_RETRY_BACKOFF_MS = '0';
  process.env.AI_DAILY_BUDGET_USD = '1';
  process.env.AI_MAX_COST_PER_JOB_USD = '0.75';
});

afterEach(() => {
  setProviderFetch(null);
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('daily loop resilience', () => {
  it('keeps doing non-AI work when every AI provider is down', async () => {
    const db = testDb();
    seed(db);
    setProviderFetch(unavailable);

    const results = await runPipeline(db, STEPS, { 'ai-enrich': { limit: 3 } });
    const byKind = Object.fromEntries(results.map((r) => [r.kind, r]));

    expect(byKind['ai-enrich'].status).toBe('failed');
    expect(byKind['ai-enrich'].error).toContain('stay queued');
    expect(byKind.score.status).toBe('succeeded');
    expect(byKind['mine-lessons'].status).toBe('succeeded');
    expect(byKind.graph.status).toBe('succeeded');
    expect(byKind.search.status).toBe('succeeded');
    // Nothing was marked coded, so tomorrow's run picks the same posts up.
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) n FROM content WHERE coded_at IS NOT NULL')?.n).toBe(0);
  });

  it('reports a budget pause as a pause, not a failure, and carries on', async () => {
    const db = testDb();
    seed(db);
    run(db, `INSERT INTO ai_runs (workflow, status, input_json, estimated_cost_usd) VALUES ('enrichment', 'ok', '{}', 1.5)`);
    let called = 0;
    setProviderFetch((async () => {
      called++;
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as Response;
    }) as typeof fetch);

    const results = await runPipeline(db, STEPS, { 'ai-enrich': { limit: 3 } });
    const byKind = Object.fromEntries(results.map((r) => [r.kind, r]));

    expect(byKind['ai-enrich'].status).toBe('succeeded');
    expect(byKind['ai-enrich'].summary).toContain('BUDGET PAUSED');
    expect(called).toBe(0); // not one paid call was attempted
    expect(byKind['mine-lessons'].status).toBe('succeeded');
    expect(byKind.search.status).toBe('succeeded');
  });

  it('stops coding at the corpus ceiling instead of working through the whole catalogue', async () => {
    process.env.AI_CODING_CORPUS_LIMIT = '2';
    const db = testDb();
    seed(db);
    run(db, `UPDATE content SET coded_at = '2026-08-01T00:00:00.000Z' WHERE id IN (SELECT id FROM content LIMIT 2)`);
    let called = 0;
    setProviderFetch((async () => {
      called++;
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as Response;
    }) as typeof fetch);

    const [result] = await runPipeline(db, ['ai-enrich']);

    expect(result.status).toBe('succeeded');
    expect(result.summary).toContain('corpus limit reached (2/2');
    expect(called).toBe(0);
  });
});

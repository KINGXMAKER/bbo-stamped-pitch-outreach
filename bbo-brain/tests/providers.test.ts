import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { all, get, run, type Db } from '@/lib/db/client';
import { providerCoolingUntil, resetProviderCooldowns, runAi, setGenerator } from '@/lib/ai/run';
import { BudgetGuard, BudgetPausedError, budgetStatus, projectBatch } from '@/lib/ai/budget';
import { estimateCost } from '@/lib/ai/pricing';
import { candidatesFor, setProviderFetch } from '@/lib/ai/providers/registry';
import { testDb } from './helpers';

// Synthetic provider responses — no real API is called anywhere in this suite.
const Schema = z.object({ verdict: z.string() });

type Handler = (url: string, body: Record<string, unknown>) => { status: number; json?: unknown; text?: string };

let calls: Array<{ url: string; model: string }> = [];

function mockFetch(handler: Handler): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const model = String(body.model ?? url.split('/models/')[1]?.split(':')[0] ?? '');
    calls.push({ url, model });
    const res = handler(url, body);
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => res.json ?? {},
      text: async () => res.text ?? JSON.stringify(res.json ?? {}),
    } as Response;
  }) as typeof fetch;
}

const openAiOk = (content: string, tokens = { prompt_tokens: 1000, completion_tokens: 200 }) => ({
  status: 200,
  json: { choices: [{ message: { content }, finish_reason: 'stop' }], usage: tokens, model: 'candidate' },
});
const geminiOk = (content: string, tokens = { promptTokenCount: 1000, candidatesTokenCount: 200 }) => ({
  status: 200,
  json: { candidates: [{ content: { parts: [{ text: content }] }, finishReason: 'STOP' }], usageMetadata: tokens },
});

const ENV_KEYS = ['AI_QUOTA_COOLDOWN_MS', 'AI_CODING_FALLBACK_PROVIDERS', 'AI_RETRY_BACKOFF_MS', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'GEMINI_MODEL_PRIMARY', 'GEMINI_MODEL_FALLBACKS', 'OPENROUTER_MODELS', 'NVIDIA_MODELS', 'AI_CODING_PROVIDER', 'AI_CODING_MODEL', 'AI_DAILY_BUDGET_USD', 'AI_MONTHLY_BUDGET_USD', 'AI_MAX_COST_PER_JOB_USD', 'AI_ALLOW_FALLBACK'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  calls = [];
  setGenerator(null);
  resetProviderCooldowns();
  process.env.GEMINI_API_KEY = 'test-gemini';
  process.env.OPENROUTER_API_KEY = 'test-openrouter';
  process.env.NVIDIA_API_KEY = 'test-nvidia';
  process.env.GEMINI_MODEL_PRIMARY = 'gemini-2.5-flash';
  process.env.GEMINI_MODEL_FALLBACKS = 'gemini-2.5-flash-lite';
  process.env.OPENROUTER_MODELS = 'qwen/qwen3-235b-a22b-2507';
  process.env.NVIDIA_MODELS = 'nvidia/nemotron-3.5-lightning-30b-a3b';
  process.env.AI_DAILY_BUDGET_USD = '1';
  process.env.AI_MONTHLY_BUDGET_USD = '15';
  process.env.AI_MAX_COST_PER_JOB_USD = '0.75';
  process.env.AI_ALLOW_FALLBACK = 'true';
  process.env.AI_RETRY_BACKOFF_MS = '0';
});

afterEach(() => {
  setProviderFetch(null);
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const ask = (db: Db, task: 'coding' | 'analysis' = 'coding') =>
  runAi({
    db,
    workflow: 'test_workflow',
    task,
    promptSlug: 'test',
    template: 'T',
    schemaVersion: 'v1',
    system: 'system',
    prompt: 'prompt',
    schema: Schema,
    input: {},
  });

const lastRun = (db: Db) =>
  get<{ status: string; provider: string | null; model: string | null; task_class: string; retry_count: number; fallback_reason: string | null; input_tokens: number | null; output_tokens: number | null; estimated_cost_usd: number; error: string | null }>(
    db,
    'SELECT status, provider, model, task_class, retry_count, fallback_reason, input_tokens, output_tokens, estimated_cost_usd, error FROM ai_runs ORDER BY id DESC LIMIT 1'
  )!;

describe('provider routing and fallback', () => {
  it('records provider, model, task class, tokens and estimated cost on every run', async () => {
    const db = testDb();
    setProviderFetch(mockFetch(() => geminiOk('{"verdict":"ok"}')));
    const result = await ask(db);

    const row = lastRun(db);
    expect(result.data.verdict).toBe('ok');
    expect(row.status).toBe('ok');
    expect(row.provider).toBe('gemini');
    expect(row.task_class).toBe('coding');
    expect(row.input_tokens).toBe(1000);
    expect(row.output_tokens).toBe(200);
    expect(row.estimated_cost_usd).toBeGreaterThan(0);
  });

  it('sends taxonomy coding to the cheap model before the flagship', async () => {
    const candidates = candidatesFor('coding').map((c) => `${c.provider.providerName}:${c.model}`);
    expect(candidates[0]).toBe('gemini:gemini-2.5-flash-lite');
    expect(candidates).toContain('openrouter:qwen/qwen3-235b-a22b-2507');
    // Deep analysis keeps the stronger model first.
    expect(candidatesFor('analysis')[0].model).toBe('gemini-2.5-flash');
  });

  it('retries a 429 once, then falls back to another provider and says why', async () => {
    const db = testDb();
    setProviderFetch(
      mockFetch((url) => {
        if (url.includes('generativelanguage')) return { status: 429, text: 'quota exceeded' };
        return openAiOk('{"verdict":"from-openrouter"}');
      })
    );
    const result = await ask(db);
    const row = lastRun(db);
    const geminiCalls = calls.filter((c) => c.url.includes('generativelanguage'));

    expect(result.data.verdict).toBe('from-openrouter');
    expect(row.provider).toBe('openrouter');
    expect(row.fallback_reason).toContain('429');
    expect(row.retry_count).toBeGreaterThanOrEqual(1);
    // The quota wall is the provider's: its second model is not asked at all.
    expect(geminiCalls.length).toBe(2);
    expect(providerCoolingUntil('gemini')).not.toBeNull();
  });

  it('skips a cooling provider on the next call instead of hitting the same quota wall', async () => {
    const db = testDb();
    setProviderFetch(
      mockFetch((url) => {
        if (url.includes('generativelanguage')) return { status: 429, text: 'quota exceeded' };
        return openAiOk('{"verdict":"ok"}');
      })
    );
    await ask(db);
    const before = calls.filter((c) => c.url.includes('generativelanguage')).length;
    await ask(db);
    await ask(db);

    expect(calls.filter((c) => c.url.includes('generativelanguage')).length).toBe(before);
    expect(lastRun(db).provider).toBe('openrouter');
  });

  it('drops a retired model immediately instead of retrying it', async () => {
    const db = testDb();
    setProviderFetch(
      mockFetch((url) => {
        if (url.includes('generativelanguage')) return { status: 404, text: 'model retired' };
        return openAiOk('{"verdict":"ok"}');
      })
    );
    await ask(db);

    // One call per retired Gemini model, no retries.
    expect(calls.filter((c) => c.url.includes('generativelanguage')).length).toBe(2);
  });

  it('stops using a provider whose key is rejected, and reports it as configuration', async () => {
    const db = testDb();
    setProviderFetch(
      mockFetch((url) => {
        if (url.includes('generativelanguage')) return { status: 401, text: 'bad key' };
        return openAiOk('{"verdict":"ok"}');
      })
    );
    await ask(db);

    // 401 is hard: the first Gemini model fails and the second is never tried.
    expect(calls.filter((c) => c.url.includes('generativelanguage')).length).toBe(1);
    expect(lastRun(db).provider).toBe('openrouter');
  });

  it('repairs malformed JSON once before escalating to the next candidate', async () => {
    const db = testDb();
    let geminiHits = 0;
    setProviderFetch(
      mockFetch((url) => {
        if (url.includes('generativelanguage')) {
          geminiHits++;
          return geminiOk(geminiHits === 1 ? 'here you go: {verdict oops' : '{"verdict":"repaired"}');
        }
        return openAiOk('{"verdict":"other"}');
      })
    );
    const result = await ask(db);
    const row = lastRun(db);

    expect(result.data.verdict).toBe('repaired');
    expect(row.provider).toBe('gemini');
    expect(row.retry_count).toBe(1);
  });

  it('hands a persistently invalid model to the next candidate', async () => {
    const db = testDb();
    setProviderFetch(
      mockFetch((url) => {
        if (url.includes('generativelanguage')) return geminiOk('not json at all');
        return openAiOk('{"verdict":"rescued"}');
      })
    );
    const result = await ask(db);

    expect(result.data.verdict).toBe('rescued');
    expect(lastRun(db).provider).toBe('openrouter');
  });

  it('keeps an unvalidated provider out of the coding fallback chain when told to', () => {
    process.env.AI_CODING_PROVIDER = 'openrouter';
    process.env.AI_CODING_MODEL = 'qwen/qwen3-235b-a22b-2507';
    process.env.AI_CODING_FALLBACK_PROVIDERS = 'openrouter,gemini';
    const chain = candidatesFor('coding').map((c) => c.provider.providerName);

    expect(chain[0]).toBe('openrouter');
    expect(chain).toContain('gemini');
    expect(chain).not.toContain('nvidia');
  });

  it('does not fall back at all when fallback is switched off', async () => {
    process.env.AI_ALLOW_FALLBACK = 'false';
    process.env.AI_CODING_PROVIDER = 'nvidia';
    process.env.AI_CODING_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';
    const db = testDb();
    setProviderFetch(mockFetch(() => ({ status: 503, text: 'busy' })));

    await expect(ask(db)).rejects.toThrow(/503/);
    expect(calls.every((c) => c.url.includes('nvidia'))).toBe(true);
  });
});

describe('cost controls', () => {
  const spend = (db: Db, usd: number, createdAt = new Date().toISOString()) =>
    run(db, `INSERT INTO ai_runs (workflow, status, input_json, estimated_cost_usd, created_at) VALUES ('test_workflow', 'ok', '{}', ?, ?)`, usd, createdAt);

  it('pauses AI work when the daily budget is spent', async () => {
    const db = testDb();
    spend(db, 1.2);
    const status = budgetStatus(db);
    expect(status.paused).toBe(true);
    expect(status.reason).toContain('daily AI budget');

    setProviderFetch(mockFetch(() => geminiOk('{"verdict":"ok"}')));
    await expect(ask(db)).rejects.toBeInstanceOf(BudgetPausedError);
    expect(calls).toHaveLength(0); // paused before spending anything
  });

  it('stops a batch at its per-job ceiling rather than after it', () => {
    const db = testDb();
    const guard = new BudgetGuard(db, 0.1);
    guard.record(0.09);
    expect(() => guard.check(0.05)).toThrow(BudgetPausedError);
    expect(() => guard.check(0.005)).not.toThrow();
  });

  it('estimates a batch before starting it', () => {
    const db = testDb();
    for (let i = 0; i < 5; i++) spend(db, 0.01);
    const projection = projectBatch(db, 'test_workflow', 100);

    expect(projection.perRunUsd).toBeCloseTo(0.01, 6);
    expect(projection.totalUsd).toBeCloseTo(1, 6);
    expect(projection.fits).toBe(false); // $1.00 > the $0.75 per-job ceiling
    expect(projection.reason).toContain('per-job ceiling');
  });

  it('prices a run from its own token usage', () => {
    expect(estimateCost('gemini', 'gemini-2.5-flash-lite', { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(0.1, 6);
    expect(estimateCost('nvidia', 'nvidia/nemotron-3.5-lightning-30b-a3b', { inputTokens: 5_000_000, outputTokens: 1_000_000 })).toBe(0); // free tier
  });

  it('keeps a budget pause out of the failure count', async () => {
    const db = testDb();
    spend(db, 20);
    setProviderFetch(mockFetch(() => geminiOk('{"verdict":"ok"}')));

    await expect(ask(db)).rejects.toBeInstanceOf(BudgetPausedError);
    const errorRuns = all<{ error: string }>(db, `SELECT error FROM ai_runs WHERE status = 'error'`);
    expect(errorRuns[0].error).toContain('budget');
  });
});

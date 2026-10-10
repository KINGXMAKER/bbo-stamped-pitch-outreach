import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { buildChain, extractJson, runStage } from '@/lib/ai/router';
import { AiProviderError, classifyStatus } from '@/lib/ai/types';

const Schema = z.object({ answer: z.string() });

const ENV_KEYS = [
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'OPENROUTER_API_KEY',
  'NVIDIA_API_KEY',
  'AI_VISION_PROVIDER',
  'AI_CREATIVE_PROVIDER',
  'AI_FALLBACK_PROVIDER',
  'NVIDIA_VISION_MODEL',
  'OPENROUTER_CREATIVE_MODEL',
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

/** Queues one canned HTTP response per call, in order. */
function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  const calls: string[] = [];
  let index = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      const next = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        json: async () => next.body,
        text: async () => JSON.stringify(next.body),
      } as unknown as Response;
    })
  );
  return calls;
}

const googleOk = (payload: unknown) => ({
  status: 200,
  body: { candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] },
});

const openAiOk = (payload: unknown) => ({
  status: 200,
  body: { choices: [{ message: { content: JSON.stringify(payload) } }] },
});

describe('classifyStatus', () => {
  test('maps statuses onto retry behaviour', () => {
    expect(classifyStatus(429)).toBe('transient');
    expect(classifyStatus(503)).toBe('transient');
    expect(classifyStatus(404)).toBe('model-unavailable');
    expect(classifyStatus(401)).toBe('hard');
    expect(classifyStatus(400)).toBe('hard');
  });
});

describe('buildChain', () => {
  test('drops providers with no key configured', () => {
    process.env.OPENROUTER_API_KEY = 'test';
    const chain = buildChain('creative').map((provider) => provider.name);
    expect(chain).toEqual(['openrouter']);
  });

  test('honours the configured primary and fallback order', () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'g';
    process.env.OPENROUTER_API_KEY = 'o';
    process.env.NVIDIA_API_KEY = 'n';
    process.env.AI_CREATIVE_PROVIDER = 'nvidia';
    process.env.AI_FALLBACK_PROVIDER = 'google';

    expect(buildChain('creative').map((provider) => provider.name)).toEqual([
      'nvidia',
      'google',
      'openrouter',
    ]);
  });

  test('vision keeps Gemini first, then OpenRouter, then NVIDIA', () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'g';
    process.env.OPENROUTER_API_KEY = 'o';
    process.env.NVIDIA_API_KEY = 'n';
    process.env.AI_VISION_PROVIDER = 'google';
    // The creative fallback must not reorder the vision chain.
    process.env.AI_FALLBACK_PROVIDER = 'nvidia';

    expect(buildChain('vision').map((provider) => provider.name)).toEqual([
      'google',
      'openrouter',
      'nvidia',
    ]);
  });

  test('creative puts OpenRouter first, then the configured fallback', () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'g';
    process.env.OPENROUTER_API_KEY = 'o';
    process.env.NVIDIA_API_KEY = 'n';
    process.env.AI_CREATIVE_PROVIDER = 'openrouter';
    process.env.AI_FALLBACK_PROVIDER = 'nvidia';

    expect(buildChain('creative').map((provider) => provider.name)).toEqual([
      'openrouter',
      'nvidia',
      'google',
    ]);
  });

  test('a text-only NVIDIA model is dropped from the vision chain', () => {
    process.env.NVIDIA_API_KEY = 'n';
    process.env.NVIDIA_VISION_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
    try {
      expect(buildChain('vision').map((provider) => provider.name)).toEqual([]);
      expect(buildChain('creative').map((provider) => provider.name)).toEqual(['nvidia']);
    } finally {
      delete process.env.NVIDIA_VISION_MODEL;
    }
  });

  test('ignores a nonsense provider name instead of breaking the chain', () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'g';
    process.env.AI_VISION_PROVIDER = 'skynet';
    expect(buildChain('vision').map((provider) => provider.name)).toEqual(['google']);
  });

  test('returns an empty chain when nothing is configured', () => {
    expect(buildChain('creative')).toEqual([]);
  });
});

describe('extractJson', () => {
  test('parses raw JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  test('parses fenced JSON', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  test('pulls an object out of surrounding chatter', () => {
    expect(extractJson('Sure! {"a":1} Hope that helps.')).toEqual({ a: 1 });
  });

  test('throws a bad-output error rather than returning junk', () => {
    try {
      extractJson('no json at all');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AiProviderError);
      expect((error as AiProviderError).kind).toBe('bad-output');
    }
  });
});

describe('runStage failover', () => {
  test('falls through to the next provider when the first is rate limited', async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'g';
    process.env.OPENROUTER_API_KEY = 'o';
    process.env.AI_CREATIVE_PROVIDER = 'google';

    const calls = mockFetchSequence([
      { status: 429, body: { error: 'rate limited, retry in 2.199104009s' } },
      { status: 429, body: { error: 'rate limited again' } },
      openAiOk({ answer: 'from openrouter' }),
    ]);

    const result = await runStage({
      stage: 'test',
      capability: 'creative',
      system: 's',
      prompt: 'p',
      schema: Schema,
      budgetMs: 20_000,
      attemptTimeoutMs: 5_000,
    });

    expect(result.data.answer).toBe('from openrouter');
    expect(result.generation.providerUsed).toBe('openrouter');
    expect(result.generation.fallbackOccurred).toBe(true);
    // Two Google attempts (first + transient retry), then OpenRouter.
    expect(calls.filter((url) => url.includes('googleapis'))).toHaveLength(2);
    expect(calls.filter((url) => url.includes('openrouter'))).toHaveLength(1);
  });

  test('a 401 is not retried on the same provider', async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'g';
    process.env.OPENROUTER_API_KEY = 'o';
    process.env.AI_CREATIVE_PROVIDER = 'google';

    const calls = mockFetchSequence([
      { status: 401, body: { error: 'bad key' } },
      openAiOk({ answer: 'ok' }),
    ]);

    const result = await runStage({
      stage: 'test',
      capability: 'creative',
      system: 's',
      prompt: 'p',
      schema: Schema,
      budgetMs: 20_000,
      attemptTimeoutMs: 5_000,
    });

    expect(result.generation.providerUsed).toBe('openrouter');
    expect(calls.filter((url) => url.includes('googleapis'))).toHaveLength(1);
  });

  test('a retry-delay hint containing a 3-digit number is still treated as a 429', async () => {
    // Guards the classification bug this codebase has hit before: the retry
    // hint "2.199104009s" and quota values must never be read as a hard 400.
    process.env.OPENROUTER_API_KEY = 'o';

    mockFetchSequence([
      { status: 429, body: { error: { message: 'quota 400 exceeded, retry in 400ms' } } },
      openAiOk({ answer: 'recovered' }),
    ]);

    const result = await runStage({
      stage: 'test',
      capability: 'creative',
      system: 's',
      prompt: 'p',
      schema: Schema,
      budgetMs: 20_000,
      attemptTimeoutMs: 5_000,
    });

    expect(result.data.answer).toBe('recovered');
    expect(result.generation.attemptCount).toBe(2);
  });

  test('reports a clear not-configured failure when no key exists', async () => {
    await expect(
      runStage({ stage: 'test', capability: 'creative', system: 's', prompt: 'p', schema: Schema })
    ).rejects.toMatchObject({ kind: 'not-configured' });
  });

  test('surfaces the last failure when every provider is down', async () => {
    process.env.OPENROUTER_API_KEY = 'o';
    process.env.NVIDIA_API_KEY = 'n';
    mockFetchSequence([{ status: 503, body: { error: 'down' } }]);

    await expect(
      runStage({
        stage: 'test',
        capability: 'creative',
        system: 's',
        prompt: 'p',
        schema: Schema,
        budgetMs: 15_000,
        attemptTimeoutMs: 3_000,
      })
    ).rejects.toMatchObject({ kind: 'transient' });
  });

  test('repairs a structurally wrong payload on the same provider', async () => {
    process.env.OPENROUTER_API_KEY = 'o';
    mockFetchSequence([openAiOk({ notTheAnswer: 1 }), openAiOk({ answer: 'repaired' })]);

    const result = await runStage({
      stage: 'test',
      capability: 'creative',
      system: 's',
      prompt: 'p',
      schema: Schema,
      budgetMs: 40_000,
      attemptTimeoutMs: 5_000,
    });

    expect(result.data.answer).toBe('repaired');
    expect(result.generation.providerUsed).toBe('openrouter');
  });


  test('a 403 is classified hard and moves straight on', async () => {
    process.env.OPENROUTER_API_KEY = 'o';
    process.env.NVIDIA_API_KEY = 'n';

    const calls = mockFetchSequence([
      { status: 403, body: { error: 'forbidden' } },
      openAiOk({ answer: 'from nvidia' }),
    ]);

    const result = await runStage({
      stage: 'test',
      capability: 'creative',
      system: 's',
      prompt: 'p',
      schema: Schema,
      budgetMs: 20_000,
      attemptTimeoutMs: 5_000,
    });

    expect(result.generation.providerUsed).toBe('nvidia');
    expect(calls.filter((url) => url.includes('openrouter'))).toHaveLength(1);
    expect(result.generation.attempts[0]).toMatchObject({
      provider: 'openrouter',
      status: 'error',
      errorType: 'hard',
      httpStatus: 403,
    });
  });

  test('a 404 model-unavailable is not retried on the same provider', async () => {
    process.env.OPENROUTER_API_KEY = 'o';
    process.env.NVIDIA_API_KEY = 'n';

    const calls = mockFetchSequence([
      { status: 404, body: { error: 'no such model' } },
      openAiOk({ answer: 'from nvidia' }),
    ]);

    const result = await runStage({
      stage: 'test',
      capability: 'creative',
      system: 's',
      prompt: 'p',
      schema: Schema,
      budgetMs: 20_000,
      attemptTimeoutMs: 5_000,
    });

    expect(result.generation.providerUsed).toBe('nvidia');
    expect(calls.filter((url) => url.includes('openrouter'))).toHaveLength(1);
    expect(result.generation.attempts[0].errorType).toBe('model-unavailable');
  });

  test('an upstream error tunnelled inside a 200 body is still a failure', async () => {
    process.env.OPENROUTER_API_KEY = 'o';
    process.env.NVIDIA_API_KEY = 'n';

    // Transient, so OpenRouter gets its retry first; NVIDIA only sees the
    // third call.
    mockFetchSequence([
      { status: 200, body: { error: { message: 'upstream is down', code: 502 } } },
      { status: 200, body: { error: { message: 'upstream is down', code: 502 } } },
      openAiOk({ answer: 'from nvidia' }),
    ]);

    const result = await runStage({
      stage: 'test',
      capability: 'creative',
      system: 's',
      prompt: 'p',
      schema: Schema,
      budgetMs: 25_000,
      attemptTimeoutMs: 5_000,
    });

    expect(result.generation.providerUsed).toBe('nvidia');
    expect(result.generation.attempts[0].errorType).toBe('transient');
  });

  test('a timeout is transient and falls through to the next provider', async () => {
    process.env.OPENROUTER_API_KEY = 'o';
    process.env.NVIDIA_API_KEY = 'n';

    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        call += 1;
        if (url.includes('openrouter')) {
          // Never resolves on its own — only the abort signal ends it.
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            });
          });
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: '{"answer":"from nvidia"}' } }] }),
          text: async () => '',
        } as unknown as Response;
      })
    );

    const result = await runStage({
      stage: 'test',
      capability: 'creative',
      system: 's',
      prompt: 'p',
      schema: Schema,
      budgetMs: 20_000,
      attemptTimeoutMs: 80,
    });

    expect(result.generation.providerUsed).toBe('nvidia');
    expect(result.generation.attempts.filter((a) => a.provider === 'openrouter')).toHaveLength(2);
    expect(call).toBeGreaterThanOrEqual(3);
  });

  test('records usage and per-attempt observability', async () => {
    process.env.OPENROUTER_API_KEY = 'o';
    mockFetchSequence([
      {
        status: 200,
        body: {
          model: 'anthropic/claude-sonnet-4.5',
          choices: [{ message: { content: '{"answer":"ok"}' } }],
          usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160, cost: 0.0012 },
        },
      },
    ]);

    const result = await runStage({
      stage: 'reels',
      capability: 'creative',
      system: 's',
      prompt: 'p',
      schema: Schema,
      budgetMs: 20_000,
      attemptTimeoutMs: 5_000,
    });

    expect(result.generation.stage).toBe('reels');
    expect(result.generation.modelUsed).toBe('anthropic/claude-sonnet-4.5');
    expect(result.generation.validatedFirstTry).toBe(true);
    expect(result.generation.usage).toEqual({
      promptTokens: 120,
      completionTokens: 40,
      totalTokens: 160,
      reportedCostUsd: 0.0012,
    });
    expect(result.generation.attempts).toHaveLength(1);
    expect(result.generation.attempts[0].status).toBe('ok');
    expect(result.generation.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('a repaired payload is reported as not valid on the first try', async () => {
    process.env.OPENROUTER_API_KEY = 'o';
    mockFetchSequence([openAiOk({ wrong: 1 }), openAiOk({ answer: 'repaired' })]);

    const result = await runStage({
      stage: 'test',
      capability: 'creative',
      system: 's',
      prompt: 'p',
      schema: Schema,
      budgetMs: 40_000,
      attemptTimeoutMs: 5_000,
    });

    expect(result.generation.validatedFirstTry).toBe(false);
    expect(result.generation.attempts.map((a) => a.status)).toEqual(['error', 'ok']);
  });

  test('reads the google response envelope', async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'g';
    process.env.AI_VISION_PROVIDER = 'google';
    mockFetchSequence([googleOk({ answer: 'saw it' })]);

    const result = await runStage({
      stage: 'test',
      capability: 'vision',
      system: 's',
      prompt: 'p',
      schema: Schema,
      images: [{ base64: 'AAAA', mediaType: 'image/jpeg' }],
      budgetMs: 20_000,
      attemptTimeoutMs: 5_000,
    });

    expect(result.data.answer).toBe('saw it');
    expect(result.generation.fallbackOccurred).toBe(false);
  });
});

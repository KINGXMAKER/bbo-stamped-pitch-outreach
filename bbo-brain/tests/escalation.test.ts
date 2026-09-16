import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { all, get, run, type Db } from '@/lib/db/client';
import { setProviderFetch } from '@/lib/ai/providers/registry';
import { setGenerator } from '@/lib/ai/run';
import { clearAiCoding, enrichContent } from '@/lib/intel/analysis';
import { writeMetrics } from '@/lib/ingest/ingest';
import { activeScoreVersion, computeAllScores } from '@/lib/scoring/engine';
import { makePost, testDb } from './helpers';

// Synthetic fixture and fake providers — no real API is called.
const ENV_KEYS = ['GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'GEMINI_MODEL_PRIMARY', 'GEMINI_MODEL_FALLBACKS', 'AI_RETRY_BACKOFF_MS', 'AI_ESCALATE_BELOW_CONFIDENCE', 'AI_ALLOW_FALLBACK'];
const saved: Record<string, string | undefined> = {};
let models: string[] = [];

const coding = (over: Record<string, unknown>, confidence: 'low' | 'medium' | 'high') =>
  JSON.stringify({
    evidence_notes: 'n',
    underlying_debate: 'd',
    hook_mechanics: 'h',
    opening_line: 'line',
    confidence,
    franchise: null,
    opening_hook: 'hook',
    topics: ['Dating'],
    timings: { time_to_understandable_s: 1, time_to_tension_s: 2, time_to_payoff_s: 3, dead_setup_s: 0 },
    strongest_moment: { timestamp: '00:05.0', quote: 'q', why: 'w' },
    strongest_opening: { timestamp: '00:00.0', quote: 'q', why: 'w', is_current_opening: true },
    attributes: { hook_type: 'confession', opening_type: 'guest_answer', tension_type: 'disagreement', emotional_trigger: 'recognition', share_trigger_type: 'relatable', comment_trigger_type: 'take_a_side', ...over },
  });

function mockGemini(reply: (model: string) => string): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const model = url.split('/models/')[1]?.split(':')[0] ?? '';
    models.push(model);
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: reply(model) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 200 } }),
      text: async () => '',
    } as Response;
  }) as typeof fetch;
}

function seedPost(db: Db, label: 'winner' | 'plain'): number {
  const { contentId, postId } = makePost(db, { publishedAt: '2026-08-01T12:00:00.000Z', durationS: 30, caption: 'caption' });
  run(db, `INSERT INTO transcripts (content_id, source, model, text, segments_json) VALUES (?, 'whisper_cpp', 'test', ?, ?)`, contentId, 'hello world', JSON.stringify([{ start: 0, end: 2, text: 'hello world' }]));
  writeMetrics(db, postId, label === 'winner' ? { reach: 5000, shares: 200, comments: 90, saves: 80, likes: 400, avg_watch_time_ms: 20000 } : { reach: 1000, shares: 10, comments: 5, saves: 5, likes: 50, avg_watch_time_ms: 9000 }, '2026-08-20T12:00:00.000Z', 'test');
  for (let i = 0; i < 12; i++) {
    const other = makePost(db, { publishedAt: `2026-07-${String(i + 1).padStart(2, '0')}T12:00:00.000Z`, durationS: 30 });
    writeMetrics(db, other.postId, { reach: 1000, shares: 12, comments: 6, saves: 6, likes: 55, avg_watch_time_ms: 10000 }, '2026-08-20T12:00:00.000Z', 'test');
  }
  computeAllScores(db, activeScoreVersion(db), new Date('2026-09-01T00:00:00.000Z'));
  return contentId;
}

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  models = [];
  setGenerator(null);
  process.env.GEMINI_API_KEY = 'test';
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  process.env.GEMINI_MODEL_PRIMARY = 'gemini-2.5-flash';
  process.env.GEMINI_MODEL_FALLBACKS = 'gemini-2.5-flash-lite';
  process.env.AI_RETRY_BACKOFF_MS = '0';
  process.env.AI_ESCALATE_BELOW_CONFIDENCE = '0.45';
});

afterEach(() => {
  setProviderFetch(null);
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('disagreement escalation', () => {
  it('does not run a second model when the cheap one is confident', async () => {
    const db = testDb();
    const id = seedPost(db, 'plain');
    setProviderFetch(mockGemini(() => coding({}, 'high')));

    const out = await enrichContent(db, id);

    expect(out.status).toBe('enriched');
    expect(models).toEqual(['gemini-2.5-flash-lite']); // cheap model only
    expect(all(db, 'SELECT 1 FROM coding_escalations')).toHaveLength(0);
  });

  it('escalates a low-confidence coding to the stronger model', async () => {
    const db = testDb();
    const id = seedPost(db, 'plain');
    setProviderFetch(mockGemini((model) => (model.includes('lite') ? coding({}, 'low') : coding({ hook_type: 'question' }, 'high'))));

    await enrichContent(db, id);

    expect(models).toEqual(['gemini-2.5-flash-lite', 'gemini-2.5-flash']);
    const esc = get<{ reason: string; outcome: string; base_model: string; escalated_model: string; compared: number; agreed: number }>(db, 'SELECT reason, outcome, base_model, escalated_model, compared, agreed FROM coding_escalations')!;
    expect(esc.reason).toContain('low confidence');
    expect(esc.base_model).toBe('gemini-2.5-flash-lite');
    expect(esc.escalated_model).toBe('gemini-2.5-flash');
    expect(esc.compared).toBeGreaterThan(0);
    // The stronger model's value is the one that lands in the knowledge base.
    expect(get<{ v: string }>(db, `SELECT value_text v FROM content_attribute_current WHERE content_id = ? AND key = 'hook_type'`, id)?.v).toBe('question');
  });

  it('escalates when a required field comes back uncoded, even at high confidence', async () => {
    const db = testDb();
    const id = seedPost(db, 'plain');
    setProviderFetch(mockGemini((model) => (model.includes('lite') ? coding({ hook_type: null }, 'high') : coding({}, 'high'))));

    await enrichContent(db, id);

    expect(models).toHaveLength(2);
    expect(get<{ reason: string }>(db, 'SELECT reason FROM coding_escalations')?.reason).toContain('validation failed');
  });

  it('sends a substantial two-model disagreement to human review', async () => {
    const db = testDb();
    const id = seedPost(db, 'plain');
    setProviderFetch(
      mockGemini((model) =>
        model.includes('lite')
          ? coding({}, 'low')
          : coding({ hook_type: 'accusation', opening_type: 'host_statement', tension_type: 'status', emotional_trigger: 'outrage', share_trigger_type: 'shocking', comment_trigger_type: 'disagreement' }, 'high')
      )
    );

    await enrichContent(db, id);

    const esc = get<{ outcome: string; disagreements_json: string }>(db, 'SELECT outcome, disagreements_json FROM coding_escalations')!;
    expect(esc.outcome).toBe('human_review');
    expect(JSON.parse(esc.disagreements_json).length).toBeGreaterThanOrEqual(5);
  });

  it('keeps the cheap coding but flags it for a human when no stronger model can answer', async () => {
    const db = testDb();
    const id = seedPost(db, 'plain');
    setProviderFetch(
      mockGemini((model) => {
        if (!model.includes('lite')) throw new Error('stronger model down');
        return coding({}, 'low');
      })
    );

    const out = await enrichContent(db, id);

    expect(out.status).toBe('enriched');
    expect(get<{ v: string }>(db, `SELECT value_text v FROM content_attribute_current WHERE content_id = ? AND key = 'hook_type'`, id)?.v).toBe('confession');
    const esc = get<{ outcome: string; reason: string; escalated_run_id: number | null }>(db, 'SELECT outcome, reason, escalated_run_id FROM coding_escalations')!;
    expect(esc.outcome).toBe('human_review');
    expect(esc.reason).toContain('no stronger model was available');
    expect(esc.escalated_run_id).toBeNull();
  });

  it('never escalates to the same model that was unsure', async () => {
    process.env.GEMINI_MODEL_FALLBACKS = 'gemini-2.5-flash'; // collapses to the primary alone
    const db = testDb();
    const id = seedPost(db, 'plain');
    setProviderFetch(mockGemini(() => coding({}, 'low')));

    await enrichContent(db, id);

    // Only gemini-2.5-flash is configured: it coded the post, so there is nothing stronger to ask.
    expect(models).toEqual(['gemini-2.5-flash']);
  });

  it('never escalates a benchmark run pinned to one model', async () => {
    const db = testDb();
    const id = seedPost(db, 'plain');
    setProviderFetch(mockGemini(() => coding({}, 'low')));

    await enrichContent(db, id, { noEscalate: true });

    expect(models).toHaveLength(1);
  });

  it('replaces a previous model\'s coding instead of mixing it field by field', async () => {
    const db = testDb();
    const id = seedPost(db, 'plain');
    // Previous model filled tension_type; the new one leaves it null.
    setProviderFetch(mockGemini(() => coding({ tension_type: 'status' }, 'high')));
    await enrichContent(db, id);
    run(db, `INSERT INTO content_attributes (content_id, key, value_text, source) VALUES (?, 'hook_type', 'question', 'human')`, id);

    setProviderFetch(mockGemini(() => coding({ tension_type: null, hook_type: 'accusation' }, 'high')));
    await enrichContent(db, id);

    const ai = (key: string) => get<{ v: string }>(db, `SELECT value_text v FROM content_attributes WHERE content_id = ? AND key = ? AND source = 'ai'`, id, key)?.v ?? null;
    expect(ai('tension_type')).toBeNull(); // not the stale 'status'
    expect(ai('hook_type')).toBe('accusation');
    // A human decision is never cleared by a re-code.
    expect(get<{ v: string }>(db, `SELECT value_text v FROM content_attribute_current WHERE content_id = ? AND key = 'hook_type'`, id)?.v).toBe('question');
  });

  it('only clears AI coding fields', () => {
    const db = testDb();
    const id = seedPost(db, 'plain');
    run(db, `INSERT INTO content_attributes (content_id, key, value_text, source) VALUES (?, 'hook_type', 'confession', 'ai'), (?, 'duration_bucket', '15_30s', 'measured')`, id, id);
    clearAiCoding(db, id);
    expect(all(db, 'SELECT key, source FROM content_attributes WHERE content_id = ?', id)).toEqual([{ key: 'duration_bucket', source: 'measured' }]);
  });
});

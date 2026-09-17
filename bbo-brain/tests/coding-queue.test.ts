import { describe, expect, it } from 'vitest';
import { all, get, run, type Db } from '@/lib/db/client';
import { setAttribute, writeMetrics } from '@/lib/ingest/ingest';
import { activeScoreVersion, computeAllScores } from '@/lib/scoring/engine';
import { buildQueue, corpusStatus, processedToday, tierFor } from '@/lib/sync/media-queue';
import { loadFacts } from '@/lib/intel/dataset';
import { accuracyByModel, codingAccuracy, coverageStats, recordReview, validationSample } from '@/lib/intel/validation';
import { benchmarkReport, pairAgreement } from '@/lib/intel/benchmark';
import { ATTRIBUTE_DEFINITIONS } from '@/lib/seed/reference';
import { makePost, testDb } from './helpers';

// Synthetic fixture — never shown as BBO data.
const DAY = 86_400_000;
const NOW = new Date('2026-09-16T12:00:00.000Z');

type Strength = 'strong' | 'weak' | 'mid';

function seedCatalogue(db: Db): Db {
  // 60 posts over two years: a third strong, a third weak, a third middling,
  // split across two franchises so the per-franchise cap has something to bite on.
  for (let i = 0; i < 60; i++) {
    const publishedAt = new Date(NOW.getTime() - (i * 12 + 3) * DAY).toISOString();
    const strength: Strength = i % 3 === 0 ? 'strong' : i % 3 === 1 ? 'weak' : 'mid';
    const { contentId, postId } = makePost(db, {
      publishedAt,
      durationS: 30,
      franchiseSlug: i % 4 === 0 ? 'street-interview' : 'podcast',
      title: `Fixture ${i} (${strength})`,
    });
    const base = { reach: 1000 + (i % 7) * 25, likes: 50, saves: 6, avg_watch_time_ms: 12000, skip_rate: 35 };
    writeMetrics(
      db,
      postId,
      strength === 'strong'
        ? { ...base, shares: 40, comments: 18, saves: 14, avg_watch_time_ms: 17000, skip_rate: 25 }
        : strength === 'weak'
          ? { ...base, shares: 2, comments: 2, saves: 2, avg_watch_time_ms: 7000, skip_rate: 55 }
          : { ...base, shares: 11, comments: 7 },
      new Date(new Date(publishedAt).getTime() + 10 * DAY).toISOString(),
      'test'
    );
  }
  computeAllScores(db, activeScoreVersion(db), NOW);
  return db;
}

/** Marks media as already fetched so the post is a candidate for coding. */
function giveMedia(db: Db, contentIds: number[], fetchedAt = NOW.toISOString(), opts: { transcript?: boolean } = {}) {
  for (const id of contentIds) {
    run(db, 'UPDATE content SET thumb_path = ?, media_fetched_at = ? WHERE id = ?', `/tmp/fixture-${id}.jpg`, fetchedAt, id);
    if (opts.transcript !== false) run(db, `INSERT OR IGNORE INTO transcripts (content_id, source, model, text) VALUES (?, 'whisper_cpp', 'test', 'words')`, id);
  }
}

function codeIt(db: Db, contentId: number, values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) setAttribute(db, contentId, key, value, 'ai', 0.8);
  run(db, 'UPDATE content SET coded_at = ? WHERE id = ?', NOW.toISOString(), contentId);
}

describe('media/coding priority queue', () => {
  it('tiers by decision value, not by date', () => {
    const db = seedCatalogue(testDb());
    const facts = loadFacts(db);
    const recentWinner = facts.find((f) => (f.label === 'WINNER' || f.label === 'BREAKOUT') && new Date(f.publishedAt).getTime() >= NOW.getTime() - 90 * DAY);
    const oldWinner = facts.find((f) => (f.label === 'WINNER' || f.label === 'BREAKOUT') && new Date(f.publishedAt).getTime() < NOW.getTime() - 90 * DAY);
    const oldLoser = facts.find((f) => f.label === 'LOSER' && new Date(f.publishedAt).getTime() < NOW.getTime() - 90 * DAY);

    expect(recentWinner && tierFor(recentWinner, NOW).tier).toBe(1);
    expect(oldWinner && tierFor(oldWinner, NOW).tier).toBe(2);
    expect(oldLoser && tierFor(oldLoser, NOW).tier).toBe(3);
  });

  it('does not process in chronological order', () => {
    const db = seedCatalogue(testDb());
    const queue = buildQueue(db, { limit: 12, stage: 'media', now: NOW });
    const published = queue.map((q) => q.publishedAt);

    expect(queue).toHaveLength(12);
    expect(published).not.toEqual([...published].sort().reverse()); // not newest-first
    expect(queue.every((q) => q.reason.length > 0)).toBe(true);

    // The claim is that the queue is worth more than the FIFO batch it replaced:
    // same size, lower (better) average tier.
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const fifo = [...loadFacts(db)].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1)).slice(0, 12);
    expect(avg(queue.map((q) => q.tier))).toBeLessThan(avg(fifo.map((f) => tierFor(f, NOW).tier)));
  });

  it('stays balanced when a run stops early', () => {
    // A daily cap, an API quota or an interrupted job must not leave a corpus
    // made only of winners — the contrast is the whole point.
    const db = seedCatalogue(testDb());
    const partial = buildQueue(db, { limit: 12, stage: 'media', now: NOW });
    const counts = new Map<string, number>();
    for (const q of partial) counts.set(q.corpusClass, (counts.get(q.corpusClass) ?? 0) + 1);

    expect(counts.size).toBeGreaterThanOrEqual(3);
    expect(Math.max(...counts.values()) / partial.length).toBeLessThanOrEqual(0.5);
    expect(counts.get('winner')).toBeGreaterThan(0);
    expect(counts.get('loser')).toBeGreaterThan(0);
  });

  it('contrasts winners against losers instead of loading up on winners', () => {
    const db = seedCatalogue(testDb());
    const queue = buildQueue(db, { limit: 20, stage: 'media', now: NOW });
    const classes = new Set(queue.map((q) => q.corpusClass));

    expect(classes.has('winner')).toBe(true);
    expect(classes.has('loser')).toBe(true);
    expect(queue.filter((q) => q.corpusClass === 'winner').length).toBeLessThan(queue.length);
  });

  it('caps how much of one batch a single franchise can take', () => {
    const db = seedCatalogue(testDb());
    const limit = 8; // two franchises in the fixture, cap of 4 each: the cap is reachable without relaxing
    const queue = buildQueue(db, { limit, stage: 'media', now: NOW });
    const counts = new Map<string, number>();
    for (const q of queue) counts.set(q.franchise ?? '—', (counts.get(q.franchise ?? '—') ?? 0) + 1);

    expect(queue).toHaveLength(limit);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(Math.max(4, Math.ceil(limit * 0.35)));
  });

  it('still fills the batch when the caps cannot all be honoured', () => {
    // Balance is a preference, not a reason to under-use a run: once the caps
    // bind, the remaining slots fall back to plain priority order.
    const db = seedCatalogue(testDb());
    const queue = buildQueue(db, { limit: 14, stage: 'media', now: NOW });

    expect(queue).toHaveLength(14);
    expect(new Set(queue.map((q) => q.contentId)).size).toBe(14);
  });

  it('separates the media stage from the coding stage', () => {
    const db = seedCatalogue(testDb());
    const first = buildQueue(db, { limit: 5, stage: 'media', now: NOW });
    expect(buildQueue(db, { limit: 5, stage: 'coding', now: NOW })).toHaveLength(0); // nothing has media yet

    giveMedia(db, first.map((q) => q.contentId));
    const coding = buildQueue(db, { limit: 5, stage: 'coding', now: NOW });
    expect(coding.map((q) => q.contentId).sort()).toEqual(first.map((q) => q.contentId).sort());
    expect(coding.every((q) => q.needsCoding)).toBe(true);
  });

  it('does not queue a post for coding when there is nothing to read', () => {
    const db = seedCatalogue(testDb());
    const [withWords, thumbOnly] = loadFacts(db).slice(0, 2).map((f) => f.contentId);
    giveMedia(db, [withWords]);
    giveMedia(db, [thumbOnly], NOW.toISOString(), { transcript: false });
    const ids = buildQueue(db, { limit: 50, stage: 'coding', now: NOW }).map((q) => q.contentId);

    expect(ids).toContain(withWords);
    expect(ids).not.toContain(thumbOnly);
  });

  it('counts only today for the daily throughput cap', () => {
    const db = seedCatalogue(testDb());
    const ids = loadFacts(db).slice(0, 4).map((f) => f.contentId);
    giveMedia(db, ids.slice(0, 3));
    giveMedia(db, ids.slice(3), new Date(NOW.getTime() - 3 * DAY).toISOString());

    expect(processedToday(db, 'media_fetched_at', NOW)).toBe(3);
  });

  it('reports corpus progress per class', () => {
    const db = seedCatalogue(testDb());
    const winners = loadFacts(db).filter((f) => f.label === 'WINNER' || f.label === 'BREAKOUT').slice(0, 3);
    giveMedia(db, winners.map((f) => f.contentId));
    for (const w of winners) codeIt(db, w.contentId, { hook_type: 'confession' });

    const status = corpusStatus(db, NOW);
    expect(status.coded).toBe(3);
    expect(status.classes.winner.coded).toBe(3);
    expect(status.classes.winner.remaining).toBe(status.classes.winner.target - 3);
    expect(status.classes.loser.coded).toBe(0);
  });
});

describe('controlled coding vocabulary', () => {
  const byKey = new Map(ATTRIBUTE_DEFINITIONS.map((d) => [d.key, d]));

  it('pins hook types to the agreed list', () => {
    expect(byKey.get('hook_type')?.values).toEqual([
      'confession',
      'controversial_statement',
      'direct_opinion',
      'question',
      'accusation',
      'disagreement',
      'surprising_fact',
      'story_opening',
      'challenge',
      'emotional_statement',
      'sexual_relationship_tension',
      'status_clout_statement',
      'humor',
      'curiosity_gap',
      'payoff_first',
      'other',
    ]);
  });

  it('pins opening types to the agreed list', () => {
    expect(byKey.get('opening_type')?.values).toEqual(['interviewer_question', 'guest_answer', 'host_statement', 'reaction', 'argument_in_progress', 'text_first', 'visual_first', 'other']);
  });

  it('gives every coded enum a closed vocabulary with an "other" escape hatch', () => {
    for (const key of ['hook_type', 'opening_type', 'tension_type', 'emotional_trigger', 'share_trigger_type', 'comment_trigger_type', 'curiosity_trigger_type']) {
      const def = byKey.get(key);
      expect(def, key).toBeTruthy();
      expect(def!.type, key).toBe('enum');
      expect(def!.values!.length, key).toBeGreaterThan(2);
      expect(def!.values, key).toContain('other');
    }
  });
});

describe('human validation of AI coding', () => {
  function seedCoded(db: Db) {
    const facts = loadFacts(db);
    const chosen = [
      ...facts.filter((f) => f.label === 'WINNER' || f.label === 'BREAKOUT').slice(0, 6),
      ...facts.filter((f) => f.label === 'LOSER').slice(0, 6),
      ...facts.filter((f) => f.label === 'AVERAGE').slice(0, 6),
    ];
    giveMedia(db, chosen.map((f) => f.contentId));
    for (const f of chosen) codeIt(db, f.contentId, { hook_type: 'confession', opening_type: 'guest_answer' });
    return chosen.map((f) => f.contentId);
  }

  it('samples across outcomes, not just winners', () => {
    const db = seedCatalogue(testDb());
    seedCoded(db);
    const sample = validationSample(db, 12);
    const classes = new Set(sample.map((r) => r.corpusClass));

    expect(sample.length).toBeGreaterThan(0);
    expect(classes.size).toBeGreaterThanOrEqual(2);
    expect(sample.every((r) => r.status === 'UNREVIEWED')).toBe(true);
  });

  it('keeps an approval without inventing human attributes', () => {
    const db = seedCatalogue(testDb());
    const [id] = seedCoded(db);
    const { changed } = recordReview(db, { contentId: id, status: 'APPROVED' });

    expect(changed).toEqual([]);
    expect(get<{ s: string }>(db, 'SELECT coding_validation_status AS s FROM content WHERE id = ?', id)?.s).toBe('APPROVED');
    expect(all(db, `SELECT 1 FROM content_attributes WHERE content_id = ? AND source = 'human'`, id)).toHaveLength(0);
  });

  it('stores a correction as a human value that outranks the AI', () => {
    const db = seedCatalogue(testDb());
    const [id] = seedCoded(db);
    const { changed } = recordReview(db, { contentId: id, status: 'EDITED', values: { hook_type: 'question', opening_type: 'guest_answer' }, note: 'It opens on the interviewer.' });

    expect(changed).toEqual(['hook_type']); // only the field that actually differed
    expect(get<{ v: string; source: string }>(db, 'SELECT value_text AS v, source FROM content_attribute_current WHERE content_id = ? AND key = ?', id, 'hook_type')).toEqual({
      v: 'question',
      source: 'human',
    });
    expect(get<{ ai: string; human: string }>(db, 'SELECT ai_value AS ai, human_value AS human FROM attribute_corrections WHERE content_id = ? AND key = ?', id, 'hook_type')).toEqual({
      ai: 'confession',
      human: 'question',
    });
  });

  it('measures per-attribute agreement from real corrections only', () => {
    const db = seedCatalogue(testDb());
    const ids = seedCoded(db);
    recordReview(db, { contentId: ids[0], status: 'EDITED', values: { hook_type: 'question' } });
    recordReview(db, { contentId: ids[1], status: 'APPROVED' });
    recordReview(db, { contentId: ids[2], status: 'APPROVED' });
    recordReview(db, { contentId: ids[3], status: 'APPROVED' });

    const accuracy = codingAccuracy(db);
    const hook = accuracy.attributes.find((a) => a.key === 'hook_type')!;
    const opening = accuracy.attributes.find((a) => a.key === 'opening_type')!;

    expect(accuracy.reviewed).toBe(4);
    expect(hook.aiCoded).toBe(4);
    expect(hook.corrected).toBe(1);
    expect(hook.agreement).toBeCloseTo(0.75, 5);
    expect(opening.agreement).toBe(1); // never corrected
  });

  it('records which provider and model produced each reviewed label', () => {
    const db = seedCatalogue(testDb());
    const ids = seedCoded(db);
    const cheap = run(db, `INSERT INTO ai_runs (workflow, status, provider, model, input_json) VALUES ('enrichment', 'ok', 'openrouter', 'qwen/qwen3-235b-a22b-2507', '{}')`).lastId;
    const strong = run(db, `INSERT INTO ai_runs (workflow, status, provider, model, input_json) VALUES ('enrichment', 'ok', 'gemini', 'gemini-2.5-flash', '{}')`).lastId;
    run(db, `UPDATE content_attributes SET ai_run_id = ? WHERE content_id IN (?, ?) AND source = 'ai'`, cheap, ids[0], ids[1]);
    run(db, `UPDATE content_attributes SET ai_run_id = ? WHERE content_id = ? AND source = 'ai'`, strong, ids[2]);

    recordReview(db, { contentId: ids[0], status: 'EDITED', values: { hook_type: 'question' } });
    recordReview(db, { contentId: ids[1], status: 'APPROVED' });
    recordReview(db, { contentId: ids[2], status: 'APPROVED' });

    const byModel = accuracyByModel(db).filter((r) => r.key === 'hook_type');
    expect(byModel).toEqual([
      { model: 'gemini/gemini-2.5-flash', key: 'hook_type', reviewed: 1, agreed: 1, agreement: 1 },
      { model: 'openrouter/qwen/qwen3-235b-a22b-2507', key: 'hook_type', reviewed: 2, agreed: 1, agreement: 0.5 },
    ]);
    expect(get<{ ai: string; human: string; model: string }>(db, 'SELECT ai_value ai, human_value human, ai_model model FROM attribute_corrections WHERE content_id = ?', ids[0])).toEqual({
      ai: 'confession',
      human: 'question',
      model: 'qwen/qwen3-235b-a22b-2507',
    });
  });

  it('puts a rejected coding back in the queue', () => {
    const db = seedCatalogue(testDb());
    const [id] = seedCoded(db);
    expect(buildQueue(db, { limit: 50, stage: 'coding', now: NOW }).some((q) => q.contentId === id)).toBe(false);

    recordReview(db, { contentId: id, status: 'REJECTED', note: 'Transcript is mostly music.' });

    expect(get<{ coded: string | null }>(db, 'SELECT coded_at AS coded FROM content WHERE id = ?', id)?.coded).toBeNull();
    expect(buildQueue(db, { limit: 50, stage: 'coding', now: NOW }).some((q) => q.contentId === id)).toBe(true);
  });

  it('reports coverage as a share of the whole catalogue, not of the coded sample', () => {
    const db = seedCatalogue(testDb());
    const ids = seedCoded(db);
    recordReview(db, { contentId: ids[0], status: 'APPROVED' });

    const stats = coverageStats(db);
    expect(stats.total).toBe(60);
    expect(stats.coded).toBe(ids.length);
    expect(stats.humanValidated).toBe(1);
    expect(stats.unreviewed).toBe(ids.length - 1);
    expect(stats.fields.find((f) => f.key === 'hook_type')?.coded).toBe(ids.length);
  });
});

describe('coding benchmark accounting', () => {
  function addBenchmark(db: Db, model: string, outputs: Array<[number, Record<string, unknown> | null, string[]]>) {
    const runId = run(db, `INSERT INTO benchmark_runs (name, task_class, provider, model) VALUES (?, 'coding', 'openrouter', ?)`, model, model).lastId;
    for (const [contentId, attributes, violations] of outputs) {
      run(
        db,
        `INSERT INTO benchmark_codings (benchmark_run_id, content_id, status, output_json, taxonomy_violations_json, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, 2000, 500)`,
        runId,
        contentId,
        attributes ? 'ok' : 'schema_failed',
        attributes ? JSON.stringify({ attributes, topics: [] }) : null,
        JSON.stringify(violations)
      );
    }
    return runId;
  }

  it('measures agreement against existing coding without touching it', () => {
    const db = seedCatalogue(testDb());
    const ids = loadFacts(db).slice(0, 4).map((f) => f.contentId);
    for (const id of ids) codeIt(db, id, { hook_type: 'confession', opening_type: 'guest_answer' });
    const before = all(db, `SELECT content_id, key, value_text, source FROM content_attributes ORDER BY content_id, key, source`);

    const runId = addBenchmark(db, 'qwen/qwen3-235b-a22b-2507', [
      [ids[0], { hook_type: 'confession', opening_type: 'guest_answer' }, []],
      [ids[1], { hook_type: 'question', opening_type: 'guest_answer' }, []],
      [ids[2], { hook_type: 'confession', opening_type: 'reaction_shot' }, ['opening_type=reaction_shot']],
      [ids[3], null, []],
    ]);
    const [report] = benchmarkReport(db, [runId]);

    expect(report.posts).toBe(4);
    expect(report.validRate).toBe(0.75);
    expect(report.schemaFailed).toBe(1);
    expect(report.taxonomyViolations).toBe(1);
    expect(report.agreement.hook_type).toEqual({ compared: 3, agreed: 2, rate: 2 / 3 });
    expect(report.costUsd).toBeCloseTo(4 * (2000 * 0.087 + 500 * 0.35) / 1_000_000, 8); // priced from recorded tokens
    expect(all(db, `SELECT content_id, key, value_text, source FROM content_attributes ORDER BY content_id, key, source`)).toEqual(before);
  });

  it('measures a model against its own rerun', () => {
    const db = seedCatalogue(testDb());
    const ids = loadFacts(db).slice(0, 3).map((f) => f.contentId);
    const first = addBenchmark(db, 'm', ids.map((id) => [id, { hook_type: 'confession', opening_type: 'guest_answer' }, []]));
    const second = addBenchmark(db, 'm', [
      [ids[0], { hook_type: 'confession', opening_type: 'guest_answer' }, []],
      [ids[1], { hook_type: 'question', opening_type: 'guest_answer' }, []],
      [ids[2], { hook_type: 'confession', opening_type: 'guest_answer' }, []],
    ]);

    const pair = pairAgreement(db, first, second);
    expect(pair.compared).toBe(6);
    expect(pair.agreed).toBe(5);
    expect(pair.byField.hook_type).toBeCloseTo(2 / 3, 6);
  });
});

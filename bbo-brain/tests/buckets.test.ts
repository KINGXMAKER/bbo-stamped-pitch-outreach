import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { all, get, run, type Db } from '@/lib/db/client';
import { setProviderFetch } from '@/lib/ai/providers/registry';
import { setGenerator } from '@/lib/ai/run';
import { setAttribute, writeMetrics } from '@/lib/ingest/ingest';
import { activeScoreVersion, computeAllScores } from '@/lib/scoring/engine';
import { backfillLegacyBuckets, BUCKET_PROMPT_VERSION, BucketSchema, bucketBenchmarkReport, bucketGate, humanBucketLabels, recordBucketLabel, recordPromptDesignSample } from '@/lib/intel/buckets';
import { mineLessons } from '@/lib/intel/lessons';
import { buildIntelligenceReport } from '@/lib/intel/report';
import { runPipeline } from '@/lib/sync/registry';
import { buildQueue } from '@/lib/sync/media-queue';
import { makePost, testDb } from './helpers';

// Synthetic fixture — never shown as BBO data. No real provider is called.
const NOW = new Date('2026-09-16T12:00:00.000Z');
const DAY = 86_400_000;
const ENV_KEYS = ['GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'AI_BUCKET_PROVIDER', 'AI_BUCKET_MODEL', 'BUCKET_GATE_MIN_LABELS'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  setGenerator(null);
  process.env.OPENROUTER_API_KEY = 'test';
  process.env.AI_BUCKET_PROVIDER = 'openrouter';
  process.env.AI_BUCKET_MODEL = 'candidate/model';
  process.env.BUCKET_GATE_MIN_LABELS = '4';
});

afterEach(() => {
  setProviderFetch(null);
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function post(db: Db, i: number, opts: { franchise?: string; bucket?: string; strong?: boolean; media?: boolean } = {}) {
  const publishedAt = new Date(NOW.getTime() - (i * 4 + 5) * DAY).toISOString();
  const { contentId, postId } = makePost(db, { publishedAt, durationS: 30 });
  if (opts.franchise) setAttribute(db, contentId, 'franchise', opts.franchise, 'heuristic', 0.5);
  if (opts.bucket) setAttribute(db, contentId, 'content_bucket', opts.bucket, 'human', 1);
  // Small per-post jitter: real metrics are never identical, and ties make rank tests meaningless.
  const j = 1 + ((i * 7) % 11) * 0.02;
  writeMetrics(
    db,
    postId,
    opts.strong
      ? { reach: 1000, shares: 40 * j, comments: 18 * j, saves: 14 * j, likes: 60, avg_watch_time_ms: 17000 * j }
      : { reach: 1000, shares: 8 * j, comments: 5 * j, saves: 5 * j, likes: 50, avg_watch_time_ms: 11000 * j },
    new Date(new Date(publishedAt).getTime() + 10 * DAY).toISOString(),
    'test'
  );
  if (opts.media) {
    run(db, 'UPDATE content SET thumb_path = ? WHERE id = ?', `/tmp/fixture-${contentId}.jpg`, contentId);
    run(db, `INSERT INTO transcripts (content_id, source, model, text) VALUES (?, 'whisper_cpp', 'test', 'words')`, contentId);
  }
  return contentId;
}

function addBenchmark(db: Db, model: string, predictions: Array<[number, string, string | null]>, promptVersion = BUCKET_PROMPT_VERSION) {
  const runId = run(
    db,
    `INSERT INTO benchmark_runs (name, task_class, provider, model, params_json) VALUES (?, 'content_bucket', 'openrouter', ?, ?)`,
    model,
    model,
    JSON.stringify({ contentIds: predictions.map((p) => p[0]), promptVersion })
  ).lastId;
  for (const [contentId, bucket, format] of predictions) {
    run(db, `INSERT INTO benchmark_codings (benchmark_run_id, content_id, status, output_json) VALUES (?, ?, 'ok', ?)`, runId, contentId, JSON.stringify({ content_bucket: bucket, interview_format: format, confidence: 'high' }));
  }
  return runId;
}

describe('content bucket taxonomy', () => {
  it('rejects a bucket outside the four', () => {
    expect(BucketSchema.safeParse({ content_bucket: 'PODCAST', interview_format: null, confidence: 'high' }).success).toBe(false);
    expect(BucketSchema.safeParse({ content_bucket: 'BADDIE_OF_THE_MONTH', interview_format: null, confidence: 'high' }).success).toBe(false); // merged into OTHER_IGNORE
    expect(BucketSchema.safeParse({ content_bucket: 'CORE_INTERVIEW_CONTENT', interview_format: 'studio', confidence: 'high' }).data?.interview_format).toBeNull();
  });

  it('maps only unambiguous legacy evidence and never overrides a human label', () => {
    const db = testDb();
    const podcast = post(db, 1, { franchise: 'podcast' });
    const chat = post(db, 2, { franchise: 'bbo-group-chat' });
    const allAccess = post(db, 3, { franchise: 'bbo-all-access' });
    const humanSaid = post(db, 4, { franchise: 'podcast' });
    recordBucketLabel(db, humanSaid, 'BBO_STAMPED', null);

    backfillLegacyBuckets(db);
    const bucket = (id: number) => get<{ v: string }>(db, `SELECT value_text v FROM content_attribute_current WHERE content_id = ? AND key = 'content_bucket'`, id)?.v ?? null;

    expect(bucket(podcast)).toBe('CORE_INTERVIEW_CONTENT');
    expect(get<{ v: string }>(db, `SELECT value_text v FROM content_attribute_current WHERE content_id = ? AND key = 'interview_format'`, podcast)?.v).toBe('podcast');
    expect(bucket(chat)).toBe('OTHER_IGNORE');
    expect(bucket(allAccess)).toBeNull(); // behind-the-scenes could be anything: left to the classifier
    expect(bucket(humanSaid)).toBe('BBO_STAMPED');
  });
});

describe('bucket benchmark and rollout gate', () => {
  function labelled(db: Db) {
    const ids = [post(db, 1), post(db, 2), post(db, 3), post(db, 4), post(db, 5)];
    recordBucketLabel(db, ids[0], 'CORE_INTERVIEW_CONTENT', 'podcast');
    recordBucketLabel(db, ids[1], 'CORE_INTERVIEW_CONTENT', 'street_interview');
    recordBucketLabel(db, ids[2], 'CORE_INTERVIEW_CONTENT', 'podcast');
    recordBucketLabel(db, ids[3], 'BBO_STAMPED', null);
    recordBucketLabel(db, ids[4], 'OTHER_IGNORE', null);
    return ids;
  }

  it('scores only against human labels', () => {
    const db = testDb();
    const ids = labelled(db);
    const unlabelled = post(db, 9, { franchise: 'podcast' });
    backfillLegacyBuckets(db);
    const runId = addBenchmark(db, 'candidate/model', [
      [ids[0], 'CORE_INTERVIEW_CONTENT', 'podcast'],
      [ids[1], 'CORE_INTERVIEW_CONTENT', 'podcast'],
      [ids[2], 'OTHER_IGNORE', null],
      [ids[3], 'BBO_STAMPED', null],
      [ids[4], 'OTHER_IGNORE', null],
      [unlabelled, 'OTHER_IGNORE', null],
    ]);

    const [r] = bucketBenchmarkReport(db, [runId]);
    expect(humanBucketLabels(db).size).toBe(5);
    expect(r.humanLabelled).toBe(5); // the unlabelled post is not scored, whatever the heuristic says
    expect(r.accuracy).toBeCloseTo(4 / 5, 6);
    expect(r.coreRecall).toBeCloseTo(2 / 3, 6);
    expect(r.corePrecision).toBe(1);
    expect(r.formatAccuracy).toBeCloseTo(1 / 2, 6);
    expect(r.confusion.CORE_INTERVIEW_CONTENT.OTHER_IGNORE).toBe(1);
    expect(r.provisionalHeuristicAgreement).toEqual({ compared: 1, agreed: 0 });
  });

  it('holds a classifier that would hide core interview clips, even when overall accuracy looks fine', () => {
    process.env.BUCKET_GATE_MIN_LABELS = '5';
    const db = testDb();
    const ids = labelled(db);
    addBenchmark(db, 'candidate/model', [
      [ids[0], 'CORE_INTERVIEW_CONTENT', 'podcast'],
      [ids[1], 'CORE_INTERVIEW_CONTENT', 'street_interview'],
      [ids[2], 'OTHER_IGNORE', null],
      [ids[3], 'BBO_STAMPED', null],
      [ids[4], 'OTHER_IGNORE', null],
    ]);
    // 80% accuracy clears nothing: the gate needs 85%, and core recall is 67%.
    expect(bucketGate(db).passed).toBe(false);

    const perfect = addBenchmark(db, 'candidate/model', ids.map((id, i) => [id, i < 3 ? 'CORE_INTERVIEW_CONTENT' : i === 3 ? 'BBO_STAMPED' : 'OTHER_IGNORE', i === 1 ? 'street_interview' : i < 3 ? 'podcast' : null]));
    const gate = bucketGate(db);
    expect(gate.passed).toBe(true);
    expect(gate.row?.benchmarkRunId).toBe(perfect);
  });

  it('refuses to require too few labels', () => {
    process.env.BUCKET_GATE_MIN_LABELS = '30';
    const db = testDb();
    const ids = labelled(db);
    addBenchmark(db, 'candidate/model', ids.map((id, i) => [id, i < 3 ? 'CORE_INTERVIEW_CONTENT' : i === 3 ? 'BBO_STAMPED' : 'OTHER_IGNORE', null]));
    expect(bucketGate(db).reason).toContain(`only 5 held-out posts are human-labelled for ${BUCKET_PROMPT_VERSION} (need 30)`);
  });

  it('never lets a prompt pass on the labels that were used to write it', () => {
    const db = testDb();
    const ids = labelled(db);
    const perfect = ids.map((id, i): [number, string, string | null] => [id, i < 3 ? 'CORE_INTERVIEW_CONTENT' : i === 3 ? 'BBO_STAMPED' : 'OTHER_IGNORE', null]);
    // A perfect score from the previous prompt version does not clear the current one…
    addBenchmark(db, 'candidate/model', perfect, 'content-bucket-v1');
    expect(bucketGate(db).passed).toBe(false);
    // …and neither does a perfect score on the posts that shaped the current version.
    recordPromptDesignSample(db, BUCKET_PROMPT_VERSION, ids);
    const runId = addBenchmark(db, 'candidate/model', perfect);
    const [row] = bucketBenchmarkReport(db, [runId]);

    expect(row.humanLabelled).toBe(0);
    expect(row.inSampleLabelled).toBe(5);
    expect(row.inSampleAccuracy).toBe(1);
    expect(bucketGate(db).passed).toBe(false);
  });

  it('scores an old run that named a since-merged bucket as its current bucket', () => {
    const db = testDb();
    const ids = labelled(db);
    const runId = addBenchmark(db, 'candidate/model', [[ids[4], 'BADDIE_OF_THE_MONTH', null]], 'content-bucket-v1');
    expect(bucketBenchmarkReport(db, [runId])[0].accuracy).toBe(1); // human said OTHER_IGNORE
  });

  it('does not call a model to bucket the catalogue until the gate passes', async () => {
    const db = testDb();
    post(db, 1, { franchise: 'podcast' });
    post(db, 2);
    let calls = 0;
    setProviderFetch((async () => {
      calls++;
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as Response;
    }) as typeof fetch);

    const [result] = await runPipeline(db, ['content-buckets']);

    expect(result.status).toBe('succeeded');
    expect(result.summary).toContain('AI classification held');
    expect(calls).toBe(0);
  });
});

describe('priority and scope', () => {
  it('spends no media or coding work on ignored buckets and puts core interview content first', () => {
    const db = testDb();
    const stamped = post(db, 1, { bucket: 'BBO_STAMPED', media: true, strong: true });
    const ignored = post(db, 2, { bucket: 'OTHER_IGNORE', media: true, strong: true });
    const botm = post(db, 3, { bucket: 'BADDIE_OF_THE_MONTH', media: true, strong: true });
    const unknown = post(db, 4, { media: true, strong: true });
    const core = post(db, 5, { bucket: 'CORE_INTERVIEW_CONTENT', media: true });
    for (let i = 10; i < 30; i++) post(db, i);
    computeAllScores(db, activeScoreVersion(db), NOW);

    const ids = buildQueue(db, { limit: 10, stage: 'coding', now: NOW, ignoreTargets: true }).map((q) => q.contentId);

    expect(ids).not.toContain(ignored);
    expect(ids).not.toContain(botm);
    expect(ids.indexOf(core)).toBeLessThan(ids.indexOf(unknown));
    expect(ids.indexOf(unknown)).toBeLessThan(ids.indexOf(stamped));
  });

  it('never pools buckets in one lesson', () => {
    const db = testDb();
    // Stamped posts with a CTA do brilliantly; core posts with the same CTA do not.
    for (let i = 0; i < 64; i++) {
      const bucket = i % 2 === 0 ? 'BBO_STAMPED' : 'CORE_INTERVIEW_CONTENT';
      const cta = i % 4 < 2;
      const id = post(db, i, { bucket, strong: bucket === 'BBO_STAMPED' && cta });
      setAttribute(db, id, 'cta_type', cta ? 'comment_specific' : 'none', 'measured', 1);
    }
    computeAllScores(db, activeScoreVersion(db), NOW);
    mineLessons(db);

    const patterns = all<{ pattern_json: string }>(db, `SELECT pattern_json FROM lessons WHERE origin = 'pattern_mining'`).map((r) => JSON.parse(r.pattern_json) as { bucket?: string });
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns.every((p) => p.bucket === 'CORE_INTERVIEW_CONTENT' || p.bucket === 'BBO_STAMPED')).toBe(true);
  });

  it('reviews core interview content on its own and says what it left out', () => {
    const db = testDb();
    for (let i = 0; i < 12; i++) post(db, i, { bucket: i < 6 ? 'CORE_INTERVIEW_CONTENT' : i < 9 ? 'BBO_STAMPED' : 'OTHER_IGNORE' });
    post(db, 20);
    computeAllScores(db, activeScoreVersion(db), NOW);

    const report = buildIntelligenceReport(db);

    expect(report.scope.bucket).toBe('CORE_INTERVIEW_CONTENT');
    expect(report.scope.inScope).toBe(6);
    expect(report.scope.otherBuckets).toEqual({ BBO_STAMPED: 3, OTHER_IGNORE: 3 });
    expect(report.scope.unbucketed).toBe(1);
  });
});

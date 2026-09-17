import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { all, get, json, nowIso, parseJson, run, type Db } from '@/lib/db/client';
import { brainConfig } from '@/lib/config';
import { BudgetGuard } from '@/lib/ai/budget';
import { estimateCost } from '@/lib/ai/pricing';
import { extractJson, runAi } from '@/lib/ai/run';
import { providerNamed, type Candidate } from '@/lib/ai/providers/registry';
import type { ProviderName } from '@/lib/ai/providers/types';
import { setAttribute } from '@/lib/ingest/ingest';
import { looseConfidence, looseTextNullable } from '@/lib/ai/schema';
import { getSetting, setSetting } from '@/lib/seed';
import {
  BUCKET_DEFINITIONS,
  CONTENT_BUCKETS,
  INTERVIEW_FORMATS,
  LEGACY_FRANCHISE_BUCKET,
  normalizeBucket,
  type ContentBucket,
} from '@/lib/seed/reference';
import type { ContentFact } from './dataset';

/**
 * Content buckets: the scope every performance comparison runs inside.
 *
 * CORE_INTERVIEW_CONTENT >>> BBO_STAMPED >>> OTHER_IGNORE.
 * The classifier is a small, separate prompt so the whole catalogue can be
 * bucketed cheaply from caption and media type — most posts have no media.
 * AI bucket labels only reach the attribute table after a benchmark scored
 * against human labels passes the gate below.
 */

export const CORE = 'CORE_INTERVIEW_CONTENT' as const;
export const STAMPED = 'BBO_STAMPED' as const;
/** Buckets that get structured coding, mining, experiments and recommendations. */
export const ANALYSED_BUCKETS: ContentBucket[] = CONTENT_BUCKETS.filter((b) => BUCKET_DEFINITIONS[b].analysed);

export function bucketOf(fact: Pick<ContentFact, 'attrs'>): ContentBucket | null {
  return normalizeBucket(fact.attrs.content_bucket);
}

export function inBucket<T extends Pick<ContentFact, 'attrs'>>(facts: T[], bucket: ContentBucket): T[] {
  return facts.filter((f) => bucketOf(f) === bucket);
}

/** Ignored buckets never get media work, coding or recommendations. Unknown posts still might be core. */
export function isIgnoredBucket(bucket: ContentBucket | null): boolean {
  return bucket !== null && !BUCKET_DEFINITIONS[bucket].analysed;
}

/** Sort key for work queues: core first, then posts not yet bucketed (most turn out core), then Stamped. */
export function bucketRank(bucket: ContentBucket | null): number {
  if (bucket === CORE) return 0;
  if (bucket === null) return 1;
  return 1 + BUCKET_DEFINITIONS[bucket].priority;
}

/** Maps unambiguous legacy franchise evidence onto buckets. Never overrides AI or human labels. */
export function backfillLegacyBuckets(db: Db): { written: number } {
  const rows = all<{ content_id: number; value_text: string; source: string }>(
    db,
    `SELECT a.content_id, a.value_text, a.source FROM content_attributes a
     WHERE a.key = 'franchise' AND a.source IN ('heuristic', 'audit_v2')
       AND NOT EXISTS (SELECT 1 FROM content_attributes b WHERE b.content_id = a.content_id AND b.key = 'content_bucket')
     ORDER BY CASE a.source WHEN 'audit_v2' THEN 0 ELSE 1 END`
  );
  let written = 0;
  const seen = new Set<number>();
  for (const r of rows) {
    const mapped = LEGACY_FRANCHISE_BUCKET[r.value_text];
    if (!mapped || seen.has(r.content_id)) continue;
    seen.add(r.content_id);
    const source = r.source === 'audit_v2' ? 'audit_v2' : 'heuristic';
    setAttribute(db, r.content_id, 'content_bucket', mapped.bucket, source, 0.6);
    if (mapped.format) setAttribute(db, r.content_id, 'interview_format', mapped.format, source, 0.6);
    written++;
  }
  return { written };
}

// ── Classifier ───────────────────────────────────────────────────────────────

export const BUCKET_PROMPT_VERSION = 'content-bucket-v3';

/**
 * v2 (2026-09-17), from the operator's 40 human labels: Baddie of the Month is
 * OTHER_IGNORE, and posts promoting an episode or upcoming content are
 * OTHER_IGNORE even when they show the conversation.
 * v3: v2 over-applied the promo rule to caption-only videos (no transcript, no
 * frame) and dropped 3 of 16 core clips. The promo rule now needs explicit
 * promotional wording, and missing media is stated not to be evidence of a promo.
 */
const BUCKET_TEMPLATE = `You sort ONE BBO Instagram post into exactly one content bucket. BBO is a New York media brand: podcast, street interviews, venue promotion (BBO Stamped), and assorted social posts.

BUCKETS
${CONTENT_BUCKETS.map((b) => `- ${b}: ${BUCKET_DEFINITIONS[b].description}`).join('\n')}

RULES
- CORE_INTERVIEW_CONTENT is a clip of the conversation itself. Caption cues such as "we discuss", "today we talk", "today we sit with", a question put to the audience about the topic, guests tagged with "ft", or podcast / relationship-talk hashtags point to a core clip. A caption that also says the full episode or interview is on YouTube does not change that.
- Most posts come with no transcript and no frame. Missing media is NOT evidence that a post is a promo or a teaser — judge a caption-only video from its caption.
- Choose OTHER_IGNORE for promotion only when the caption says so explicitly: highlight reels or "highlight moments", episode compilations or recaps, "new episode" / "episode out now" announcements, "new clip dropping", "coming soon", or a multi-part series post such as "Part 3 coming soon". This applies even when the post shows the conversation.
- A clip or post whose purpose is showing or promoting a venue, business, food, drink or event experience is BBO_STAMPED, even when someone is interviewed inside the venue.
- Baddie of the Month features and their behind-the-scenes are OTHER_IGNORE, as are Group Chat carousels, Clock It quotes, announcements and behind-the-scenes posts.
- When a post is neither core nor Stamped by these rules, choose OTHER_IGNORE.
- interview_format: "podcast" for sit-down / studio / panel conversations, "street_interview" for mic-on-the-street questions to passers-by; null when the bucket is not CORE_INTERVIEW_CONTENT or the setting cannot be told.
- Do not quote explicit language.

Return JSON only: {"content_bucket": one of ${CONTENT_BUCKETS.join(' | ')}, "interview_format": "podcast" | "street_interview" | null, "confidence": "low" | "medium" | "high", "reason": "under 20 words"}`;

export const BucketSchema = z.object({
  content_bucket: z.enum(CONTENT_BUCKETS),
  interview_format: z.preprocess((v) => (v === 'podcast' || v === 'street_interview' ? v : null), z.enum(INTERVIEW_FORMATS).nullable()),
  confidence: looseConfidence(),
  reason: looseTextNullable().default(null),
});
export type BucketResult = z.infer<typeof BucketSchema>;

function readImage(path: string | null): { mimeType: string; base64: string } | null {
  if (!path || !existsSync(path)) return null;
  return { mimeType: 'image/jpeg', base64: readFileSync(path).toString('base64') };
}

export function bucketRequest(db: Db, contentId: number): { prompt: string; images: Array<{ mimeType: string; base64: string }>; input: Record<string, unknown> } | null {
  const row = get<{ caption: string | null; media_type: string | null; product: string | null; duration_s: number | null; thumb_path: string | null; frames_json: string | null }>(
    db,
    `SELECT pp.caption, pp.media_type, pp.media_product_type AS product, c.duration_s, c.thumb_path, c.frames_json
     FROM content c JOIN platform_posts pp ON pp.id = c.primary_post_id WHERE c.id = ?`,
    contentId
  );
  if (!row) return null;
  const transcript = get<{ segments_json: string | null; text: string }>(db, 'SELECT segments_json, text FROM transcripts WHERE content_id = ? ORDER BY id DESC LIMIT 1', contentId);
  const opening = transcript
    ? parseJson<Array<{ start: number; text: string }>>(transcript.segments_json, [])
        .filter((s) => s.start <= 45)
        .map((s) => s.text)
        .join(' ')
        .slice(0, 900) || transcript.text.slice(0, 900)
    : null;
  const firstFrame = parseJson<Array<{ path: string }>>(row.frames_json, [])[0]?.path ?? null;
  const image = readImage(firstFrame) ?? readImage(row.thumb_path);
  return {
    prompt: [
      `MEDIA TYPE: ${row.media_type ?? 'unknown'} (${row.product ?? 'unknown'})${row.duration_s ? `, ${Math.round(row.duration_s)}s` : ''}`,
      `CAPTION:\n${(row.caption ?? '').slice(0, 1500) || '(none)'}`,
      opening ? `TRANSCRIPT, FIRST 45 SECONDS:\n${opening}` : 'TRANSCRIPT: not available.',
      image ? 'FRAME: first frame attached.' : 'FRAME: not available.',
    ].join('\n\n'),
    images: image ? [image] : [],
    input: { contentId, hasTranscript: Boolean(transcript), hasImage: Boolean(image), promptVersion: BUCKET_PROMPT_VERSION },
  };
}

export async function classifyBucket(
  db: Db,
  contentId: number,
  opts: { pin?: Candidate; budget?: BudgetGuard; write?: boolean; capture?: Parameters<typeof runAi>[0]['capture'] } = {}
): Promise<{ result: BucketResult; runId: number; retries: number } | null> {
  const request = bucketRequest(db, contentId);
  if (!request) return null;
  const images = opts.pin && !opts.pin.provider.acceptsImages(opts.pin.model) ? undefined : request.images;
  const out = await runAi({
    db,
    workflow: opts.write ? 'content_bucket' : 'content_bucket_benchmark',
    task: 'coding',
    pin: opts.pin,
    budget: opts.budget,
    promptSlug: 'content-bucket',
    template: BUCKET_TEMPLATE,
    schemaVersion: BUCKET_PROMPT_VERSION,
    system: BUCKET_TEMPLATE,
    prompt: request.prompt,
    images,
    schema: BucketSchema,
    input: request.input,
    temperature: 0,
    maxOutputTokens: 200,
    thinkingBudget: 0,
    confidence: (d) => d.confidence,
    capture: opts.capture,
  });
  if (opts.write) {
    const conf = out.data.confidence === 'high' ? 0.8 : out.data.confidence === 'medium' ? 0.6 : 0.4;
    run(db, `DELETE FROM content_attributes WHERE content_id = ? AND key IN ('content_bucket','interview_format') AND source = 'ai'`, contentId);
    setAttribute(db, contentId, 'content_bucket', out.data.content_bucket, 'ai', conf, out.runId);
    if (out.data.content_bucket === CORE && out.data.interview_format) setAttribute(db, contentId, 'interview_format', out.data.interview_format, 'ai', conf, out.runId);
  }
  return { result: out.data, runId: out.runId, retries: out.retries };
}

// ── Benchmark against human labels ───────────────────────────────────────────

/**
 * A sample that covers every bucket the classifier must tell apart: carousels
 * and images (Baddie of the Month, Group Chat, Stamped), reels with each kind of
 * legacy evidence, and reels with none — where most unknown interview clips are.
 * Deterministic, so the same sample can be re-scored after labelling.
 */
export function bucketBenchmarkSample(db: Db, size = 40, exclude: number[] = []): number[] {
  const rows = all<{ id: number; media_type: string; legacy: string | null; published_at: string }>(
    db,
    `SELECT c.id, pp.media_type, (SELECT value_text FROM content_attributes a WHERE a.content_id = c.id AND a.key = 'franchise' AND a.source IN ('heuristic','audit_v2') LIMIT 1) AS legacy, pp.published_at
     FROM content c JOIN platform_posts pp ON pp.id = c.primary_post_id WHERE c.is_demo = 0 ORDER BY (c.id * 2654435761) % 1000003`
  );
  const legacyIs = (...values: string[]) => (r: (typeof rows)[number]) => r.legacy !== null && values.includes(r.legacy);
  const share = (fraction: number) => Math.max(1, Math.round(size * fraction));
  const strata: Array<{ take: number; match: (r: (typeof rows)[number]) => boolean }> = [
    { take: share(0.1), match: legacyIs('baddies-of-the-month') },
    { take: share(0.05), match: legacyIs('bbo-group-chat') },
    { take: share(0.05), match: legacyIs('clock-it') },
    { take: share(0.075), match: legacyIs('announcements', 'bbo-news', 'faceoff') },
    { take: share(0.1), match: legacyIs('bbo-stamped') },
    { take: share(0.075), match: legacyIs('bbo-all-access') },
    { take: share(0.05), match: legacyIs('bbo-after-hours', 'mirror-talk-sessions', 'bbo-court', 'baddie-irl') },
    { take: share(0.2), match: legacyIs('podcast', 'street-interview') },
    { take: share(0.05), match: (r) => r.legacy === null && r.media_type !== 'VIDEO' },
    { take: size, match: (r) => r.legacy === null && r.media_type === 'VIDEO' },
  ];
  const picked: number[] = [];
  const excluded = new Set(exclude);
  for (const stratum of strata) {
    let taken = 0;
    for (const r of rows) {
      if (picked.length >= size || taken >= stratum.take) break;
      if (picked.includes(r.id) || excluded.has(r.id) || !stratum.match(r)) continue;
      picked.push(r.id);
      taken++;
    }
  }
  return picked;
}

export function humanBucketLabels(db: Db): Map<number, { bucket: ContentBucket; format: string | null }> {
  const formats = new Map(all<{ content_id: number; value_text: string }>(db, `SELECT content_id, value_text FROM content_attributes WHERE key = 'interview_format' AND source = 'human'`).map((r) => [r.content_id, r.value_text]));
  return new Map(
    all<{ content_id: number; value_text: string }>(db, `SELECT content_id, value_text FROM content_attributes WHERE key = 'content_bucket' AND source = 'human'`)
      .filter((r) => normalizeBucket(r.value_text) !== null)
      .map((r) => [r.content_id, { bucket: normalizeBucket(r.value_text)!, format: formats.get(r.content_id) ?? null }])
  );
}

/** Records a human bucket decision. An empty format clears it. */
export function recordBucketLabel(db: Db, contentId: number, bucket: ContentBucket, format: string | null): void {
  setAttribute(db, contentId, 'content_bucket', bucket, 'human', 1);
  run(db, `DELETE FROM content_attributes WHERE content_id = ? AND key = 'interview_format' AND source = 'human'`, contentId);
  if (bucket === CORE && format && (INTERVIEW_FORMATS as readonly string[]).includes(format)) setAttribute(db, contentId, 'interview_format', format, 'human', 1);
}

export async function runBucketBenchmark(
  db: Db,
  target: { provider: ProviderName; model: string; label?: string },
  contentIds: number[],
  opts: { budgetUsd?: number } = {}
): Promise<{ benchmarkRunId: number; ok: number; failed: number }> {
  const provider = providerNamed(target.provider);
  if (!provider) throw new Error(`Provider ${target.provider} is not configured.`);
  const benchmarkRunId = run(
    db,
    'INSERT INTO benchmark_runs (name, task_class, provider, model, params_json, notes) VALUES (?, ?, ?, ?, ?, ?)',
    target.label ?? `${target.provider}:${target.model}`,
    'content_bucket',
    target.provider,
    target.model,
    json({ contentIds, promptVersion: BUCKET_PROMPT_VERSION }),
    'Content bucket classifier benchmark.'
  ).lastId;
  const budget = new BudgetGuard(db, opts.budgetUsd ?? 0.25);
  let ok = 0;
  let failed = 0;
  for (const contentId of contentIds) {
    const attempts: Array<{ text: string; latencyMs: number; usage: { inputTokens?: number; outputTokens?: number }; estimatedCost: number }> = [];
    try {
      const r = await classifyBucket(db, contentId, { pin: { provider, model: target.model }, budget, capture: (a) => attempts.push(a) });
      if (!r) continue;
      insertBucketRow(db, benchmarkRunId, contentId, 'ok', r.result, attempts, null, r.retries);
      ok++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const raw = attempts.length ? safeJson(attempts[attempts.length - 1].text) : null;
      insertBucketRow(db, benchmarkRunId, contentId, message.includes('failed validation') ? 'schema_failed' : 'error', raw, attempts, message.slice(0, 400), Math.max(0, attempts.length - 1));
      failed++;
    }
  }
  run(db, 'UPDATE benchmark_runs SET finished_at = ? WHERE id = ?', nowIso(), benchmarkRunId);
  return { benchmarkRunId, ok, failed };
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    return extractJson(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function insertBucketRow(
  db: Db,
  runId: number,
  contentId: number,
  status: 'ok' | 'schema_failed' | 'error',
  output: unknown,
  attempts: Array<{ latencyMs: number; usage: { inputTokens?: number; outputTokens?: number }; estimatedCost: number }>,
  error: string | null,
  retries: number
): void {
  const raw = (output ?? {}) as Record<string, unknown>;
  const violations: string[] = [];
  if (raw.content_bucket !== undefined && !(CONTENT_BUCKETS as readonly unknown[]).includes(raw.content_bucket)) violations.push(`content_bucket=${String(raw.content_bucket).slice(0, 40)}`);
  run(
    db,
    `INSERT INTO benchmark_codings (benchmark_run_id, content_id, status, output_json, error, taxonomy_violations_json, latency_ms, input_tokens, output_tokens, estimated_cost_usd, retry_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (benchmark_run_id, content_id) DO NOTHING`,
    runId,
    contentId,
    status,
    output === null ? null : json(output),
    error,
    json(violations),
    attempts.reduce((a, b) => a + b.latencyMs, 0),
    attempts.reduce((a, b) => a + (b.usage.inputTokens ?? 0), 0),
    attempts.reduce((a, b) => a + (b.usage.outputTokens ?? 0), 0),
    attempts.reduce((a, b) => a + b.estimatedCost, 0),
    retries
  );
}

/**
 * Posts whose human labels shaped a prompt version. Scoring that version on them
 * would grade the prompt on its own homework, so they are reported as in-sample
 * and never count toward the rollout gate.
 */
export function promptDesignSamples(db: Db): Record<string, number[]> {
  return getSetting<Record<string, number[]> | undefined>(db, 'bucket_prompt_design') ?? {};
}

export function recordPromptDesignSample(db: Db, version: string, contentIds: number[]): void {
  setSetting(db, 'bucket_prompt_design', { ...promptDesignSamples(db), [version]: [...new Set(contentIds)] });
}

export type BucketBenchmarkRow = {
  benchmarkRunId: number;
  label: string;
  provider: string;
  model: string;
  promptVersion: string;
  /** Labelled posts that were used to write this prompt version — shown, never gated on. */
  inSampleLabelled: number;
  inSampleAccuracy: number | null;
  posts: number;
  validRate: number;
  taxonomyViolations: number;
  medianLatencyMs: number;
  costPer100Usd: number;
  /** Scored only on posts a human has labelled. */
  humanLabelled: number;
  accuracy: number | null;
  coreRecall: number | null;
  corePrecision: number | null;
  formatAccuracy: number | null;
  confusion: Record<string, Record<string, number>>;
  /** Agreement with legacy caption heuristics — NOT a human reference, shown only while labels are missing. */
  provisionalHeuristicAgreement: { compared: number; agreed: number } | null;
};

export function bucketBenchmarkReport(db: Db, runIds?: number[]): BucketBenchmarkRow[] {
  const runs = all<{ id: number; name: string; provider: string; model: string; params_json: string }>(
    db,
    runIds?.length
      ? `SELECT id, name, provider, model, params_json FROM benchmark_runs WHERE task_class = 'content_bucket' AND id IN (${runIds.map(() => '?').join(',')}) ORDER BY id`
      : `SELECT id, name, provider, model, params_json FROM benchmark_runs WHERE task_class = 'content_bucket' ORDER BY id`,
    ...(runIds ?? [])
  );
  const design = promptDesignSamples(db);
  const human = humanBucketLabels(db);
  const legacy = new Map(
    all<{ content_id: number; value_text: string }>(db, `SELECT content_id, value_text FROM content_attributes WHERE key = 'content_bucket' AND source IN ('heuristic','audit_v2')`).map((r) => [r.content_id, r.value_text])
  );
  return runs.map((r) => {
    const rows = all<{ content_id: number; status: string; output_json: string | null; taxonomy_violations_json: string; latency_ms: number | null; estimated_cost_usd: number; input_tokens: number | null; output_tokens: number | null }>(
      db,
      'SELECT content_id, status, output_json, taxonomy_violations_json, latency_ms, estimated_cost_usd, input_tokens, output_tokens FROM benchmark_codings WHERE benchmark_run_id = ?',
      r.id
    );
    const promptVersion = parseJson<{ promptVersion?: string }>(r.params_json, {}).promptVersion ?? 'content-bucket-v1';
    const inSample = new Set(design[promptVersion] ?? []);
    let inSampleLabelled = 0;
    let inSampleCorrect = 0;
    const confusion: Record<string, Record<string, number>> = {};
    let labelled = 0;
    let correct = 0;
    let coreTruth = 0;
    let corePredicted = 0;
    let coreHit = 0;
    let formatCompared = 0;
    let formatCorrect = 0;
    let legacyCompared = 0;
    let legacyAgreed = 0;
    for (const row of rows) {
      if (row.status !== 'ok' || !row.output_json) continue;
      const out = parseJson<{ content_bucket?: string; interview_format?: string | null }>(row.output_json, {});
      // Older runs may name a bucket that has since been merged; score it as its current bucket.
      const predicted = normalizeBucket(out.content_bucket) ?? '—';
      const truth = human.get(row.content_id);
      if (truth && inSample.has(row.content_id)) {
        inSampleLabelled++;
        if (predicted === truth.bucket) inSampleCorrect++;
      } else if (truth) {
        labelled++;
        confusion[truth.bucket] ??= {};
        confusion[truth.bucket][predicted] = (confusion[truth.bucket][predicted] ?? 0) + 1;
        if (predicted === truth.bucket) correct++;
        if (truth.bucket === CORE) coreTruth++;
        if (predicted === CORE) corePredicted++;
        if (truth.bucket === CORE && predicted === CORE) coreHit++;
        if (truth.bucket === CORE && truth.format && predicted === CORE) {
          formatCompared++;
          if (out.interview_format === truth.format) formatCorrect++;
        }
      }
      const heuristic = legacy.get(row.content_id);
      if (heuristic) {
        legacyCompared++;
        if (normalizeBucket(heuristic) === predicted) legacyAgreed++;
      }
    }
    const latencies = rows.map((x) => x.latency_ms ?? 0).sort((a, b) => a - b);
    const cost = rows.reduce((a, b) => a + Math.max(b.estimated_cost_usd, estimateCost(r.provider, r.model, { inputTokens: b.input_tokens ?? 0, outputTokens: b.output_tokens ?? 0 })), 0);
    return {
      benchmarkRunId: r.id,
      label: r.name,
      provider: r.provider,
      model: r.model,
      promptVersion,
      inSampleLabelled,
      inSampleAccuracy: inSampleLabelled ? inSampleCorrect / inSampleLabelled : null,
      posts: rows.length,
      validRate: rows.length ? rows.filter((x) => x.status === 'ok').length / rows.length : 0,
      taxonomyViolations: rows.reduce((a, b) => a + parseJson<string[]>(b.taxonomy_violations_json, []).length, 0),
      medianLatencyMs: latencies.length ? latencies[Math.floor(latencies.length / 2)] : 0,
      costPer100Usd: rows.length ? (cost / rows.length) * 100 : 0,
      humanLabelled: labelled,
      accuracy: labelled ? correct / labelled : null,
      coreRecall: coreTruth ? coreHit / coreTruth : null,
      corePrecision: corePredicted ? coreHit / corePredicted : null,
      formatAccuracy: formatCompared ? formatCorrect / formatCompared : null,
      confusion,
      provisionalHeuristicAgreement: legacyCompared ? { compared: legacyCompared, agreed: legacyAgreed } : null,
    };
  });
}

/**
 * Rollout gate. The bucket decides what BBO BRAIN analyses at all, so a
 * classifier that drops core interview clips into OTHER_IGNORE would silently
 * hide the content that matters most. AI bucket labels are written to the
 * catalogue only after a human-scored benchmark clears these bars.
 */
export function bucketGate(db: Db, model = brainConfig().bucketModel): { passed: boolean; reason: string; row: BucketBenchmarkRow | null } {
  const cfg = brainConfig();
  // Only the prompt that would actually run counts, scored on posts that did not shape it.
  const rows = bucketBenchmarkReport(db).filter((r) => r.model === model && r.promptVersion === BUCKET_PROMPT_VERSION);
  const row = rows.sort((a, b) => b.humanLabelled - a.humanLabelled || b.benchmarkRunId - a.benchmarkRunId)[0] ?? null;
  if (!row) return { passed: false, reason: `no ${BUCKET_PROMPT_VERSION} benchmark exists for ${model}`, row };
  if (row.humanLabelled < cfg.bucketGateMinLabels) {
    return { passed: false, reason: `only ${row.humanLabelled} held-out posts are human-labelled for ${BUCKET_PROMPT_VERSION} (need ${cfg.bucketGateMinLabels})`, row };
  }
  if ((row.accuracy ?? 0) < cfg.bucketGateMinAccuracy) return { passed: false, reason: `accuracy ${Math.round((row.accuracy ?? 0) * 100)}% is below ${Math.round(cfg.bucketGateMinAccuracy * 100)}%`, row };
  if (row.coreRecall !== null && row.coreRecall < cfg.bucketGateMinCoreRecall) {
    return { passed: false, reason: `core interview recall ${Math.round(row.coreRecall * 100)}% is below ${Math.round(cfg.bucketGateMinCoreRecall * 100)}% — it would hide core clips`, row };
  }
  return { passed: true, reason: `passed on ${row.humanLabelled} human labels: accuracy ${Math.round((row.accuracy ?? 0) * 100)}%, core recall ${row.coreRecall === null ? '—' : `${Math.round(row.coreRecall * 100)}%`}`, row };
}

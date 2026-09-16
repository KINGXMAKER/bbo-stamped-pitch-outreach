import { all, get, json, nowIso, parseJson, run, type Db } from '@/lib/db/client';
import { extractJson, runAi } from '@/lib/ai/run';
import { BudgetGuard } from '@/lib/ai/budget';
import { estimateCost } from '@/lib/ai/pricing';
import type { Candidate } from '@/lib/ai/providers/registry';
import { providerNamed } from '@/lib/ai/providers/registry';
import type { ProviderName } from '@/lib/ai/providers/types';
import { ATTRIBUTE_DEFINITIONS } from '@/lib/seed/reference';
import { codingRequest, EnrichmentSchema } from './analysis';
import { corpusClass } from '@/lib/sync/media-queue';
import { loadFacts } from './dataset';

/**
 * Provider benchmark for structured content coding.
 *
 * A candidate model re-codes posts that are already coded, using the identical
 * prompt and source material. Nothing it returns touches `content_attributes` —
 * results live in `benchmark_codings` — so a cheap model can be evaluated
 * without any chance of it poisoning the knowledge base.
 */

/** The fields a coding model must get right for BBO's comparisons to mean anything. */
export const AGREEMENT_FIELDS = [
  'primary_topic',
  'hook_type',
  'opening_type',
  'question_opening',
  'guest_answer_opening',
  'payoff_first',
  'emotional_trigger',
  'tension_type',
  'share_trigger_type',
  'comment_trigger_type',
  'reaction_shot_present',
] as const;

const REQUIRED_KEYS = ['attributes', 'topics', 'confidence', 'hook_mechanics', 'underlying_debate'];

const allowedValues = (key: string): Set<string> | null => {
  const def = ATTRIBUTE_DEFINITIONS.find((d) => d.key === key);
  if (!def) return null;
  if (def.type === 'boolean') return new Set(['true', 'false']);
  return def.values ? new Set(def.values) : null;
};

/** Stratified across outcome, franchise, topic and hook type — a winners-only benchmark proves nothing. */
export function benchmarkSample(db: Db, size = 25): number[] {
  const coded = new Set(all<{ id: number }>(db, 'SELECT id FROM content WHERE coded_at IS NOT NULL').map((r) => r.id));
  const hooks = new Map(all<{ content_id: number; value_text: string }>(db, `SELECT content_id, value_text FROM content_attribute_current WHERE key = 'hook_type'`).map((r) => [r.content_id, r.value_text]));
  const rows = loadFacts(db)
    .filter((f) => coded.has(f.contentId))
    .map((f) => ({ id: f.contentId, cls: corpusClass(f), franchise: f.franchiseName ?? '—', topics: f.topics.map((t) => t.name), hook: hooks.get(f.contentId) ?? '—' }));

  const picked: number[] = [];
  const franchiseCount = new Map<string, number>();
  const hookCount = new Map<string, number>();
  const classCount = new Map<string, number>();
  const classCap = Math.max(2, Math.ceil(size * 0.45));
  const franchiseCap = Math.max(2, Math.ceil(size * 0.4));
  const hookCap = Math.max(2, Math.ceil(size * 0.35));

  for (const relaxed of [false, true]) {
    for (const r of rows) {
      if (picked.length >= size) return picked;
      if (picked.includes(r.id)) continue;
      if (!relaxed) {
        if ((classCount.get(r.cls) ?? 0) >= classCap) continue;
        if ((franchiseCount.get(r.franchise) ?? 0) >= franchiseCap) continue;
        if ((hookCount.get(r.hook) ?? 0) >= hookCap) continue;
      }
      picked.push(r.id);
      classCount.set(r.cls, (classCount.get(r.cls) ?? 0) + 1);
      franchiseCount.set(r.franchise, (franchiseCount.get(r.franchise) ?? 0) + 1);
      hookCount.set(r.hook, (hookCount.get(r.hook) ?? 0) + 1);
    }
  }
  return picked;
}

export type BenchmarkTarget = { provider: ProviderName; model: string; label?: string };

export async function runCodingBenchmark(
  db: Db,
  target: BenchmarkTarget,
  contentIds: number[],
  opts: { budgetUsd?: number; log?: (event: string, data: Record<string, unknown>) => void } = {}
): Promise<{ benchmarkRunId: number; ok: number; schemaFailed: number; errored: number }> {
  const provider = providerNamed(target.provider);
  if (!provider) throw new Error(`Provider ${target.provider} is not configured.`);
  const pin: Candidate = { provider, model: target.model };
  const benchmarkRunId = run(
    db,
    'INSERT INTO benchmark_runs (name, task_class, provider, model, params_json) VALUES (?, ?, ?, ?, ?)',
    target.label ?? `${target.provider}:${target.model}`,
    'coding',
    target.provider,
    target.model,
    json({ contentIds })
  ).lastId;
  const budget = new BudgetGuard(db, opts.budgetUsd ?? 0.5);
  let ok = 0;
  let schemaFailed = 0;
  let errored = 0;

  for (const contentId of contentIds) {
    const request = codingRequest(db, contentId);
    if (!request) continue;
    const attempts: Array<{ text: string; latencyMs: number; usage: { inputTokens?: number; outputTokens?: number }; estimatedCost: number; isRepair: boolean }> = [];
    try {
      const result = await runAi({
        db,
        workflow: 'coding_benchmark',
        task: 'coding',
        pin,
        budget,
        promptSlug: 'content-enrichment',
        template: 'benchmark',
        schemaVersion: 'enrichment-v1',
        system: request.system,
        prompt: request.prompt,
        images: provider.supportsImages ? request.images : undefined,
        schema: EnrichmentSchema,
        input: { ...request.input, benchmarkRunId },
        temperature: 0.1,
        maxOutputTokens: 2000,
        thinkingBudget: 0,
        capture: (a) => attempts.push(a),
      });
      const raw = attempts.length ? safeJson(attempts[attempts.length - 1].text) : null;
      insertRow(db, benchmarkRunId, contentId, 'ok', result.data, raw, attempts, null, result.retries);
      ok++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isSchema = message.includes('failed validation') || message.includes('not parseable JSON');
      const raw = attempts.length ? safeJson(attempts[attempts.length - 1].text) : null;
      insertRow(db, benchmarkRunId, contentId, isSchema ? 'schema_failed' : 'error', null, raw, attempts, message.slice(0, 500), Math.max(0, attempts.length - 1));
      if (isSchema) schemaFailed++;
      else errored++;
      opts.log?.('benchmark call failed', { contentId, model: target.model, message: message.slice(0, 200) });
      // A provider that is down or out of quota should not burn the whole sample.
      if (!isSchema && errored >= 3 && ok === 0) break;
    }
  }
  run(db, 'UPDATE benchmark_runs SET finished_at = ? WHERE id = ?', nowIso(), benchmarkRunId);
  return { benchmarkRunId, ok, schemaFailed, errored };
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    return extractJson(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function insertRow(
  db: Db,
  benchmarkRunId: number,
  contentId: number,
  status: 'ok' | 'schema_failed' | 'error',
  parsed: unknown,
  raw: Record<string, unknown> | null,
  attempts: Array<{ latencyMs: number; usage: { inputTokens?: number; outputTokens?: number }; estimatedCost: number }>,
  error: string | null,
  retries: number
): void {
  // Taxonomy violations are measured on the RAW answer: the production schema
  // silently drops out-of-vocabulary values, which is exactly what we want in
  // the database and exactly what we must not hide in a benchmark.
  const violations: string[] = [];
  const missing: string[] = [];
  const rawAttrs = (raw?.attributes ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(rawAttrs)) {
    const allowed = allowedValues(key);
    if (!allowed || value === null || value === undefined || value === '') continue;
    if (!allowed.has(String(value))) violations.push(`${key}=${String(value).slice(0, 40)}`);
  }
  for (const key of REQUIRED_KEYS) if (raw && !(key in raw)) missing.push(key);

  run(
    db,
    `INSERT INTO benchmark_codings (benchmark_run_id, content_id, status, output_json, error, taxonomy_violations_json, missing_fields_json,
       latency_ms, input_tokens, output_tokens, estimated_cost_usd, retry_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (benchmark_run_id, content_id) DO NOTHING`,
    benchmarkRunId,
    contentId,
    status,
    parsed === null ? (raw ? json(raw) : null) : json(parsed),
    error,
    json(violations),
    json(missing),
    attempts.reduce((a, b) => a + b.latencyMs, 0),
    attempts.reduce((a, b) => a + (b.usage.inputTokens ?? 0), 0),
    attempts.reduce((a, b) => a + (b.usage.outputTokens ?? 0), 0),
    attempts.reduce((a, b) => a + b.estimatedCost, 0),
    retries
  );
}

export type BenchmarkReportRow = {
  benchmarkRunId: number;
  label: string;
  provider: string;
  model: string;
  posts: number;
  validRate: number;
  schemaFailed: number;
  errored: number;
  taxonomyViolations: number;
  missingFields: number;
  retryRate: number;
  medianLatencyMs: number;
  costUsd: number;
  costPer100Usd: number;
  agreement: Record<string, { compared: number; agreed: number; rate: number | null }>;
  overallAgreement: number | null;
};

/** Agreement is measured against the coding already in the database (Gemini's, human-corrected where reviewed). */
export function benchmarkReport(db: Db, benchmarkRunIds?: number[]): BenchmarkReportRow[] {
  const runs = all<{ id: number; name: string; provider: string; model: string }>(
    db,
    benchmarkRunIds?.length ? `SELECT id, name, provider, model FROM benchmark_runs WHERE id IN (${benchmarkRunIds.map(() => '?').join(',')}) ORDER BY id` : 'SELECT id, name, provider, model FROM benchmark_runs ORDER BY id',
    ...(benchmarkRunIds ?? [])
  );
  return runs.map((r) => {
    const rows = all<{ content_id: number; status: string; output_json: string | null; taxonomy_violations_json: string; missing_fields_json: string; latency_ms: number | null; estimated_cost_usd: number; retry_count: number; input_tokens: number | null; output_tokens: number | null }>(
      db,
      'SELECT content_id, status, output_json, taxonomy_violations_json, missing_fields_json, latency_ms, estimated_cost_usd, retry_count, input_tokens, output_tokens FROM benchmark_codings WHERE benchmark_run_id = ?',
      r.id
    );
    const latencies = rows.map((x) => x.latency_ms ?? 0).sort((a, b) => a - b);
    const agreement: BenchmarkReportRow['agreement'] = {};
    let agreedTotal = 0;
    let comparedTotal = 0;

    for (const field of AGREEMENT_FIELDS) {
      let compared = 0;
      let agreed = 0;
      for (const row of rows) {
        if (row.status !== 'ok' || !row.output_json) continue;
        const candidate = candidateValue(parseJson<Record<string, unknown>>(row.output_json, {}), field);
        const reference = referenceValue(db, row.content_id, field);
        if (candidate === null || reference === null) continue;
        compared++;
        if (candidate === reference) agreed++;
      }
      agreement[field] = { compared, agreed, rate: compared ? agreed / compared : null };
      agreedTotal += agreed;
      comparedTotal += compared;
    }

    const okRows = rows.filter((x) => x.status === 'ok').length;
    // Priced from recorded tokens, so a later price refresh applies to old runs too.
    const cost = rows.reduce((a, b) => a + Math.max(b.estimated_cost_usd, estimateCost(r.provider, r.model, { inputTokens: b.input_tokens ?? 0, outputTokens: b.output_tokens ?? 0 })), 0);
    return {
      benchmarkRunId: r.id,
      label: r.name,
      provider: r.provider,
      model: r.model,
      posts: rows.length,
      validRate: rows.length ? okRows / rows.length : 0,
      schemaFailed: rows.filter((x) => x.status === 'schema_failed').length,
      errored: rows.filter((x) => x.status === 'error').length,
      taxonomyViolations: rows.reduce((a, b) => a + parseJson<string[]>(b.taxonomy_violations_json, []).length, 0),
      missingFields: rows.reduce((a, b) => a + parseJson<string[]>(b.missing_fields_json, []).length, 0),
      retryRate: rows.length ? rows.filter((x) => x.retry_count > 0).length / rows.length : 0,
      medianLatencyMs: latencies.length ? latencies[Math.floor(latencies.length / 2)] : 0,
      costUsd: cost,
      costPer100Usd: rows.length ? (cost / rows.length) * 100 : 0,
      agreement,
      overallAgreement: comparedTotal ? agreedTotal / comparedTotal : null,
    };
  });
}

function candidateValue(output: Record<string, unknown>, field: string): string | null {
  if (field === 'primary_topic') {
    const topics = Array.isArray(output.topics) ? (output.topics as unknown[]) : [];
    const first = topics[0];
    return typeof first === 'string' && first ? first.toLowerCase() : null;
  }
  const attrs = (output.attributes ?? {}) as Record<string, unknown>;
  const value = attrs[field];
  if (value === null || value === undefined || value === '') return null;
  return String(value).toLowerCase();
}

function referenceValue(db: Db, contentId: number, field: string): string | null {
  if (field === 'primary_topic') {
    const row = get<{ name: string }>(
      db,
      'SELECT t.name FROM content_topics ct JOIN topics t ON t.id = ct.topic_id WHERE ct.content_id = ? ORDER BY ct.is_primary DESC, ct.confidence DESC, t.name LIMIT 1',
      contentId
    );
    return row?.name.toLowerCase() ?? null;
  }
  const row = get<{ value_text: string }>(db, 'SELECT value_text FROM content_attribute_current WHERE content_id = ? AND key = ?', contentId, field);
  return row?.value_text?.toLowerCase() ?? null;
}

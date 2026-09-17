import { createHash } from 'node:crypto';
import { unreliableCodedFields } from './validation';
import { all, get, json, nowIso, parseJson, run, tx, type Db } from '@/lib/db/client';
import { comparable, loadFacts, type ContentFact, type MetricKey } from './dataset';
import {
  canonicalPattern,
  evaluatePattern,
  lessonSentence,
  loadLabels,
  parsePattern,
  type Pattern,
  type PatternEvaluation,
} from './patterns';
import { CONFIDENCE_ORDER, STAT_THRESHOLDS, type ConfidenceLabel } from './stats';

export type LessonStatus = 'NEW' | 'OBSERVING' | 'SUPPORTED' | 'WEAKENED' | 'CONTRADICTED' | 'PROMOTED_TO_RULE' | 'ARCHIVED';

/** Era-normalised metrics only — raw rates across years of account growth mostly measure the era. */
export const MINING_METRICS: MetricKey[] = ['performance_score', 'share_rel', 'comment_rel', 'save_rel', 'retention_rel', 'deep_action_rel'];

const RELATIVE_OF: Partial<Record<MetricKey, MetricKey>> = {
  share_rate: 'share_rel',
  comment_rate: 'comment_rel',
  save_rate: 'save_rel',
  retention: 'retention_rel',
  deep_action_rate: 'deep_action_rel',
  reach: 'reach_rel',
};

/** Benjamini–Hochberg: the largest p-value that keeps the false discovery rate at q across a pass. */
export function bhThreshold(pValues: number[], q: number): number {
  const sorted = [...pValues].sort((a, b) => a - b);
  let threshold = 0;
  sorted.forEach((p, i) => {
    if (p <= ((i + 1) / sorted.length) * q) threshold = p;
  });
  return threshold;
}

const rank = (c: ConfidenceLabel) => CONFIDENCE_ORDER.indexOf(c);

/**
 * Status transition for a re-evaluated lesson. Human-final states
 * (PROMOTED_TO_RULE, ARCHIVED) are never changed by mining.
 */
export function nextLessonStatus(current: LessonStatus | null, direction: 'positive' | 'negative' | 'mixed' | null, e: PatternEvaluation): LessonStatus {
  const c = e.comparison;
  if (current === 'PROMOTED_TO_RULE' || current === 'ARCHIVED') return current;
  if (c.verdict === 'insufficient') return current ?? 'NEW';
  const sameDirection = direction === null || direction === 'mixed' || c.verdict === direction;
  if (c.verdict === 'no_difference') return current === null ? 'NEW' : rank(c.confidence) >= rank('EARLY_SIGNAL') ? 'WEAKENED' : current;
  if (!sameDirection) return rank(c.confidence) >= rank('MODERATE_SIGNAL') ? 'CONTRADICTED' : 'WEAKENED';
  if (rank(c.confidence) >= rank('MODERATE_SIGNAL')) return 'SUPPORTED';
  // A thinner read in the same direction is not evidence against an established lesson.
  if (current === 'SUPPORTED') return 'SUPPORTED';
  return current === null ? 'NEW' : 'OBSERVING';
}

function linkEvidence(db: Db, lessonId: number, e: PatternEvaluation): void {
  const c = e.comparison;
  if (c.medianRest === null) return;
  const metric = e.pattern.metric;
  const withValue = e.groupFacts
    .map((f) => ({ f, v: f.rates[metric] }))
    .filter((x): x is { f: ContentFact; v: number } => typeof x.v === 'number');
  const positive = c.verdict !== 'negative';
  const supporting = withValue.filter((x) => (positive ? x.v > c.medianRest! : x.v < c.medianRest!)).sort((a, b) => (positive ? b.v - a.v : a.v - b.v));
  const contradicting = withValue.filter((x) => (positive ? x.v <= c.medianRest! : x.v >= c.medianRest!)).sort((a, b) => (positive ? a.v - b.v : b.v - a.v));
  run(db, `DELETE FROM lesson_content WHERE lesson_id = ? AND relation IN ('supporting','contradicting')`, lessonId);
  for (const x of supporting.slice(0, 6)) run(db, `INSERT INTO lesson_content VALUES (?, ?, 'supporting') ON CONFLICT DO NOTHING`, lessonId, x.f.contentId);
  for (const x of contradicting.slice(0, 6)) run(db, `INSERT INTO lesson_content VALUES (?, ?, 'contradicting') ON CONFLICT DO NOTHING`, lessonId, x.f.contentId);
}

function evidenceJson(e: PatternEvaluation, testsRun: number, streak: number, dataVersion = '') {
  const c = e.comparison;
  return {
    nGroup: c.nGroup,
    nRest: c.nRest,
    medianGroup: c.medianGroup,
    medianRest: c.medianRest,
    effect: c.effect,
    consistency: c.consistency,
    pValue: c.pValue,
    halvesAgree: c.halvesAgree,
    recentEffect: c.recentEffect,
    verdict: c.verdict,
    dateRange: e.dateRange,
    testsRunThisPass: testsRun,
    supportiveStreak: streak,
    /** Latest metric observation the evaluation saw. The streak only grows when this changes. */
    dataVersion,
    evaluatedAt: nowIso(),
  };
}

const CATEGORY_BY_GROUP: Record<string, string> = { hook: 'hook', substance: 'topic', edit: 'editing', packaging: 'captions', timing: 'timing', audit: 'other', structure: 'format' };

/** Upserts one pattern lesson. Returns 'created' | 'updated' | 'unchanged' | 'skipped'. */
export function upsertPatternLesson(
  db: Db,
  e: PatternEvaluation,
  testsRun: number,
  category: string,
  labels = loadLabels(db),
  dataVersion = ''
): 'created' | 'updated' | 'unchanged' | 'skipped' {
  const key = canonicalPattern(e.pattern);
  const c = e.comparison;
  const existing = get<{ id: number; status: LessonStatus; confidence_label: ConfidenceLabel; direction: 'positive' | 'negative' | 'mixed' | null; metrics_json: string | null }>(
    db,
    'SELECT id, status, confidence_label, direction, metrics_json FROM lessons WHERE pattern_json = ?',
    key
  );

  if (!existing) {
    if (c.verdict !== 'positive' && c.verdict !== 'negative') return 'skipped';
    const status = nextLessonStatus(null, null, e);
    return tx(db, () => {
      const code = nextLessonCode(db);
      const { lastId } = run(
        db,
        `INSERT INTO lessons (code, text, category, status, confidence_label, origin, pattern_json, direction, comparison_group, sample_size, effect, metrics_json, evidence, last_evaluated_at)
         VALUES (?, ?, ?, ?, ?, 'pattern_mining', ?, ?, ?, ?, ?, ?, ?, ?)`,
        code,
        lessonSentence(labels, e),
        category,
        status,
        c.confidence,
        key,
        c.verdict,
        e.pattern.compare ? `${e.pattern.key} = ${e.pattern.compare}` : 'all other comparable posts',
        c.nGroup,
        c.effect,
        json(evidenceJson(e, testsRun, rank(c.confidence) >= rank('MODERATE_SIGNAL') ? 1 : 0, dataVersion)),
        'Correlation from stored metrics — not proof of cause.',
        nowIso()
      );
      run(
        db,
        `INSERT INTO lesson_events (lesson_id, from_status, to_status, from_confidence, to_confidence, sample_size, effect, note) VALUES (?, NULL, ?, NULL, ?, ?, ?, ?)`,
        lastId,
        status,
        c.confidence,
        c.nGroup,
        c.effect,
        'First detected by pattern mining.'
      );
      linkEvidence(db, lastId, e);
      return 'created';
    });
  }

  const status = nextLessonStatus(existing.status, existing.direction, e);
  const prev = parseJson<{ supportiveStreak?: number; dataVersion?: string }>(existing.metrics_json, {});
  const supportive = (status === 'SUPPORTED' || status === 'PROMOTED_TO_RULE') && c.verdict === existing.direction;
  // Re-running on the same data is not repeated evidence: only new observations extend the streak.
  const newData = prev.dataVersion !== dataVersion;
  const streak = supportive ? (newData ? (prev.supportiveStreak ?? 0) + 1 : Math.max(prev.supportiveStreak ?? 1, 1)) : 0;
  const confidence = c.verdict === 'insufficient' ? existing.confidence_label : c.confidence;

  return tx(db, () => {
    run(
      db,
      `UPDATE lessons SET text = CASE WHEN ? THEN ? ELSE text END, status = ?, confidence_label = ?, sample_size = ?, effect = ?, metrics_json = ?, last_evaluated_at = ?, updated_at = ? WHERE id = ?`,
      c.verdict === 'insufficient' ? 0 : 1,
      lessonSentence(labels, e),
      status,
      confidence,
      c.nGroup,
      c.effect,
      json(evidenceJson(e, testsRun, streak, dataVersion)),
      nowIso(),
      nowIso(),
      existing.id
    );
    if (c.verdict !== 'insufficient') linkEvidence(db, existing.id, e);
    if (status !== existing.status || confidence !== existing.confidence_label) {
      run(
        db,
        `INSERT INTO lesson_events (lesson_id, from_status, to_status, from_confidence, to_confidence, sample_size, effect, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        existing.id,
        existing.status,
        status,
        existing.confidence_label,
        confidence,
        c.nGroup,
        c.effect,
        `Re-evaluated on ${c.nGroup} vs ${c.nRest} posts (${c.verdict}).`
      );
      return 'updated';
    }
    return 'unchanged';
  });
}

function nextLessonCode(db: Db): string {
  const row = get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM lessons WHERE origin != 'imported_audit'`);
  let n = (row?.n ?? 0) + 1;
  while (get(db, 'SELECT 1 FROM lessons WHERE code = ?', `L-${String(n).padStart(3, '0')}`)) n++;
  return `L-${String(n).padStart(3, '0')}`;
}

/** Latest metric observation per content, for evidence fingerprints. */
function latestObservations(db: Db): Map<number, string> {
  return new Map(
    all<{ content_id: number; observed: string }>(
      db,
      `SELECT pp.content_id, MAX(cm.observed_at) AS observed FROM content_metrics cm JOIN platform_posts pp ON pp.id = cm.platform_post_id GROUP BY pp.content_id`
    ).map((r) => [r.content_id, r.observed])
  );
}

/**
 * What this particular comparison actually looked at: which posts it measured
 * and how fresh their metrics were. A lesson's supportive streak only grows when
 * this changes, so re-running mining — or re-labelling the same posts with a
 * different model — is never counted as new supporting evidence. New posts
 * entering the comparison, or a newer metric sync, are.
 */
export function evidenceVersion(e: PatternEvaluation, latestObserved: Map<number, string>): string {
  const ids = [...new Set([...e.groupFacts, ...e.restFacts].map((f) => f.contentId))].sort((a, b) => a - b);
  let newest = '';
  for (const id of ids) {
    const at = latestObserved.get(id) ?? '';
    if (at > newest) newest = at;
  }
  const digest = createHash('sha1').update(ids.join(',')).digest('hex').slice(0, 12);
  return `${newest}|n:${ids.length}|${digest}`;
}

/** Buckets whose performance is mined, in priority order. Baddie of the Month and other posts are not. */
export const MINED_BUCKETS: string[] = ['CORE_INTERVIEW_CONTENT', 'BBO_STAMPED'];

export type MiningResult = { testsRun: number; created: number; updated: number; imported: number; candidates: number };

/**
 * Mines comparable attributes, topics and recurring guests for associations.
 *
 * Multiple-comparison guard: running hundreds of comparisons guarantees some
 * noise clears an EARLY bar by chance. So a NEW lesson requires MODERATE_SIGNAL
 * or better, except performance_score associations of ≥1.5x / ≤0.67x, which are
 * kept as early signals worth watching. Every lesson records how many tests ran.
 */
export function mineLessons(db: Db, options: { asOf?: string } = {}): MiningResult {
  const facts = comparable(loadFacts(db));
  const result: MiningResult = { testsRun: 0, created: 0, updated: 0, imported: 0, candidates: 0 };
  if (facts.length < STAT_THRESHOLDS.minN * 2) return result;

  // A field human review has shown the model gets wrong more often than not is
  // not evidence: it is excluded from mining until the model improves on it.
  const unreliable = new Set(unreliableCodedFields(db));
  const defs = all<{ key: string; attr_group: string; value_type: string }>(
    db,
    `SELECT key, attr_group, value_type FROM attribute_definitions WHERE is_comparable = 1 AND value_type IN ('enum','boolean')`
  ).filter((d) => !unreliable.has(d.key));
  const patterns: Array<{ pattern: Pattern; category: string }> = [];
  // Every comparison runs inside one content bucket: a venue promo and a podcast
  // clip want different viewer behaviour, so their performance is never pooled.
  for (const bucket of MINED_BUCKETS) {
    const scoped = facts.filter((f) => f.attrs.content_bucket === bucket);
    if (scoped.length < STAT_THRESHOLDS.minN * 2) continue;
    const countValues = (key: string) => {
      const counts = new Map<string, number>();
      for (const f of scoped) {
        const vals = key === 'topic' ? f.topics.map((t) => t.slug) : key === 'person' ? f.people.filter((p) => p.role === 'guest').map((p) => String(p.id)) : f.attrs[key] !== undefined ? [f.attrs[key]] : [];
        for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      return counts;
    };
    for (const def of defs) {
      const counts = countValues(def.key);
      if (counts.size < 2) continue;
      for (const [value, n] of counts) {
        if (n < STAT_THRESHOLDS.minN) continue;
        if (def.value_type === 'boolean' && value === 'false') continue; // the 'true' comparison already covers it
        for (const metric of MINING_METRICS) patterns.push({ pattern: { key: def.key, group: value, metric, bucket }, category: CATEGORY_BY_GROUP[def.attr_group] ?? 'other' });
      }
    }
    for (const key of ['topic', 'person'] as const) {
      for (const [value, n] of countValues(key)) {
        if (n < STAT_THRESHOLDS.minN) continue;
        for (const metric of MINING_METRICS) patterns.push({ pattern: { key, group: value, metric, bucket }, category: key === 'topic' ? 'topic' : 'guest' });
      }
    }
  }

  const evaluated = patterns.map((p) => ({ ...p, e: evaluatePattern(facts, p.pattern, options) }));
  result.testsRun = evaluated.length;
  const labels = loadLabels(db);
  const latestObserved = latestObservations(db);
  // False-discovery control across the whole pass: hundreds of comparisons will
  // produce "significant" noise unless the bar rises with the number of tests.
  const pValues = evaluated.map((x) => x.e.comparison.pValue).filter((p): p is number => typeof p === 'number');
  const fdr10 = bhThreshold(pValues, 0.1);
  const fdr20 = bhThreshold(pValues, 0.2);

  for (const { e, category } of evaluated) {
    const c = e.comparison;
    const known = get(db, 'SELECT 1 FROM lessons WHERE pattern_json = ?', canonicalPattern(e.pattern));
    const p = c.pValue ?? 1;
    const strongEnough = rank(c.confidence) >= rank('MODERATE_SIGNAL') && p <= fdr10;
    const bigScoreEffect = e.pattern.metric === 'performance_score' && c.effect !== null && (c.effect >= 1.5 || c.effect <= 0.67) && c.confidence !== 'INSUFFICIENT_DATA' && p <= fdr20;
    if (!known && !((c.verdict === 'positive' || c.verdict === 'negative') && (strongEnough || bigScoreEffect))) continue;
    result.candidates++;
    const outcome = upsertPatternLesson(db, e, result.testsRun, category, labels, evidenceVersion(e, latestObserved));
    if (outcome === 'created') result.created++;
    if (outcome === 'updated') result.updated++;
  }

  // Imported audit lessons carry the audit's pattern; BBO BRAIN re-checks them against its own data.
  for (const lesson of all<{ id: number; status: LessonStatus; direction: 'positive' | 'negative' | 'mixed' | null; confidence_label: ConfidenceLabel; metrics_json: string | null }>(
    db,
    `SELECT id, status, direction, confidence_label, metrics_json FROM lessons WHERE origin = 'imported_audit' AND pattern_json IS NULL`
  )) {
    const meta = parseJson<{ pattern?: unknown; brainCheck?: unknown; windowStart?: string | null; confounded?: boolean }>(lesson.metrics_json, {});
    const parsed = parsePattern(meta.pattern ? JSON.stringify(meta.pattern) : null);
    if (!parsed) continue;
    const pattern: Pattern = { ...parsed, metric: RELATIVE_OF[parsed.metric] ?? parsed.metric };
    // Re-check the claim in the era the audit studied (its window start onward), not across all history.
    const windowed = meta.windowStart ? facts.filter((f) => f.publishedAt >= meta.windowStart!) : facts;
    const e = evaluatePattern(windowed, pattern, options);
    const c = e.comparison;
    let status = lesson.direction === 'mixed' ? lesson.status : nextLessonStatus(lesson.status, lesson.direction, e);
    // The audit itself flagged this claim as likely confounded: new data may weaken it, never promote it.
    if (meta.confounded && status === 'SUPPORTED' && lesson.status !== 'SUPPORTED') status = lesson.status;
    tx(db, () => {
      run(
        db,
        'UPDATE lessons SET metrics_json = ?, status = ?, last_evaluated_at = ?, updated_at = ? WHERE id = ?',
        json({ ...meta, brainCheck: evidenceJson(e, result.testsRun, 0, evidenceVersion(e, latestObserved)) }),
        status,
        nowIso(),
        nowIso(),
        lesson.id
      );
      if (status !== lesson.status) {
        run(
          db,
          `INSERT INTO lesson_events (lesson_id, from_status, to_status, from_confidence, to_confidence, sample_size, effect, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          lesson.id,
          lesson.status,
          status,
          lesson.confidence_label,
          lesson.confidence_label,
          c.nGroup,
          c.effect,
          `BBO BRAIN re-checked the audit claim on its own data: ${c.verdict}, ${c.effect?.toFixed(2) ?? '—'}x, ${c.nGroup} vs ${c.nRest} posts.`
        );
      }
      if (c.verdict !== 'insufficient') linkEvidence(db, lesson.id, e);
    });
    result.imported++;
  }

  return result;
}

/** Lesson created from one AI analysis: a hypothesis with sample size 1. */
export function createAnalysisLesson(db: Db, input: { text: string; category: string; contentId: number; experiment?: string | null }): number {
  return tx(db, () => {
    const code = nextLessonCode(db);
    const { lastId } = run(
      db,
      `INSERT INTO lessons (code, text, category, status, confidence_label, origin, sample_size, source_content_id, next_test, caveat)
       VALUES (?, ?, ?, 'NEW', 'INSUFFICIENT_DATA', 'ai_analysis', 1, ?, ?, 'Hypothesis from a single post analysis. Needs repeated evidence before it can become a rule.')`,
      code,
      input.text,
      input.category,
      input.contentId,
      input.experiment ?? null
    );
    run(db, `INSERT INTO lesson_content VALUES (?, ?, 'source') ON CONFLICT DO NOTHING`, lastId, input.contentId);
    run(
      db,
      `INSERT INTO lesson_events (lesson_id, from_status, to_status, from_confidence, to_confidence, sample_size, note) VALUES (?, NULL, 'NEW', NULL, 'INSUFFICIENT_DATA', 1, 'Proposed by AI analysis of one post.')`,
      lastId
    );
    return lastId;
  });
}

export function setLessonStatus(db: Db, lessonId: number, status: LessonStatus, note: string): void {
  tx(db, () => {
    const current = get<{ status: string; confidence_label: string; sample_size: number | null; effect: number | null }>(db, 'SELECT status, confidence_label, sample_size, effect FROM lessons WHERE id = ?', lessonId);
    if (!current) throw new Error(`Lesson ${lessonId} not found.`);
    if (current.status === status) return;
    run(db, 'UPDATE lessons SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), lessonId);
    run(
      db,
      `INSERT INTO lesson_events (lesson_id, from_status, to_status, from_confidence, to_confidence, sample_size, effect, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      lessonId,
      current.status,
      status,
      current.confidence_label,
      current.confidence_label,
      current.sample_size,
      current.effect,
      note
    );
  });
}

export const LEGACY_ARCHIVE_TAGS = ['LEGACY_POOLED_ANALYSIS', 'SUPERSEDED_BY_BUCKET_SCOPED_MINING'] as const;

/**
 * Retires lessons mined before content buckets existed. They pooled venue promos,
 * Baddie of the Month posts and interview clips into one comparison, so they are
 * no longer current evidence — but they are never deleted: status, belief history,
 * original metrics, methodology and first-seen date all stay for audit.
 */
export function archiveLegacyPooledLessons(db: Db, note = 'Pooled content buckets; superseded by bucket-scoped mining.'): { archived: number } {
  const rows = all<{ id: number; metrics_json: string | null }>(
    db,
    `SELECT id, metrics_json FROM lessons
     WHERE origin = 'pattern_mining' AND pattern_json IS NOT NULL
       AND json_extract(pattern_json, '$.bucket') IS NULL
       AND status NOT IN ('ARCHIVED','PROMOTED_TO_RULE')`
  );
  for (const row of rows) {
    const meta = parseJson<Record<string, unknown>>(row.metrics_json, {});
    run(
      db,
      'UPDATE lessons SET metrics_json = ? WHERE id = ?',
      json({ ...meta, archived: { tags: [...LEGACY_ARCHIVE_TAGS], at: nowIso(), reason: note, methodology: 'mined across all content buckets before the bucket taxonomy existed' } }),
      row.id
    );
    setLessonStatus(db, row.id, 'ARCHIVED', `${LEGACY_ARCHIVE_TAGS.join(' · ')} — ${note}`);
  }
  return { archived: rows.length };
}

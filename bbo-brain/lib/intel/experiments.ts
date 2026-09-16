import { all, get, json, nowIso, parseJson, run, tx, type Db } from '@/lib/db/client';
import { comparable, loadFacts, METRIC_DEFS, metricValue, type ContentFact, type MetricKey } from './dataset';
import { canonicalPattern, loadLabels, valueLabel } from './patterns';
import { compareGroups, CONFIDENCE_ORDER, type ConfidenceLabel, type GroupComparison } from './stats';

export type ExperimentInput = {
  name: string;
  hypothesis: string;
  variableKey: string | null;
  controlValue: string | null;
  variantValue: string | null;
  primaryMetric: MetricKey;
  secondaryMetrics?: MetricKey[];
  platformId?: string | null;
  franchiseSlug?: string | null;
  topicSlug?: string | null;
  minSamplePerArm?: number;
  origin: 'human' | 'ai' | 'pattern' | 'imported_audit';
};

function nextCode(db: Db): string {
  let n = (get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM experiments')?.n ?? 0) + 1;
  while (get(db, 'SELECT 1 FROM experiments WHERE code = ?', `X-${String(n).padStart(3, '0')}`)) n++;
  return `X-${String(n).padStart(3, '0')}`;
}

export function createExperiment(db: Db, input: ExperimentInput): number {
  if (!(input.primaryMetric in METRIC_DEFS)) throw new Error(`Unknown metric ${input.primaryMetric}`);
  if (input.variableKey && !get(db, 'SELECT 1 FROM attribute_definitions WHERE key = ?', input.variableKey)) {
    throw new Error(`Unknown attribute ${input.variableKey}`);
  }
  const franchise = input.franchiseSlug ? get<{ id: number }>(db, 'SELECT id FROM franchises WHERE slug = ?', input.franchiseSlug) : undefined;
  const topic = input.topicSlug ? get<{ id: number }>(db, 'SELECT id FROM topics WHERE slug = ?', input.topicSlug) : undefined;
  return run(
    db,
    `INSERT INTO experiments (code, name, hypothesis, variable_key, control_value, variant_value, primary_metric, secondary_metrics_json, platform_id, franchise_id, topic_id, min_sample_per_arm, origin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    nextCode(db),
    input.name,
    input.hypothesis,
    input.variableKey,
    input.controlValue,
    input.variantValue,
    input.primaryMetric,
    json(input.secondaryMetrics ?? ['performance_score', 'share_rate', 'comment_rate', 'save_rate']),
    input.platformId ?? 'instagram',
    franchise?.id ?? null,
    topic?.id ?? null,
    input.minSamplePerArm ?? 5,
    input.origin
  ).lastId;
}

export function startExperiment(db: Db, id: number, startDate = nowIso()): void {
  const e = get<{ status: string }>(db, 'SELECT status FROM experiments WHERE id = ?', id);
  if (!e) throw new Error(`Experiment ${id} not found.`);
  if (e.status !== 'proposed') throw new Error(`Only proposed experiments can start (this one is ${e.status}).`);
  run(db, `UPDATE experiments SET status = 'running', start_date = ?, updated_at = ? WHERE id = ?`, startDate, nowIso(), id);
}

export function abandonExperiment(db: Db, id: number, note: string): void {
  run(db, `UPDATE experiments SET status = 'abandoned', result_summary = ?, end_date = ?, updated_at = ? WHERE id = ? AND status IN ('proposed','running')`, note, nowIso(), nowIso(), id);
}

export function assignContent(db: Db, experimentId: number, contentId: number, arm: 'control' | 'variant'): void {
  run(
    db,
    `INSERT INTO experiment_content (experiment_id, content_id, arm, assigned_by) VALUES (?, ?, ?, 'human')
     ON CONFLICT (experiment_id, content_id) DO UPDATE SET arm = excluded.arm, assigned_by = 'human'`,
    experimentId,
    contentId,
    arm
  );
}

type ExperimentRow = {
  id: number;
  code: string;
  name: string;
  status: string;
  variable_key: string | null;
  control_value: string | null;
  variant_value: string | null;
  primary_metric: MetricKey;
  secondary_metrics_json: string;
  platform_id: string | null;
  franchise_id: number | null;
  topic_id: number | null;
  start_date: string | null;
  end_date: string | null;
  min_sample_per_arm: number;
  hypothesis: string;
};

function inScope(db: Db, e: ExperimentRow, f: ContentFact): boolean {
  if (e.platform_id && f.platform !== e.platform_id) return false;
  if (e.franchise_id) {
    const slug = get<{ slug: string }>(db, 'SELECT slug FROM franchises WHERE id = ?', e.franchise_id)?.slug;
    if (f.franchise !== slug) return false;
  }
  if (e.topic_id && !f.topics.some((t) => t.id === e.topic_id)) return false;
  if (e.start_date && f.publishedAt < e.start_date) return false;
  if (e.end_date && f.publishedAt > e.end_date) return false;
  return true;
}

/** Auto-assigns in-scope content by its attribute value. Human assignments are never overwritten. */
export function autoAssign(db: Db, experimentId: number): { control: number; variant: number } {
  const e = get<ExperimentRow>(db, 'SELECT * FROM experiments WHERE id = ?', experimentId);
  if (!e || e.status !== 'running' || !e.variable_key) return { control: 0, variant: 0 };
  const counts = { control: 0, variant: 0 };
  tx(db, () => {
    for (const f of loadFacts(db)) {
      if (!inScope(db, e, f)) continue;
      const value = f.attrs[e.variable_key!];
      const arm = value === e.variant_value ? 'variant' : value === e.control_value ? 'control' : null;
      if (!arm) continue;
      const changes = run(
        db,
        `INSERT INTO experiment_content (experiment_id, content_id, arm, assigned_by) VALUES (?, ?, ?, 'auto')
         ON CONFLICT (experiment_id, content_id) DO UPDATE SET arm = excluded.arm WHERE experiment_content.assigned_by = 'auto'`,
        experimentId,
        f.contentId,
        arm
      ).changes;
      if (changes) counts[arm]++;
    }
  });
  return counts;
}

export type ExperimentEvaluation = {
  experimentId: number;
  controlN: number;
  variantN: number;
  ready: boolean;
  primary: GroupComparison;
  secondary: Array<{ metric: MetricKey; comparison: GroupComparison }>;
  summary: string;
};

export function evaluateExperiment(db: Db, experimentId: number): ExperimentEvaluation {
  const e = get<ExperimentRow>(db, 'SELECT * FROM experiments WHERE id = ?', experimentId);
  if (!e) throw new Error(`Experiment ${experimentId} not found.`);
  const assignments = all<{ content_id: number; arm: string }>(db, 'SELECT content_id, arm FROM experiment_content WHERE experiment_id = ?', experimentId);
  const facts = new Map(comparable(loadFacts(db, { contentIds: assignments.map((a) => a.content_id) })).map((f) => [f.contentId, f]));
  const arm = (name: string) => assignments.filter((a) => a.arm === name).map((a) => facts.get(a.content_id)).filter((f): f is ContentFact => Boolean(f));
  const control = arm('control');
  const variant = arm('variant');
  const obs = (list: ContentFact[], metric: MetricKey) =>
    list.flatMap((f) => {
      const v = metricValue(f, metric);
      return v === null ? [] : [{ value: v, at: f.publishedAt, contentId: f.contentId }];
    });
  const primary = compareGroups(obs(variant, e.primary_metric), obs(control, e.primary_metric));
  const secondary = parseJson<MetricKey[]>(e.secondary_metrics_json, [])
    .filter((m) => m in METRIC_DEFS && m !== e.primary_metric)
    .map((metric) => ({ metric, comparison: compareGroups(obs(variant, metric), obs(control, metric)) }));
  const ready = control.length >= e.min_sample_per_arm && variant.length >= e.min_sample_per_arm;
  const label = METRIC_DEFS[e.primary_metric].label;
  const summary = !ready
    ? `Collecting: ${variant.length} variant / ${control.length} control scored posts (needs ${e.min_sample_per_arm} each).`
    : primary.verdict === 'no_difference'
      ? `No meaningful difference in ${label}: variant ${primary.effect?.toFixed(2)}x control (${variant.length} vs ${control.length}).`
      : primary.verdict === 'insufficient'
        ? 'Not enough measurable posts in each arm yet.'
        : `Variant ${primary.verdict === 'positive' ? 'outperformed' : 'underperformed'} control on ${label}: ${primary.effect?.toFixed(2)}x (${variant.length} vs ${control.length}, ${primary.confidence.replace(/_/g, ' ').toLowerCase()}).`;

  run(
    db,
    'UPDATE experiments SET result_json = ?, result_summary = ?, sample_size = ?, confidence_label = ?, updated_at = ? WHERE id = ?',
    json({ primary, secondary, controlN: control.length, variantN: variant.length, evaluatedAt: nowIso() }),
    summary,
    control.length + variant.length,
    primary.confidence,
    nowIso(),
    experimentId
  );
  return { experimentId, controlN: control.length, variantN: variant.length, ready, primary, secondary, summary };
}

/**
 * Completes an experiment and turns its result into a lesson. Experiment-backed
 * lessons with a moderate or strong result are eligible for a rule proposal
 * immediately — deliberate tests count as repeated evidence.
 */
export function completeExperiment(db: Db, experimentId: number): { lessonId: number | null; evaluation: ExperimentEvaluation } {
  const evaluation = evaluateExperiment(db, experimentId);
  const e = get<ExperimentRow>(db, 'SELECT * FROM experiments WHERE id = ?', experimentId)!;
  if (e.status === 'completed') throw new Error('Experiment already completed.');
  let lessonId: number | null = null;
  tx(db, () => {
    run(db, `UPDATE experiments SET status = 'completed', end_date = COALESCE(end_date, ?), updated_at = ? WHERE id = ?`, nowIso(), nowIso(), experimentId);
    const c = evaluation.primary;
    if (!evaluation.ready || (c.verdict !== 'positive' && c.verdict !== 'negative' && c.verdict !== 'no_difference')) return;
    const labels = loadLabels(db);
    const variable = e.variable_key ? labels.attr.get(e.variable_key) ?? e.variable_key : 'the tested variable';
    const v = e.variable_key && e.variant_value ? valueLabel(labels, e.variable_key, e.variant_value) : e.variant_value ?? 'variant';
    const ctl = e.variable_key && e.control_value ? valueLabel(labels, e.variable_key, e.control_value) : e.control_value ?? 'control';
    const text =
      c.verdict === 'no_difference'
        ? `Experiment ${e.code}: ${variable} "${v}" vs "${ctl}" made no meaningful difference to ${METRIC_DEFS[e.primary_metric].label} (${c.effect?.toFixed(2)}x, ${evaluation.variantN} vs ${evaluation.controlN} posts).`
        : `Experiment ${e.code}: ${variable} "${v}" ${c.verdict === 'positive' ? 'beat' : 'trailed'} "${ctl}" on ${METRIC_DEFS[e.primary_metric].label} — ${c.effect?.toFixed(2)}x across ${evaluation.variantN} vs ${evaluation.controlN} posts in a deliberate test.`;
    const pattern = e.variable_key && e.variant_value ? canonicalPattern({ key: e.variable_key, group: e.variant_value, compare: e.control_value ?? undefined, metric: e.primary_metric }) : null;
    const status = c.verdict === 'no_difference' ? 'WEAKENED' : CONFIDENCE_ORDER.indexOf(c.confidence as ConfidenceLabel) >= CONFIDENCE_ORDER.indexOf('MODERATE_SIGNAL') ? 'SUPPORTED' : 'OBSERVING';
    // Re-use an existing pattern lesson if mining already tracks this exact claim.
    const existing = pattern ? get<{ id: number }>(db, 'SELECT id FROM lessons WHERE pattern_json = ?', pattern) : undefined;
    const meta = { experiment: e.code, nGroup: c.nGroup, nRest: c.nRest, effect: c.effect, verdict: c.verdict, pValue: c.pValue, supportiveStreak: status === 'SUPPORTED' ? 99 : 0 };
    if (existing) {
      lessonId = existing.id;
      run(db, 'UPDATE lessons SET related_experiment_id = ?, metrics_json = ?, status = CASE WHEN status IN (\'PROMOTED_TO_RULE\',\'ARCHIVED\') THEN status ELSE ? END, updated_at = ? WHERE id = ?', experimentId, json(meta), status, nowIso(), existing.id);
    } else {
      let n = (get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM lessons WHERE origin != 'imported_audit'`)?.n ?? 0) + 1;
      while (get(db, 'SELECT 1 FROM lessons WHERE code = ?', `L-${String(n).padStart(3, '0')}`)) n++;
      lessonId = run(
        db,
        `INSERT INTO lessons (code, text, category, status, confidence_label, origin, pattern_json, direction, comparison_group, sample_size, effect, metrics_json, evidence, related_experiment_id, last_evaluated_at)
         VALUES (?, ?, 'experiment', ?, ?, 'experiment', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `L-${String(n).padStart(3, '0')}`,
        text,
        status,
        c.confidence,
        pattern,
        c.verdict === 'no_difference' ? 'mixed' : c.verdict,
        `control arm: ${ctl}`,
        evaluation.variantN + evaluation.controlN,
        c.effect,
        json(meta),
        evaluation.summary,
        experimentId,
        nowIso()
      ).lastId;
    }
    run(db, `INSERT INTO lesson_events (lesson_id, to_status, to_confidence, sample_size, effect, note) VALUES (?, ?, ?, ?, ?, ?)`, lessonId, status, c.confidence, evaluation.variantN + evaluation.controlN, c.effect, `Experiment ${e.code} completed.`);
    run(db, 'UPDATE experiments SET lesson_id = ? WHERE id = ?', lessonId, experimentId);
    for (const a of all<{ content_id: number }>(db, 'SELECT content_id FROM experiment_content WHERE experiment_id = ?', experimentId)) {
      run(db, `INSERT INTO lesson_content VALUES (?, ?, 'source') ON CONFLICT DO NOTHING`, lessonId, a.content_id);
    }
  });
  return { lessonId, evaluation };
}

/** When a pattern is interesting but thin, propose the test instead of the rule. */
export function suggestExperimentsFromLessons(db: Db, limit = 3): number {
  const lessons = all<{ id: number; text: string; pattern_json: string; sample_size: number | null }>(
    db,
    `SELECT id, text, pattern_json, sample_size FROM lessons
     WHERE origin = 'pattern_mining' AND status IN ('NEW','OBSERVING') AND confidence_label = 'EARLY_SIGNAL'
       AND related_experiment_id IS NULL AND pattern_json IS NOT NULL
     ORDER BY ABS(LN(COALESCE(effect, 1))) DESC LIMIT ?`,
    limit * 3
  );
  let created = 0;
  for (const l of lessons) {
    if (created >= limit) break;
    const p = JSON.parse(l.pattern_json) as { key: string; group: string; compare: string | null; metric: MetricKey };
    const def = get<{ value_type: string }>(db, 'SELECT value_type FROM attribute_definitions WHERE key = ?', p.key);
    if (!def) continue; // topic/person patterns are opportunities, not A/B variables
    const control = p.compare ?? (def.value_type === 'boolean' ? (p.group === 'true' ? 'false' : 'true') : null);
    if (!control) continue;
    if (get(db, `SELECT 1 FROM experiments WHERE variable_key = ? AND variant_value = ? AND status IN ('proposed','running')`, p.key, p.group)) continue;
    const id = createExperiment(db, {
      name: `${p.key.replace(/_/g, ' ')}: ${p.group} vs ${control}`,
      hypothesis: `Early signal worth testing deliberately: ${l.text}`,
      variableKey: p.key,
      controlValue: control,
      variantValue: p.group,
      primaryMetric: p.metric,
      origin: 'pattern',
    });
    run(db, 'UPDATE lessons SET related_experiment_id = ? WHERE id = ?', id, l.id);
    created++;
  }
  return created;
}

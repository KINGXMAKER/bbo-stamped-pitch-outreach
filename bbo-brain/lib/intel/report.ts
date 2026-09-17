import { all, get, parseJson, type Db } from '@/lib/db/client';
import { STAT_THRESHOLDS } from './stats';
import { BUCKET_DEFINITIONS, type ContentBucket } from '@/lib/seed/reference';
import { comparable, loadFacts, METRIC_DEFS, metricValue, type ContentFact, type MetricKey } from './dataset';
import { evaluatePattern, loadLabels, valueLabel, valuesFor, type PatternEvaluation } from './patterns';
import { corpusStatus } from '@/lib/sync/media-queue';
import { coverageStats } from './validation';
import { catalogueAccounting, type CatalogueAccounting } from './buckets';
import { benchmarkReport, pairAgreement } from './benchmark';
import { brainConfig } from '@/lib/config';

/**
 * The intelligence review: fourteen fixed questions answered from calculated
 * evidence only. Every claim carries its sample size, baseline, effect,
 * date range and confidence, and a question with too little data says so
 * instead of producing a sentence that sounds like a finding.
 */

export type Example = { contentId: number; title: string; value: number | null; publishedAt: string };

export type Finding = {
  claim: string;
  metric: MetricKey;
  metricLabel: string;
  nGroup: number;
  nRest: number;
  medianGroup: number | null;
  baselineMedian: number | null;
  effect: number | null;
  consistency: number | null;
  pValue: number | null;
  confidence: string;
  verdict: string;
  halvesAgree: boolean | null;
  dateRange: { from: string; to: string } | null;
  supporting: Example[];
  contradicting: Example[];
  /** Which model coded the group's posts — a pattern carried by one model is a possible artifact. */
  modelMix: Record<string, number>;
  modelConfound: boolean;
  /** Days between the median publish date of the group and of its baseline. */
  eraGapDays: number | null;
  /** The comparison mixes eras or does not hold in both halves of the data: direction unproven. */
  eraConfounded: boolean;
};

const medianDate = (facts: ContentFact[]): number | null => {
  const t = facts.map((f) => Date.parse(f.publishedAt)).filter(Number.isFinite).sort((a, b) => a - b);
  return t.length ? t[Math.floor(t.length / 2)] : null;
};

export type Answer = { number: number; question: string; findings: Finding[]; note: string | null; insufficient: string | null };

const fmtTitle = (t: string) => (t.length > 60 ? `${t.slice(0, 57)}…` : t);

function examples(facts: ContentFact[], metric: MetricKey, order: 'desc' | 'asc', limit = 3): Example[] {
  return facts
    .map((f) => ({ contentId: f.contentId, title: fmtTitle(f.title), value: metricValue(f, metric), publishedAt: f.publishedAt }))
    .filter((e) => e.value !== null)
    .sort((a, b) => (order === 'desc' ? (b.value ?? 0) - (a.value ?? 0) : (a.value ?? 0) - (b.value ?? 0)))
    .slice(0, limit);
}

/** contentId → "provider/model" of the run that produced its current hook coding. */
function codingModels(db: Db): Map<number, string> {
  return new Map(
    all<{ content_id: number; model: string }>(
      db,
      `SELECT a.content_id, COALESCE(r.provider, '?') || '/' || COALESCE(r.model, '?') AS model
       FROM content_attributes a JOIN ai_runs r ON r.id = a.ai_run_id
       WHERE a.source = 'ai' AND a.key = 'hook_type'`
    ).map((row) => [row.content_id, row.model])
  );
}

let modelCache: { db: Db; map: Map<number, string> } | null = null;
const modelsFor = (db: Db) => (modelCache?.db === db ? modelCache.map : (modelCache = { db, map: codingModels(db) }).map);

function mix(db: Db, facts: ContentFact[]): Record<string, number> {
  const models = modelsFor(db);
  const out: Record<string, number> = {};
  for (const f of facts) {
    const m = models.get(f.contentId);
    if (m) out[m] = (out[m] ?? 0) + 1;
  }
  return out;
}

function toFinding(db: Db, e: PatternEvaluation, claim: string): Finding {
  const c = e.comparison;
  const positive = (c.effect ?? 1) >= 1;
  const groupMix = mix(db, e.groupFacts);
  const restMix = mix(db, e.restFacts);
  const share = (m: Record<string, number>) => {
    const total = Object.values(m).reduce((a, b) => a + b, 0);
    return total ? Math.max(...Object.values(m)) / total : 0;
  };
  // Flag only when the corpus really is mixed and the group is not.
  const modelConfound = Object.keys(restMix).length > 1 && Object.keys(groupMix).length > 0 && share(groupMix) >= 0.85 && share(restMix) < 0.7;
  const g = medianDate(e.groupFacts);
  const b = medianDate(e.restFacts);
  const eraGapDays = g !== null && b !== null ? Math.round(Math.abs(g - b) / 86_400_000) : null;
  return {
    modelMix: groupMix,
    modelConfound,
    eraGapDays,
    // Same safeguard the mining loop applies: BBO's audience and reach changed
    // across years, so a group from one era compared with a baseline from
    // another measures the era, not the attribute.
    // Metrics are era-normalised peer ratios, so a direction that holds in both
    // halves of the timeline survives an era gap; one that does not is unproven.
    eraConfounded: c.halvesAgree === false || (eraGapDays !== null && eraGapDays > 365 && c.halvesAgree !== true),
    claim,
    metric: e.pattern.metric,
    metricLabel: METRIC_DEFS[e.pattern.metric].label,
    nGroup: c.nGroup,
    nRest: c.nRest,
    medianGroup: c.medianGroup,
    baselineMedian: c.medianRest,
    effect: c.effect,
    consistency: c.consistency,
    pValue: c.pValue,
    confidence: c.confidence,
    verdict: c.verdict,
    halvesAgree: c.halvesAgree,
    dateRange: e.dateRange,
    supporting: examples(e.groupFacts, e.pattern.metric, positive ? 'desc' : 'asc'),
    contradicting: examples(e.groupFacts, e.pattern.metric, positive ? 'asc' : 'desc'),
  };
}

/** Every value of an attribute, ranked by effect, keeping only what clears the minimum sample. */
function rankValues(db: Db, facts: ContentFact[], key: string, metric: MetricKey, opts: { minN?: number } = {}): { findings: Finding[]; thin: string[] } {
  const labels = loadLabels(db);
  const values = new Set<string>();
  for (const f of facts) for (const v of valuesFor(f, key) ?? []) values.add(v);
  const findings: Finding[] = [];
  const thin: string[] = [];
  for (const value of values) {
    const evaluation = evaluatePattern(facts, { key, group: value, metric });
    const label = valueLabel(labels, key, value);
    if (evaluation.comparison.nGroup < (opts.minN ?? STAT_THRESHOLDS.minN)) {
      thin.push(`${label} (n=${evaluation.comparison.nGroup})`);
      continue;
    }
    findings.push(toFinding(db, evaluation, label));
  }
  findings.sort((a, b) => (b.effect ?? 0) - (a.effect ?? 0));
  return { findings, thin };
}

/** Attribute values that appear far more often in a label group than in everything else. */
function overRepresented(facts: ContentFact[], labelSet: string[], keys: string[], minCount = 5): Array<{ key: string; value: string; inGroup: number; groupShare: number; restShare: number; lift: number; examples: Example[] }> {
  const group = facts.filter((f) => f.label && labelSet.includes(f.label));
  const rest = facts.filter((f) => f.label && !labelSet.includes(f.label));
  const out: Array<{ key: string; value: string; inGroup: number; groupShare: number; restShare: number; lift: number; examples: Example[] }> = [];
  for (const key of keys) {
    const counts = new Map<string, number>();
    const restCounts = new Map<string, number>();
    let groupCoded = 0;
    let restCoded = 0;
    for (const f of group) {
      const values = valuesFor(f, key) ?? [];
      if (values.length) groupCoded++;
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    for (const f of rest) {
      const values = valuesFor(f, key) ?? [];
      if (values.length) restCoded++;
      for (const v of values) restCounts.set(v, (restCounts.get(v) ?? 0) + 1);
    }
    for (const [value, n] of counts) {
      if (n < minCount || !groupCoded) continue;
      const groupShare = n / groupCoded;
      const restShare = restCoded ? (restCounts.get(value) ?? 0) / restCoded : 0;
      const lift = restShare > 0 ? groupShare / restShare : groupShare > 0 ? Number.POSITIVE_INFINITY : 0;
      out.push({
        key,
        value,
        inGroup: n,
        groupShare,
        restShare,
        lift,
        examples: examples(group.filter((f) => (valuesFor(f, key) ?? []).includes(value)), 'performance_score', 'desc', 2),
      });
    }
  }
  return out.sort((a, b) => b.lift - a.lift || b.inGroup - a.inGroup);
}

export type IntelligenceReport = {
  generatedAt: string;
  corpus: { total: number; coded: number; comparable: number; mediaAnalysed: number; humanValidated: number; classes: Record<string, { coded: number; target: number }>; codedBy: Record<string, number> };
  scope: { bucket: ContentBucket; label: string; inScope: number; codedInScope: number; unbucketed: number; otherBuckets: Record<string, number> };
  answers: Answer[];
  overRepresentedBreakouts: ReturnType<typeof overRepresented>;
  overRepresentedLosers: ReturnType<typeof overRepresented>;
  rules: { supported: Array<{ code: string; text: string; lessons: number }>; challenged: Array<{ code: string; text: string; reason: string }> };
  experiments: Array<{ code: string; name: string; status: string; hypothesis: string | null }>;
  nextMoves: Array<{ title: string; rationale: string; score: number | null }>;
  labelReliability: string | null;
  untrustedFields: string[];
  accounting: CatalogueAccounting;
  /** True while no human has validated the coded attributes these findings rest on. */
  provisional: boolean;
};

/** What the benchmark says about the model that produced the corpus labels. */
function describeLabelReliability(db: Db): string | null {
  const model = brainConfig().tasks.coding.model;
  if (!model) return null;
  const runs = all<{ id: number }>(db, `SELECT id FROM benchmark_runs WHERE model = ? AND provider != 'reference' AND finished_at IS NOT NULL ORDER BY id`, model).map((x) => x.id);
  const reference = all<{ id: number }>(db, `SELECT id FROM benchmark_runs WHERE provider = 'reference' ORDER BY id DESC LIMIT 1`)[0]?.id;
  if (!runs.length) return null;
  const parts: string[] = [];
  const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
  if (runs.length >= 2) parts.push(`${model} agrees with its own rerun on ${pct(pairAgreement(db, runs[0], runs[1]).rate)} of labels`);
  if (reference) {
    const [row] = benchmarkReport(db, [runs[0]], { referenceRunId: reference });
    if (row) parts.push(`and with the earlier coding it replaced on ${pct(row.overallAgreement)} (valid structured output ${pct(row.validRate)}, ${row.taxonomyViolations} taxonomy violations in ${row.posts})`);
  }
  return parts.length ? `${parts.join(' ')} — agreement between models is a consistency signal, not ground truth; human review decides.` : null;
}

export function buildIntelligenceReport(db: Db, opts: { bucket?: ContentBucket } = {}): IntelligenceReport {
  modelCache = null;
  const bucket = opts.bucket ?? 'CORE_INTERVIEW_CONTENT';
  const everything = comparable(loadFacts(db));
  // One bucket per review. Venue promos and interview clips want different viewer
  // behaviour, so their performance is never pooled into one conclusion.
  const facts = everything.filter((f) => f.attrs.content_bucket === bucket);
  const coverage = coverageStats(db);
  const corpus = corpusStatus(db);
  const labels = loadLabels(db);
  const answers: Answer[] = [];

  const add = (number: number, question: string, result: { findings: Finding[]; thin: string[] }, note: string | null = null) => {
    answers.push({
      number,
      question,
      findings: result.findings,
      note,
      insufficient: result.findings.length ? (result.thin.length ? `Too few posts to judge: ${result.thin.join(', ')}.` : null) : `No value of this attribute has ${STAT_THRESHOLDS.minN}+ coded posts yet${result.thin.length ? ` — closest: ${result.thin.slice(0, 5).join(', ')}` : ''}.`,
    });
  };

  add(1, 'Which hook types currently show the strongest performance association?', rankValues(db, facts, 'hook_type', 'performance_score'));
  add(2, 'Which opening types appear strongest?', rankValues(db, facts, 'opening_type', 'performance_score'));

  // 3 — a direct head-to-head, not two separate comparisons against everything else.
  const headToHead = evaluatePattern(facts, { key: 'opening_type', group: 'interviewer_question', compare: 'guest_answer', metric: 'performance_score' });
  answers.push({
    number: 3,
    question: 'How do interviewer-question openings compare with guest-answer openings?',
    findings: headToHead.comparison.nGroup >= STAT_THRESHOLDS.minN && headToHead.comparison.nRest >= STAT_THRESHOLDS.minN ? [toFinding(db, headToHead, 'Interviewer question vs guest answer (head-to-head)')] : [],
    note: null,
    insufficient:
      headToHead.comparison.nGroup >= STAT_THRESHOLDS.minN && headToHead.comparison.nRest >= STAT_THRESHOLDS.minN
        ? null
        : `Not enough coded posts for a head-to-head: interviewer_question n=${headToHead.comparison.nGroup}, guest_answer n=${headToHead.comparison.nRest} (need ${STAT_THRESHOLDS.minN} each).`,
  });

  add(4, 'Which topics generate disproportionate shares?', rankValues(db, facts, 'topic', 'share_rel'));
  add(5, 'Which topics generate disproportionate comments?', rankValues(db, facts, 'topic', 'comment_rel'));

  // 6 — the combination BBO cares about: conversation without retention.
  const commentRanked = rankValues(db, facts, 'topic', 'comment_rel');
  const retentionRanked = rankValues(db, facts, 'topic', 'retention_rel');
  const retentionByClaim = new Map(retentionRanked.findings.map((f) => [f.claim, f]));
  const talkNotWatch = commentRanked.findings
    .filter((f) => (f.effect ?? 0) >= 1.15)
    .map((f) => ({ comment: f, retention: retentionByClaim.get(f.claim) }))
    .filter((pair) => pair.retention && (pair.retention.effect ?? 1) <= 0.95)
    .map((pair) => ({ ...pair.comment, claim: `${pair.comment.claim}: comments ${(pair.comment.effect ?? 1).toFixed(2)}× but retention ${(pair.retention!.effect ?? 1).toFixed(2)}×` }));
  answers.push({
    number: 6,
    question: 'Which topics generate comments but weak retention?',
    findings: talkNotWatch,
    note: 'Both sides of each pair are measured on era-normalised peer ratios.',
    insufficient: talkNotWatch.length ? null : 'No topic currently shows above-baseline comments together with below-baseline retention at the minimum sample size.',
  });

  add(7, 'Which duration ranges currently perform best?', rankValues(db, facts, 'duration_bucket', 'performance_score'));

  const codedKeys = ['hook_type', 'opening_type', 'tension_type', 'emotional_trigger', 'share_trigger_type', 'comment_trigger_type', 'editing_style', 'duration_bucket', 'caption_type', 'cta_type', 'reaction_timing', 'time_to_tension_bucket', 'dead_setup_bucket'];
  const breakoutAttrs = overRepresented(facts, ['BREAKOUT', 'WINNER'], codedKeys);
  const loserAttrs = overRepresented(facts, ['LOSER', 'BELOW_AVERAGE'], codedKeys);
  answers.push({
    number: 8,
    question: 'Which attributes repeatedly appear among breakouts?',
    findings: [],
    note: breakoutAttrs.length ? `${breakoutAttrs.length} attribute values appear in at least 5 winners; see the frequency table.` : null,
    insufficient: breakoutAttrs.length ? null : 'No attribute value appears in 5+ coded winners yet.',
  });
  answers.push({
    number: 9,
    question: 'Which attributes repeatedly appear among losers?',
    findings: [],
    note: loserAttrs.length ? `${loserAttrs.length} attribute values appear in at least 5 losers; see the frequency table.` : null,
    insufficient: loserAttrs.length ? null : 'No attribute value appears in 5+ coded losers yet.',
  });

  // 10 — what we deliberately refuse to conclude, and why.
  const thinAll: string[] = [];
  for (const key of ['hook_type', 'opening_type', 'tension_type', 'share_trigger_type', 'comment_trigger_type', 'reaction_timing']) {
    const r = rankValues(db, facts, key, 'performance_score');
    for (const t of r.thin) thinAll.push(`${key.replace(/_/g, ' ')} · ${t}`);
  }
  const openLessons = all<{ code: string; text: string; status: string; confidence_label: string }>(db, `SELECT code, text, status, confidence_label FROM lessons WHERE status IN ('NEW','OBSERVING') ORDER BY id DESC LIMIT 12`);
  answers.push({
    number: 10,
    question: 'Which patterns still have insufficient evidence?',
    findings: [],
    note: `${openLessons.length} lessons are still NEW or OBSERVING: ${openLessons.map((l) => l.code).join(', ') || 'none'}.`,
    insufficient: thinAll.length ? thinAll.slice(0, 24).join(' · ') : null,
  });

  const supportedRules = all<{ code: string; text: string; lessons: number }>(
    db,
    `SELECT r.code, rv.text, COUNT(DISTINCT l.id) AS lessons
     FROM rules r JOIN rule_versions rv ON rv.id = r.current_version_id
     LEFT JOIN lessons l ON l.related_rule_id = r.id AND l.status IN ('SUPPORTED','PROMOTED_TO_RULE')
     WHERE r.status = 'active' GROUP BY r.id ORDER BY lessons DESC, r.code`
  );
  const challenged = all<{ code: string; text: string; reason: string }>(
    db,
    `SELECT r.code, rv.text, c.summary AS reason FROM rule_challenges c JOIN rules r ON r.id = c.rule_id
     JOIN rule_versions rv ON rv.id = c.rule_version_id WHERE c.status = 'open' ORDER BY c.id DESC`
  );
  // Only rules with a machine-checkable pattern can be tested; the rest are editorial principles.
  const testable = all<{ code: string; text: string; pattern_json: string }>(
    db,
    `SELECT r.code, rv.text, r.pattern_json FROM rules r JOIN rule_versions rv ON rv.id = r.current_version_id WHERE r.status = 'active' AND r.pattern_json IS NOT NULL ORDER BY r.code`
  );
  const ruleFindings = testable.map((rule) => {
    const raw = parseJson<{ key: string; group: string; compare?: string; metric: MetricKey; expected: 'higher' | 'lower' }>(rule.pattern_json, { key: '', group: '', metric: 'performance_score', expected: 'higher' });
    const e = evaluatePattern(facts, { key: raw.key, group: raw.group, compare: raw.compare, metric: raw.metric });
    const effect = e.comparison.effect;
    const enough = e.comparison.nGroup >= STAT_THRESHOLDS.minN && e.comparison.nRest >= STAT_THRESHOLDS.minN;
    const agrees = effect !== null && (raw.expected === 'higher' ? effect >= STAT_THRESHOLDS.meaningfulUp : effect <= STAT_THRESHOLDS.meaningfulDown);
    const opposes = effect !== null && (raw.expected === 'higher' ? effect <= STAT_THRESHOLDS.meaningfulDown : effect >= STAT_THRESHOLDS.meaningfulUp);
    const probe = toFinding(db, e, rule.code);
    const verdict = !enough ? 'insufficient' : probe.eraConfounded ? 'era-confounded, cannot judge' : agrees ? 'consistent with the rule' : opposes ? 'against the rule' : 'no meaningful difference';
    return { rule, verdict, finding: { ...probe, claim: `${rule.code}: ${rule.text.slice(0, 70)}${rule.text.length > 70 ? '…' : ''} (${verdict})` } };
  });
  answers.push({
    number: 11,
    question: 'Which existing BBO rules are supported?',
    findings: ruleFindings.filter((r) => r.verdict === 'consistent with the rule').map((r) => r.finding),
    note: `${testable.length} of ${supportedRules.length} active rules are machine-testable; the others are editorial principles this data cannot confirm or refute.`,
    insufficient:
      ruleFindings
        .filter((r) => ['insufficient', 'no meaningful difference', 'era-confounded, cannot judge'].includes(r.verdict))
        .map((r) => `${r.rule.code} — ${r.verdict} (n=${r.finding.nGroup} vs ${r.finding.nRest}, effect ${r.finding.effect?.toFixed(2) ?? '—'}×${r.finding.eraGapDays !== null ? `, median dates ${r.finding.eraGapDays} days apart` : ''}, halves agree: ${r.finding.halvesAgree ?? '—'})`)
        .join('; ') || null,
  });
  answers.push({
    number: 12,
    question: 'Which existing BBO rules are being challenged?',
    findings: ruleFindings.filter((r) => r.verdict === 'against the rule').map((r) => r.finding),
    note: challenged.length ? `${challenged.length} open challenge(s) in the rule engine.` : 'No open challenge in the rule engine (a challenge needs repeated contrary evidence, not one pass).',
    insufficient: null,
  });

  const experiments = all<{ code: string; name: string; status: string; hypothesis: string | null }>(db, `SELECT code, name, status, hypothesis FROM experiments WHERE status IN ('proposed','running') ORDER BY id DESC LIMIT 8`);
  // Associations from an outcome-sampled corpus are hypotheses; an experiment is how they become lessons.
  const testableFindings = [...answers.filter((a) => a.number <= 3 || a.number === 7).flatMap((a) => a.findings)]
    .filter((f) => !f.eraConfounded && ['MODERATE_SIGNAL', 'STRONG_SIGNAL'].includes(f.confidence) && f.effect !== null && (f.effect >= 1.2 || f.effect <= 0.8) && (f.pValue ?? 1) <= 0.1)
    .sort((a, b) => Math.abs(Math.log(b.effect ?? 1)) - Math.abs(Math.log(a.effect ?? 1)))
    .slice(0, 5);
  answers.push({
    number: 13,
    question: 'What 3–5 deliberate experiments should BBO run next?',
    findings: testableFindings,
    note: `The findings above are the strongest associations worth converting into controlled tests (same topic and guest, one variable changed). ${experiments.length} experiment(s) are already proposed or running.`,
    insufficient: testableFindings.length ? null : 'No association is strong enough yet to justify a deliberate test.',
  });

  const nextMoves = all<{ title: string; rationale: string; score: number | null }>(
    db,
    `SELECT title, why AS rationale, MAX(priority) AS score FROM content_opportunities WHERE status = 'open' GROUP BY title ORDER BY score DESC LIMIT 8`
  );
  answers.push({ number: 14, question: 'Based on current evidence, what should BBO make next?', findings: [], note: nextMoves.length ? `${nextMoves.length} open opportunities, each tied to evidence.` : null, insufficient: nextMoves.length ? null : 'No open opportunities — run the opportunities job after coding more posts.' });

  const bucketCounts = everything.reduce<Record<string, number>>((acc, f) => {
    const b = f.attrs.content_bucket ?? 'unbucketed';
    return { ...acc, [b]: (acc[b] ?? 0) + 1 };
  }, {});
  const coded = new Set(all<{ id: number }>(db, 'SELECT id FROM content WHERE coded_at IS NOT NULL').map((x) => x.id));
  return {
    scope: {
      bucket,
      label: BUCKET_DEFINITIONS[bucket].label,
      inScope: facts.length,
      codedInScope: facts.filter((f) => coded.has(f.contentId)).length,
      unbucketed: bucketCounts.unbucketed ?? 0,
      otherBuckets: Object.fromEntries(Object.entries(bucketCounts).filter(([k]) => k !== bucket && k !== 'unbucketed')),
    },
    generatedAt: new Date().toISOString(),
    corpus: {
      total: coverage.total,
      coded: coverage.coded,
      comparable: facts.length,
      mediaAnalysed: coverage.mediaAnalyzed,
      humanValidated: coverage.humanValidated,
      classes: Object.fromEntries(Object.entries(corpus.classes).map(([k, v]) => [k, { coded: v.coded, target: v.target }])),
      codedBy: [...modelsFor(db).values()].reduce<Record<string, number>>((acc, m) => ({ ...acc, [m]: (acc[m] ?? 0) + 1 }), {}),
    },
    answers,
    overRepresentedBreakouts: breakoutAttrs.slice(0, 12),
    overRepresentedLosers: loserAttrs.slice(0, 12),
    rules: { supported: supportedRules, challenged },
    experiments,
    nextMoves,
    labelReliability: describeLabelReliability(db),
    untrustedFields: brainConfig().untrustedCodingFields,
    accounting: catalogueAccounting(db),
    provisional: coverage.humanValidated === 0,
  };
}

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const x = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)}×`);
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '—');

/** Markdown for the operator: every number that backs a claim, printed next to it. */
export function renderIntelligenceReport(r: IntelligenceReport): string {
  const lines: string[] = [];
  lines.push(`# BBO intelligence review — ${r.scope.label}`, '', `Generated ${r.generatedAt.slice(0, 16).replace('T', ' ')} UTC`, '');
  if (r.provisional) {
    lines.push(
      '> **PROVISIONAL — HUMAN LABEL VALIDATION PENDING.** Every finding below rests on model-assigned attribute labels that no human has checked yet.',
      '> None of it may become a BBO rule until the Coding Validation batch is reviewed.',
      ''
    );
  }
  const a = r.accounting;
  lines.push('## Catalogue accounting', '', `All ${a.totalPosts} posts, counted once each. "Comparable" is the subset with a peer baseline — the only posts any comparison can use.`, '');
  lines.push('| Bucket | Posts | Comparable | Too recent | No baseline | With media | Structurally coded | Analysed |', '|---|---|---|---|---|---|---|---|');
  for (const b of a.buckets) {
    lines.push(`| ${b.label} | ${b.total} | ${b.comparable} | ${b.immature} | ${b.unscored} | ${b.withMedia} | ${b.coded} | ${b.analysed ? 'yes' : 'no'} |`);
  }
  const sums = a.buckets.reduce((acc, b) => ({ total: acc.total + b.total, comparable: acc.comparable + b.comparable, immature: acc.immature + b.immature, unscored: acc.unscored + b.unscored, media: acc.media + b.withMedia, coded: acc.coded + b.coded }), { total: 0, comparable: 0, immature: 0, unscored: 0, media: 0, coded: 0 });
  lines.push(`| **Total** | **${sums.total}** | ${sums.comparable} | ${sums.immature} | ${sums.unscored} | ${sums.media} | ${sums.coded} | |`, '');
  lines.push(
    `Inside core interview content, ${a.formats.podcast} are podcast clips and ${a.formats.streetInterview} street interviews, with ${a.formats.noFormatYet} not yet sub-typed ` +
      `(${a.formats.podcast} + ${a.formats.streetInterview} + ${a.formats.noFormatYet} = ${a.formats.core}). Podcast and street interview are subtypes **inside** this one bucket, not buckets of their own.` +
      `${a.strayFormatLabels ? ` ⚠ ${a.strayFormatLabels} format labels sit outside core and need clearing.` : ''}`,
    ''
  );
  lines.push(
    `**This review's scope.** ${r.scope.inScope} comparable ${r.scope.label.toLowerCase()} posts; ${r.scope.codedInScope} of them carry structured coding (${a.buckets.find((b) => b.bucket === r.scope.bucket)?.coded ?? r.scope.codedInScope} coded in this bucket in total). ` +
      `Excluded: ${Object.entries(r.scope.otherBuckets).map(([k, n]) => `${BUCKET_DEFINITIONS[k as ContentBucket]?.label ?? k} ${n} comparable`).join(', ') || 'no other buckets'}` +
      `${r.scope.unbucketed ? `, ${r.scope.unbucketed} not yet bucketed` : ''}, and the ${sums.total - sums.comparable} posts of any bucket that have no peer baseline yet. Performance is never pooled across buckets.`,
    ''
  );
  lines.push(
    `**Corpus.** ${r.corpus.coded} posts structurally coded out of ${r.corpus.total} in the catalogue (${r.corpus.mediaAnalysed} with media, ${r.corpus.comparable} comparable, ${r.corpus.humanValidated} human-validated). ` +
      `By class: ${Object.entries(r.corpus.classes).map(([k, v]) => `${k} ${v.coded}/${v.target}`).join(', ')}. ` +
      `Coded by: ${Object.entries(r.corpus.codedBy).map(([m, n]) => `${m} ${n}`).join(', ') || '—'}.`,
    ''
  );
  lines.push('Every claim below is an association measured against BBO\'s own era-normalised baseline — not a causal statement. Effect is the group median divided by the baseline median.', '');
  lines.push(
    '**Read this with two caveats.**',
    '',
    `1. *The coded corpus was sampled on the outcome.* Winners, losers, average controls and unusual posts were selected to fixed quotas, so extremes are over-represented relative to the catalogue. Within such a sample the direction of an association is informative, but median ratios for coded attributes are distorted — treat them as hypotheses to test, not effect sizes. Topic comparisons span the whole catalogue; duration is only known where media was fetched, which followed the same outcome-based priority, so it shares this caveat.`,
    `2. *Coded attributes are model labels, ${r.corpus.humanValidated === 0 ? 'none of them human-validated yet' : `${r.corpus.humanValidated} of ${r.corpus.coded} posts human-reviewed`}.* ${r.labelReliability ?? 'No benchmark data is available for the coding model.'} Fields listed in AI_CODING_UNTRUSTED_FIELDS (${r.untrustedFields.join(', ') || 'none'}) are not written by the model, so comparisons on them rest on heuristics and audits.`,
    ''
  );

  for (const a of r.answers) {
    lines.push(`## ${a.number}. ${a.question}`, '');
    if (a.findings.length) {
      lines.push('| Group | n | Baseline n | Median | Baseline | Effect | Consistency | p | Confidence | Holds in both halves | Date range |', '|---|---|---|---|---|---|---|---|---|---|---|');
      for (const f of a.findings.slice(0, 8)) {
        lines.push(
          `| ${f.eraConfounded ? '⚠ ' : ''}${f.claim} | ${f.nGroup} | ${f.nRest} | ${f.medianGroup?.toFixed(2) ?? '—'} | ${f.baselineMedian?.toFixed(2) ?? '—'} | ${x(f.effect)} | ${pct(f.consistency)} | ${f.pValue === null ? '—' : f.pValue.toFixed(3)} | ${f.confidence} | ${f.halvesAgree === null ? '—' : f.halvesAgree ? 'yes' : 'no'} | ${day(f.dateRange?.from)} → ${day(f.dateRange?.to)} |`
        );
      }
      const eraFlagged = a.findings.slice(0, 8).filter((f) => f.eraConfounded).map((f) => f.claim);
      if (eraFlagged.length) lines.push('', `⚠ **Era-confounded:** ${eraFlagged.join(', ')} — the group and its baseline come from different eras or the direction does not hold in both halves of the data. Direction unproven.`);
      lines.push('');
      const confounded = a.findings.filter((f) => f.modelConfound).map((f) => f.claim);
      if (confounded.length) lines.push(`**Possible coding-model artifact:** ${confounded.join(', ')} — the group was coded almost entirely by one model while the baseline was not. Treat as unconfirmed.`, '');
      for (const f of a.findings.slice(0, 3)) {
        if (!f.supporting.length) continue;
        lines.push(`- **${f.claim}** — supporting: ${f.supporting.map((e) => `#${e.contentId} ${e.title} (${e.value?.toFixed(2)})`).join('; ')}`);
        if (f.contradicting.length) lines.push(`  - contradicting: ${f.contradicting.map((e) => `#${e.contentId} ${e.title} (${e.value?.toFixed(2)})`).join('; ')}`);
      }
      lines.push('');
    }
    if (a.note) lines.push(a.note, '');
    if (a.insufficient) lines.push(`**Insufficient evidence.** ${a.insufficient}`, '');
  }

  const freqTable = (rows: IntelligenceReport['overRepresentedBreakouts'], title: string) => {
    if (!rows.length) return;
    lines.push(`### ${title}`, '', '| Attribute | Value | In group | Group share | Rest share | Lift | Examples |', '|---|---|---|---|---|---|---|');
    for (const row of rows) {
      lines.push(
        `| ${row.key.replace(/_/g, ' ')} | ${row.value.replace(/_/g, ' ')} | ${row.inGroup} | ${pct(row.groupShare)} | ${pct(row.restShare)} | ${Number.isFinite(row.lift) ? `${row.lift.toFixed(2)}×` : '∞'} | ${row.examples.map((e) => `#${e.contentId}`).join(', ')} |`
      );
    }
    lines.push('');
  };
  freqTable(r.overRepresentedBreakouts, 'Attributes over-represented among breakouts and winners');
  freqTable(r.overRepresentedLosers, 'Attributes over-represented among losers and below-average posts');

  if (r.rules.challenged.length) {
    lines.push('### Open challenges', '');
    for (const c of r.rules.challenged) lines.push(`- **${c.code}** — ${c.reason}`);
    lines.push('');
  }
  if (r.experiments.length) {
    lines.push('### Experiments proposed or running', '');
    for (const e of r.experiments) lines.push(`- **${e.code}** ${e.name} (${e.status})${e.hypothesis ? ` — ${e.hypothesis}` : ''}`);
    lines.push('');
  }
  if (r.nextMoves.length) {
    lines.push('### What to make next', '');
    for (const n of r.nextMoves) lines.push(`- **${n.title}**${n.score === null ? '' : ` (${n.score.toFixed(2)})`} — ${n.rationale}`);
    lines.push('');
  }
  return lines.join('\n');
}

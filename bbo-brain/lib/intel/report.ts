import { all, get, type Db } from '@/lib/db/client';
import { STAT_THRESHOLDS } from './stats';
import { comparable, loadFacts, METRIC_DEFS, metricValue, type ContentFact, type MetricKey } from './dataset';
import { evaluatePattern, loadLabels, valueLabel, valuesFor, type PatternEvaluation } from './patterns';
import { corpusStatus } from '@/lib/sync/media-queue';
import { coverageStats } from './validation';

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

function toFinding(db: Db, e: PatternEvaluation, claim: string): Finding {
  const c = e.comparison;
  const positive = (c.effect ?? 1) >= 1;
  return {
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
function overRepresented(facts: ContentFact[], labelSet: string[], keys: string[], minCount = 3): Array<{ key: string; value: string; inGroup: number; groupShare: number; restShare: number; lift: number; examples: Example[] }> {
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
  corpus: { total: number; coded: number; comparable: number; mediaAnalysed: number; humanValidated: number; classes: Record<string, { coded: number; target: number }> };
  answers: Answer[];
  overRepresentedBreakouts: ReturnType<typeof overRepresented>;
  overRepresentedLosers: ReturnType<typeof overRepresented>;
  rules: { supported: Array<{ code: string; text: string; lessons: number }>; challenged: Array<{ code: string; text: string; reason: string }> };
  experiments: Array<{ code: string; name: string; status: string; hypothesis: string | null }>;
  nextMoves: Array<{ title: string; rationale: string; score: number | null }>;
};

export function buildIntelligenceReport(db: Db): IntelligenceReport {
  const facts = comparable(loadFacts(db));
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
    note: breakoutAttrs.length ? `${breakoutAttrs.length} attribute values appear in at least 3 winners; see the frequency table.` : null,
    insufficient: breakoutAttrs.length ? null : 'No attribute value appears in 3+ coded winners yet.',
  });
  answers.push({
    number: 9,
    question: 'Which attributes repeatedly appear among losers?',
    findings: [],
    note: loserAttrs.length ? `${loserAttrs.length} attribute values appear in at least 3 losers; see the frequency table.` : null,
    insufficient: loserAttrs.length ? null : 'No attribute value appears in 3+ coded losers yet.',
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
  answers.push({ number: 11, question: 'Which existing BBO rules are supported?', findings: [], note: `${supportedRules.filter((r) => r.lessons > 0).length} of ${supportedRules.length} active rules have at least one supporting mined lesson.`, insufficient: null });
  answers.push({ number: 12, question: 'Which existing BBO rules are being challenged?', findings: [], note: challenged.length ? `${challenged.length} open challenge(s).` : 'No rule is currently contradicted by the data.', insufficient: null });

  const experiments = all<{ code: string; name: string; status: string; hypothesis: string | null }>(db, `SELECT code, name, status, hypothesis FROM experiments WHERE status IN ('proposed','running') ORDER BY id DESC LIMIT 8`);
  answers.push({ number: 13, question: 'What 3–5 deliberate experiments should BBO run next?', findings: [], note: `${experiments.length} experiment(s) proposed or running.`, insufficient: experiments.length ? null : 'No experiment has been suggested by the mining loop yet.' });

  const nextMoves = all<{ title: string; rationale: string; score: number | null }>(
    db,
    `SELECT title, why AS rationale, priority AS score FROM content_opportunities WHERE status = 'open' ORDER BY priority DESC LIMIT 8`
  );
  answers.push({ number: 14, question: 'Based on current evidence, what should BBO make next?', findings: [], note: nextMoves.length ? `${nextMoves.length} open opportunities, each tied to evidence.` : null, insufficient: nextMoves.length ? null : 'No open opportunities — run the opportunities job after coding more posts.' });

  return {
    generatedAt: new Date().toISOString(),
    corpus: {
      total: coverage.total,
      coded: coverage.coded,
      comparable: facts.length,
      mediaAnalysed: coverage.mediaAnalyzed,
      humanValidated: coverage.humanValidated,
      classes: Object.fromEntries(Object.entries(corpus.classes).map(([k, v]) => [k, { coded: v.coded, target: v.target }])),
    },
    answers,
    overRepresentedBreakouts: breakoutAttrs.slice(0, 12),
    overRepresentedLosers: loserAttrs.slice(0, 12),
    rules: { supported: supportedRules, challenged },
    experiments,
    nextMoves,
  };
}

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const x = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)}×`);
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '—');

/** Markdown for the operator: every number that backs a claim, printed next to it. */
export function renderIntelligenceReport(r: IntelligenceReport): string {
  const lines: string[] = [];
  lines.push('# BBO intelligence review', '', `Generated ${r.generatedAt.slice(0, 16).replace('T', ' ')} UTC`, '');
  lines.push(
    `**Corpus.** ${r.corpus.coded} posts structurally coded out of ${r.corpus.total} in the catalogue (${r.corpus.mediaAnalysed} with media, ${r.corpus.comparable} comparable, ${r.corpus.humanValidated} human-validated). ` +
      `By class: ${Object.entries(r.corpus.classes).map(([k, v]) => `${k} ${v.coded}/${v.target}`).join(', ')}.`,
    ''
  );
  lines.push('Every claim below is an association measured against BBO\'s own era-normalised baseline — not a causal statement. Effect is the group median divided by the baseline median.', '');

  for (const a of r.answers) {
    lines.push(`## ${a.number}. ${a.question}`, '');
    if (a.findings.length) {
      lines.push('| Group | n | Baseline n | Median | Baseline | Effect | Consistency | p | Confidence | Date range |', '|---|---|---|---|---|---|---|---|---|---|');
      for (const f of a.findings.slice(0, 8)) {
        lines.push(
          `| ${f.claim} | ${f.nGroup} | ${f.nRest} | ${f.medianGroup?.toFixed(2) ?? '—'} | ${f.baselineMedian?.toFixed(2) ?? '—'} | ${x(f.effect)} | ${pct(f.consistency)} | ${f.pValue === null ? '—' : f.pValue.toFixed(3)} | ${f.confidence} | ${day(f.dateRange?.from)} → ${day(f.dateRange?.to)} |`
        );
      }
      lines.push('');
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

  if (r.rules.supported.length) {
    lines.push('### Active rules and their support', '', '| Rule | Supporting lessons | Text |', '|---|---|---|');
    for (const rule of r.rules.supported) lines.push(`| ${rule.code} | ${rule.lessons} | ${rule.text.slice(0, 120)} |`);
    lines.push('');
  }
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

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { all, get, json, nowIso, parseJson, run, tx, type Db } from '@/lib/db/client';
import { getSetting } from '@/lib/seed';
import { comparable, loadFacts } from '@/lib/intel/dataset';
import { currentValidationBatch } from '@/lib/intel/validation';
import { canonicalPattern, describePattern, evaluatePattern, loadLabels, parsePattern, valueLabel, type Pattern } from '@/lib/intel/patterns';
import { setLessonStatus } from '@/lib/intel/lessons';
import { CONFIDENCE_ORDER, type ConfidenceLabel } from '@/lib/intel/stats';
import { METRIC_DEFS } from '@/lib/intel/dataset';
import type { AppliesTo } from './load';

const rank = (c: string | null | undefined) => CONFIDENCE_ORDER.indexOf((c ?? 'INSUFFICIENT_DATA') as ConfidenceLabel);

const EDITING_WORKFLOWS = ['viral_editor', 'gatekeeper', 'content_analysis'];
const PACKAGING_WORKFLOWS = ['viral_editor', 'gatekeeper', 'caption', 'opportunity_brief'];

function workflowsFor(db: Db, key: string): string[] {
  if (key === 'topic' || key === 'person' || key === 'franchise') return ['opportunity_brief', 'viral_editor', 'content_analysis'];
  const group = get<{ attr_group: string }>(db, 'SELECT attr_group FROM attribute_definitions WHERE key = ?', key)?.attr_group;
  return group === 'packaging' ? PACKAGING_WORKFLOWS : EDITING_WORKFLOWS;
}

function lessonPattern(lesson: { pattern_json: string | null; metrics_json: string | null }): Pattern | null {
  return parsePattern(lesson.pattern_json) ?? parsePattern(JSON.stringify(parseJson<{ pattern?: unknown }>(lesson.metrics_json, {}).pattern ?? null));
}

function proposalText(db: Db, pattern: Pattern, direction: string, effect: number, n: number): string {
  const labels = loadLabels(db);
  const subject =
    pattern.key === 'topic'
      ? `content about ${valueLabel(labels, 'topic', pattern.group)}`
      : pattern.key === 'person'
        ? `content featuring ${valueLabel(labels, 'person', pattern.group)}`
        : `${(labels.attr.get(pattern.key) ?? pattern.key).toLowerCase()}: ${valueLabel(labels, pattern.key, pattern.group)}`;
  const scope = pattern.franchise ? ` in ${valueLabel(labels, 'franchise', pattern.franchise)}` : '';
  const metric = METRIC_DEFS[pattern.metric].label;
  return direction === 'positive'
    ? `Favor ${subject}${scope} — associated with ${effect.toFixed(2)}x ${metric} across ${n} posts.`
    : `Avoid defaulting to ${subject}${scope} — associated with ${effect.toFixed(2)}x ${metric} (weaker) across ${n} posts.`;
}

export type ProposalRunResult = { considered: number; proposed: number; attachedToExistingRule: number; blockedReason?: string };

/**
 * Lesson → rule proposal, only with repeated evidence: SUPPORTED status, at least
 * the configured confidence and sample, and a supportive streak across
 * consecutive evaluations. Proposals are never activated here.
 */
export function generateRuleProposals(db: Db): ProposalRunResult {
  const cfg = getSetting<{ minConfidence: ConfidenceLabel; minSample: number; consecutiveEvaluations: number }>(db, 'lesson_promotion');
  const result: ProposalRunResult = { considered: 0, proposed: 0, attachedToExistingRule: 0 };
  // Lessons mined from model labels no human has checked cannot become BBO rules.
  const batch = currentValidationBatch(db);
  if (batch && batch.reviewed < batch.rows.length) {
    result.blockedReason = `coding validation incomplete (${batch.reviewed}/${batch.rows.length} reviewed) — findings stay provisional`;
    return result;
  }
  const lessons = all<{ id: number; text: string; category: string; status: string; confidence_label: string; sample_size: number | null; effect: number | null; direction: string | null; pattern_json: string | null; metrics_json: string | null; origin: string }>(
    db,
    // Lessons mined before content buckets existed pooled venue promos with interview clips; they never become rules.
    `SELECT * FROM lessons WHERE status = 'SUPPORTED' AND (pattern_json IS NULL OR json_extract(pattern_json, '$.bucket') IS NOT NULL)`
  );
  const activeRules = all<{ id: number; pattern_json: string | null }>(db, `SELECT id, pattern_json FROM rules WHERE status = 'active' AND pattern_json IS NOT NULL`);

  for (const lesson of lessons) {
    const pattern = lessonPattern(lesson);
    if (!pattern || lesson.direction === 'mixed' || !lesson.direction) continue;
    result.considered++;
    const meta = parseJson<{ supportiveStreak?: number; brainCheck?: { effect?: number; nGroup?: number; supportiveStreak?: number } }>(lesson.metrics_json, {});
    const streak = lesson.origin === 'imported_audit' ? (meta.brainCheck ? 1 : 0) : (meta.supportiveStreak ?? 0);
    const sample = lesson.origin === 'imported_audit' ? (meta.brainCheck?.nGroup ?? 0) : (lesson.sample_size ?? 0);
    const effect = lesson.origin === 'imported_audit' ? meta.brainCheck?.effect : lesson.effect;
    if (rank(lesson.confidence_label) < rank(cfg.minConfidence) || sample < cfg.minSample || streak < cfg.consecutiveEvaluations || !effect) continue;

    // Same claim already encoded in an active rule → evidence for that rule, not a duplicate proposal.
    const existingRule = activeRules.find((r) => {
      const rp = parsePattern(r.pattern_json);
      return rp && rp.key === pattern.key && rp.group === pattern.group && (rp.franchise ?? null) === (pattern.franchise ?? null);
    });
    if (existingRule) {
      for (const link of all<{ content_id: number; relation: string }>(db, `SELECT content_id, relation FROM lesson_content WHERE lesson_id = ? AND relation IN ('supporting','contradicting')`, lesson.id)) {
        run(db, 'INSERT INTO rule_content (rule_id, content_id, relation) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', existingRule.id, link.content_id, link.relation);
      }
      result.attachedToExistingRule++;
      continue;
    }

    if (get(db, `SELECT 1 FROM rule_proposals WHERE lesson_id = ? AND status = 'pending'`, lesson.id)) continue;
    // A human already said no (or "keep observing") — only re-propose once evidence has grown materially.
    const prior = get<{ status: string; sample_size: number | null }>(
      db,
      `SELECT status, sample_size FROM rule_proposals WHERE lesson_id = ? AND status IN ('rejected','observing') ORDER BY id DESC LIMIT 1`,
      lesson.id
    );
    if (prior && sample < (prior.sample_size ?? 0) * (prior.status === 'rejected' ? 1.5 : 1.25)) continue;

    const links = all<{ content_id: number; relation: string; title: string }>(
      db,
      `SELECT lc.content_id, lc.relation, c.title FROM lesson_content lc JOIN content c ON c.id = lc.content_id WHERE lc.lesson_id = ?`,
      lesson.id
    );
    const affected = all<{ id: number; pattern_json: string | null }>(db, `SELECT id, pattern_json FROM rules WHERE status = 'active'`)
      .filter((r) => parsePattern(r.pattern_json)?.key === pattern.key)
      .map((r) => r.id);
    const appliesTo: AppliesTo = { workflows: workflowsFor(db, pattern.key), ...(pattern.franchise ? { franchises: [pattern.franchise] } : {}) };

    run(
      db,
      `INSERT INTO rule_proposals (proposed_text, category, applies_to_json, reason, lesson_id, pattern_json, supporting_json, contradicting_json, metric_difference_json, sample_size, confidence_label, affected_rule_ids_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      proposalText(db, pattern, lesson.direction, effect, sample),
      lesson.category,
      json(appliesTo),
      `Lesson ${lesson.text} has been SUPPORTED at ${lesson.confidence_label} across ${streak} consecutive evaluation(s).`,
      lesson.id,
      canonicalPattern(pattern),
      json(links.filter((l) => l.relation === 'supporting').map((l) => ({ contentId: l.content_id, title: l.title }))),
      json(links.filter((l) => l.relation === 'contradicting').map((l) => ({ contentId: l.content_id, title: l.title }))),
      json({ metric: pattern.metric, effect, describe: describePattern(loadLabels(db), pattern) }),
      sample,
      lesson.confidence_label,
      json(affected)
    );
    result.proposed++;
  }
  return result;
}

export type ProposalDecision =
  | { action: 'approve'; note?: string }
  | { action: 'edit_approve'; text: string; appliesTo?: AppliesTo; note?: string }
  | { action: 'reject'; note?: string }
  | { action: 'observe'; note?: string };

/** The ONLY path from an AI/mining proposal to an active rule: a human decision. */
export function decideProposal(db: Db, proposalId: number, decision: ProposalDecision, root?: string): { ruleId: number | null; versionId: number | null } {
  const out = tx(db, () => {
    const p = get<{ id: number; status: string; proposed_text: string; category: string; applies_to_json: string; reason: string; lesson_id: number | null; target_rule_id: number | null; pattern_json: string | null; sample_size: number | null; confidence_label: string | null; supporting_json: string; contradicting_json: string }>(
      db,
      'SELECT * FROM rule_proposals WHERE id = ?',
      proposalId
    );
    if (!p) throw new Error(`Proposal ${proposalId} not found.`);
    if (p.status !== 'pending') throw new Error(`Proposal ${proposalId} was already decided (${p.status}).`);
    const now = nowIso();

    if (decision.action === 'reject' || decision.action === 'observe') {
      run(db, 'UPDATE rule_proposals SET status = ?, decision_note = ?, decided_at = ? WHERE id = ?', decision.action === 'reject' ? 'rejected' : 'observing', decision.note ?? null, now, proposalId);
      if (p.lesson_id) {
        setLessonStatus(db, p.lesson_id, decision.action === 'reject' ? 'OBSERVING' : 'SUPPORTED', decision.action === 'reject' ? `Rule proposal rejected by King Maker${decision.note ? `: ${decision.note}` : ''}.` : 'King Maker chose to keep observing before making it a rule.');
      }
      return { ruleId: null, versionId: null };
    }

    const text = decision.action === 'edit_approve' ? decision.text.trim() : p.proposed_text;
    if (!text) throw new Error('Rule text cannot be empty.');
    const appliesTo = decision.action === 'edit_approve' && decision.appliesTo ? decision.appliesTo : parseJson<AppliesTo>(p.applies_to_json, {});
    const scoped = Boolean(appliesTo.franchises?.length || appliesTo.platforms?.length || appliesTo.formats?.length);
    const evidenceSummary = `${p.sample_size ?? '?'} posts · ${p.confidence_label ?? 'unknown confidence'} · supporting ${parseJson<unknown[]>(p.supporting_json, []).length} / contradicting ${parseJson<unknown[]>(p.contradicting_json, []).length}`;

    let ruleId = p.target_rule_id;
    let version = 1;
    if (ruleId) {
      const current = get<{ current_version_id: number | null }>(db, 'SELECT current_version_id FROM rules WHERE id = ?', ruleId);
      version = (get<{ v: number }>(db, 'SELECT MAX(version) AS v FROM rule_versions WHERE rule_id = ?', ruleId)?.v ?? 0) + 1;
      if (current?.current_version_id) run(db, 'UPDATE rule_versions SET deactivated_at = ? WHERE id = ?', now, current.current_version_id);
    } else {
      ruleId = run(db, `INSERT INTO rules (code, category, status, pattern_json) VALUES (?, ?, 'active', ?)`, nextRuleCode(db), p.category, p.pattern_json).lastId;
    }
    const versionId = run(
      db,
      `INSERT INTO rule_versions (rule_id, version, text, reason, scope, applies_to_json, evidence_summary, sample_size, confidence_label, proposed_by, proposal_id, approval_status, activated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai', ?, 'approved', ?)`,
      ruleId,
      version,
      text,
      p.reason,
      scoped ? 'scoped' : 'global',
      json(appliesTo),
      evidenceSummary,
      p.sample_size,
      p.confidence_label,
      proposalId,
      now
    ).lastId;
    if (version > 1) {
      run(db, 'UPDATE rule_versions SET superseded_by_version_id = ? WHERE rule_id = ? AND version = ?', versionId, ruleId, version - 1);
    }
    run(db, `UPDATE rules SET current_version_id = ?, status = 'active', updated_at = ? WHERE id = ?`, versionId, now, ruleId);
    run(db, 'UPDATE rule_proposals SET status = ?, decided_text = ?, decision_note = ?, decided_at = ? WHERE id = ?', decision.action === 'edit_approve' ? 'edited_approved' : 'approved', text, decision.note ?? null, now, proposalId);
    if (p.lesson_id) {
      run(db, 'UPDATE lessons SET related_rule_id = ? WHERE id = ?', ruleId, p.lesson_id);
      setLessonStatus(db, p.lesson_id, 'PROMOTED_TO_RULE', 'Approved as a rule by King Maker.');
      for (const link of all<{ content_id: number; relation: string }>(db, `SELECT content_id, relation FROM lesson_content WHERE lesson_id = ? AND relation IN ('supporting','contradicting')`, p.lesson_id)) {
        run(db, 'INSERT INTO rule_content (rule_id, content_id, relation) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', ruleId, link.content_id, link.relation);
      }
    }
    return { ruleId, versionId };
  });
  if (out.ruleId && root !== undefined) exportConstraints(db, root);
  return out;
}

function nextRuleCode(db: Db): string {
  let n = (get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM rules')?.n ?? 0) + 1;
  while (get(db, 'SELECT 1 FROM rules WHERE code = ?', `R-${String(n).padStart(3, '0')}`)) n++;
  return `R-${String(n).padStart(3, '0')}`;
}

export type ChallengeRunResult = { rulesChecked: number; opened: number };

/**
 * New evidence can challenge old rules. For every active rule with a testable
 * pattern, the recent window is evaluated on its own. A recent reversal (or a
 * confident "no difference") opens a challenge for a human to resolve.
 */
export function detectRuleChallenges(db: Db, now = new Date()): ChallengeRunResult {
  const cfg = getSetting<{ recentDays: number; minRecentSample: number }>(db, 'rule_challenge');
  const allFacts = comparable(loadFacts(db));
  const cutoff = new Date(now.getTime() - cfg.recentDays * 86_400_000).toISOString();
  const recent = allFacts.filter((f) => f.publishedAt >= cutoff);
  const result: ChallengeRunResult = { rulesChecked: 0, opened: 0 };
  const labels = loadLabels(db);

  for (const rule of all<{ id: number; code: string; pattern_json: string | null; current_version_id: number | null }>(
    db,
    `SELECT id, code, pattern_json, current_version_id FROM rules WHERE status = 'active' AND pattern_json IS NOT NULL`
  )) {
    const raw = parseJson<Pattern & { expected?: 'higher' | 'lower' }>(rule.pattern_json, null as never);
    const parsed = parsePattern(rule.pattern_json);
    // Seeded editorial rules describe interview clips; test them inside core interview content, never pooled.
    const pattern = parsed ? { ...parsed, bucket: parsed.bucket ?? 'CORE_INTERVIEW_CONTENT' } : null;
    if (!pattern || !rule.current_version_id) continue;
    result.rulesChecked++;
    const expected = raw?.expected ?? get<{ direction: string }>(db, 'SELECT l.direction FROM rule_proposals p JOIN lessons l ON l.id = p.lesson_id WHERE p.pattern_json = ? LIMIT 1', rule.pattern_json)?.direction;
    const expectedVerdict = expected === 'lower' || expected === 'negative' ? 'negative' : 'positive';

    const recentEval = evaluatePattern(recent, pattern, { asOf: now.toISOString() });
    const fullEval = evaluatePattern(allFacts, pattern, { asOf: now.toISOString() });
    const c = recentEval.comparison;
    if (c.nGroup < cfg.minRecentSample) continue;
    const reversed = (c.verdict === 'positive' || c.verdict === 'negative') && c.verdict !== expectedVerdict && rank(c.confidence) >= rank('EARLY_SIGNAL');
    const flat = c.verdict === 'no_difference' && rank(c.confidence) >= rank('MODERATE_SIGNAL');
    if (!reversed && !flat) continue;
    if (get(db, `SELECT 1 FROM rule_challenges WHERE rule_id = ? AND status = 'open'`, rule.id)) continue;

    const describe = describePattern(labels, pattern);
    const summary = reversed
      ? `Recent data (last ${cfg.recentDays} days) runs against ${rule.code}: ${describe} is now ${c.effect?.toFixed(2)}x (${c.nGroup} vs ${c.nRest} posts), opposite to what the rule expects.`
      : `Recent data (last ${cfg.recentDays} days) no longer shows the difference ${rule.code} relies on: ${describe} is ${c.effect?.toFixed(2)}x (${c.nGroup} vs ${c.nRest} posts).`;
    const metric = pattern.metric;
    const med = c.medianRest ?? 0;
    const groupWithValues = recentEval.groupFacts.filter((f) => typeof f.rates[metric] === 'number');
    const supporting = groupWithValues.filter((f) => (expectedVerdict === 'positive' ? f.rates[metric]! > med : f.rates[metric]! < med));
    const contradicting = groupWithValues.filter((f) => !supporting.includes(f));

    run(
      db,
      `INSERT INTO rule_challenges (rule_id, rule_version_id, summary, new_evidence_json, supporting_json, contradicting_json, sample_size, confidence_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      rule.id,
      rule.current_version_id,
      summary,
      json({ recent: { ...c, dateRange: recentEval.dateRange }, fullHistory: { ...fullEval.comparison, dateRange: fullEval.dateRange }, expected: expectedVerdict, windowDays: cfg.recentDays }),
      json(supporting.slice(0, 8).map((f) => ({ contentId: f.contentId, title: f.title }))),
      json(contradicting.slice(0, 8).map((f) => ({ contentId: f.contentId, title: f.title }))),
      c.nGroup,
      c.confidence
    );
    result.opened++;
  }
  return result;
}

export type ChallengeDecision =
  | { action: 'keep'; note?: string }
  | { action: 'narrow'; appliesTo: AppliesTo; text?: string; note?: string }
  | { action: 'replace'; text: string; note?: string }
  | { action: 'deactivate'; note?: string }
  | { action: 'observe'; note?: string };

export function decideChallenge(db: Db, challengeId: number, decision: ChallengeDecision, root?: string): void {
  tx(db, () => {
    const ch = get<{ id: number; rule_id: number; status: string; summary: string; sample_size: number | null; confidence_label: string | null }>(db, 'SELECT * FROM rule_challenges WHERE id = ?', challengeId);
    if (!ch) throw new Error(`Challenge ${challengeId} not found.`);
    if (ch.status !== 'open') throw new Error(`Challenge ${challengeId} was already decided (${ch.status}).`);
    const rule = get<{ id: number; current_version_id: number }>(db, 'SELECT id, current_version_id FROM rules WHERE id = ?', ch.rule_id)!;
    const current = get<{ version: number; text: string; applies_to_json: string; scope: string }>(db, 'SELECT version, text, applies_to_json, scope FROM rule_versions WHERE id = ?', rule.current_version_id)!;
    const now = nowIso();
    const statusFor: Record<ChallengeDecision['action'], string> = { keep: 'kept', narrow: 'narrowed', replace: 'replaced', deactivate: 'deactivated', observe: 'observing' };

    if (decision.action === 'narrow' || decision.action === 'replace') {
      const text = decision.action === 'replace' ? decision.text.trim() : decision.text?.trim() || current.text;
      if (!text) throw new Error('Rule text cannot be empty.');
      const appliesTo = decision.action === 'narrow' ? decision.appliesTo : parseJson<AppliesTo>(current.applies_to_json, {});
      const scoped = Boolean(appliesTo.franchises?.length || appliesTo.platforms?.length || appliesTo.formats?.length);
      const versionId = run(
        db,
        `INSERT INTO rule_versions (rule_id, version, text, reason, scope, applies_to_json, evidence_summary, sample_size, confidence_label, proposed_by, approval_status, activated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'human', 'approved', ?)`,
        rule.id,
        current.version + 1,
        text,
        `${decision.action === 'narrow' ? 'Narrowed' : 'Replaced'} after challenge: ${ch.summary}`,
        scoped ? 'scoped' : 'global',
        json(appliesTo),
        `Challenge #${ch.id}: ${ch.sample_size ?? '?'} recent posts · ${ch.confidence_label ?? ''}`,
        ch.sample_size,
        ch.confidence_label,
        now
      ).lastId;
      run(db, 'UPDATE rule_versions SET deactivated_at = ?, superseded_by_version_id = ? WHERE id = ?', now, versionId, rule.current_version_id);
      run(db, 'UPDATE rules SET current_version_id = ?, updated_at = ? WHERE id = ?', versionId, now, rule.id);
    } else if (decision.action === 'deactivate') {
      run(db, 'UPDATE rule_versions SET deactivated_at = ? WHERE id = ?', now, rule.current_version_id);
      run(db, `UPDATE rules SET status = 'inactive', updated_at = ? WHERE id = ?`, now, rule.id);
    }
    run(db, 'UPDATE rule_challenges SET status = ?, decision_note = ?, decided_at = ? WHERE id = ?', statusFor[decision.action], decision.note ?? null, now, challengeId);
  });
  if (root !== undefined) exportConstraints(db, root);
}

/** Regenerates knowledge/CONSTRAINTS.md from the active rule versions. */
export function exportConstraints(db: Db, root = process.cwd()): string {
  const rows = all<{ code: string; version: number; text: string; applies_to_json: string; proposed_by: string; activated_at: string | null; pattern_json: string | null; evidence_summary: string | null }>(
    db,
    `SELECT r.code, rv.version, rv.text, rv.applies_to_json, rv.proposed_by, rv.activated_at, r.pattern_json, rv.evidence_summary
     FROM rules r JOIN rule_versions rv ON rv.id = r.current_version_id WHERE r.status = 'active' ORDER BY r.code`
  );
  const labels = loadLabels(db);
  const scope = (a: AppliesTo) =>
    [a.workflows?.includes('*') || !a.workflows?.length ? 'all workflows' : a.workflows.join(', '), a.franchises?.length ? a.franchises.map((f) => valueLabel(labels, 'franchise', f)).join(', ') : null, a.platforms?.join(', ') ?? null]
      .filter(Boolean)
      .join(' · ');
  const md = [
    '# BBO CONSTRAINTS — active operating rules',
    '',
    '> Generated from the BBO BRAIN database (`rules` / `rule_versions`). Do not edit by hand —',
    '> approve, narrow, replace or deactivate rules in BBO BRAIN and this file is regenerated.',
    '> Permanent rule changes require human approval (R-012).',
    '',
    `_Generated ${nowIso()}_`,
    '',
    '| Code | Version | Rule | Applies to | Origin | Evidence |',
    '|---|---|---|---|---|---|',
    ...rows.map((r) => {
      const pattern = parsePattern(r.pattern_json);
      return `| ${r.code} | v${r.version} | ${r.text.replace(/\|/g, '\\|')} | ${scope(parseJson<AppliesTo>(r.applies_to_json, {}))} | ${r.proposed_by}${r.activated_at ? `, active ${r.activated_at.slice(0, 10)}` : ''} | ${pattern ? describePattern(labels, pattern) : 'principle'}${r.evidence_summary ? ` — ${r.evidence_summary}` : ''} |`;
    }),
    '',
  ].join('\n');
  writeFileSync(path.join(root, 'knowledge', 'CONSTRAINTS.md'), md, 'utf8');
  return md;
}

/** "What did we believe N months ago that we no longer believe?" */
export function beliefChanges(db: Db, sinceIso: string) {
  const lessons = all<{ code: string; text: string; from_status: string | null; to_status: string; note: string | null; occurred_at: string; lesson_id: number }>(
    db,
    `SELECT l.code, l.text, e.from_status, e.to_status, e.note, e.occurred_at, l.id AS lesson_id
     FROM lesson_events e JOIN lessons l ON l.id = e.lesson_id
     WHERE e.occurred_at >= ? AND e.to_status IN ('WEAKENED','CONTRADICTED','ARCHIVED') AND COALESCE(e.from_status,'') NOT IN ('WEAKENED','CONTRADICTED','ARCHIVED')
     ORDER BY e.occurred_at DESC`,
    sinceIso
  );
  const rules = all<{ code: string; version: number; text: string; deactivated_at: string; superseded_by_version_id: number | null; new_text: string | null }>(
    db,
    `SELECT r.code, rv.version, rv.text, rv.deactivated_at, rv.superseded_by_version_id, nv.text AS new_text
     FROM rule_versions rv JOIN rules r ON r.id = rv.rule_id LEFT JOIN rule_versions nv ON nv.id = rv.superseded_by_version_id
     WHERE rv.deactivated_at IS NOT NULL AND rv.deactivated_at >= ? ORDER BY rv.deactivated_at DESC`,
    sinceIso
  );
  return { lessons, rules };
}

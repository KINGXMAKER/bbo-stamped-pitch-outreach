import { describe, expect, it } from 'vitest';
import { all, get, type Db } from '@/lib/db/client';
import { setAttribute, writeMetrics } from '@/lib/ingest/ingest';
import { activeScoreVersion, computeAllScores } from '@/lib/scoring/engine';
import { bhThreshold, mineLessons, nextLessonStatus } from '@/lib/intel/lessons';
import type { PatternEvaluation } from '@/lib/intel/patterns';
import { beliefChanges, decideChallenge, decideProposal, detectRuleChallenges, generateRuleProposals } from '@/lib/rules/engine';
import { loadRelevantRules } from '@/lib/rules/load';
import { makePost, testDb } from './helpers';

// Synthetic test fixture — never shown as BBO data.
const DAY = 86_400_000;

function addPost(db: Db, i: number, start: number, hook: 'confession' | 'question', strong: boolean) {
  const publishedAt = new Date(start + i * 3 * DAY).toISOString();
  const { contentId, postId } = makePost(db, { publishedAt, durationS: 30 });
  setAttribute(db, contentId, 'hook_type', hook, 'human', 1);
  const jitter = (i % 5) * 0.03;
  writeMetrics(
    db,
    postId,
    strong
      ? { reach: 1000 + (i % 7) * 20, shares: 30 * (1 + jitter), comments: 12 * (1 + jitter), saves: 12, likes: 50, avg_watch_time_ms: 15000, skip_rate: 30 }
      : { reach: 1000 + (i % 7) * 20, shares: 10 * (1 + jitter), comments: 5 * (1 + jitter), saves: 5, likes: 45, avg_watch_time_ms: 12000, skip_rate: 35 },
    new Date(start + i * 3 * DAY + 10 * DAY).toISOString(),
    'test'
  );
  return contentId;
}

function seedHistory(db: Db) {
  const start = Date.UTC(2026, 0, 1);
  for (let i = 0; i < 40; i++) addPost(db, i, start, i % 2 === 0 ? 'confession' : 'question', i % 2 === 0);
  computeAllScores(db, activeScoreVersion(db), new Date(Date.UTC(2026, 4, 15)));
}

/** A later metric snapshot: new evidence arriving, as a daily sync would bring. */
function newObservation(db: Db) {
  const post = get<{ id: number }>(db, 'SELECT id FROM platform_posts ORDER BY id LIMIT 1')!;
  const latest = get<{ v: string }>(db, 'SELECT MAX(observed_at) AS v FROM content_metrics')!.v;
  writeMetrics(db, post.id, { likes: 46 }, new Date(new Date(latest).getTime() + DAY).toISOString(), 'test');
}

function confessionScoreLesson(db: Db) {
  return get<{ id: number; status: string; confidence_label: string; metrics_json: string }>(
    db,
    `SELECT id, status, confidence_label, metrics_json FROM lessons
     WHERE pattern_json = '{"key":"hook_type","group":"confession","compare":null,"metric":"performance_score","franchise":null}'`
  );
}

describe('lesson status transitions', () => {
  const evalWith = (verdict: string, confidence: string) => ({ comparison: { verdict, confidence } }) as unknown as PatternEvaluation;
  it('never lets mining overwrite human-final states', () => {
    expect(nextLessonStatus('PROMOTED_TO_RULE', 'positive', evalWith('negative', 'STRONG_SIGNAL'))).toBe('PROMOTED_TO_RULE');
    expect(nextLessonStatus('ARCHIVED', 'positive', evalWith('positive', 'STRONG_SIGNAL'))).toBe('ARCHIVED');
  });
  it('contradicts on a confident reversal and weakens on a flat result', () => {
    expect(nextLessonStatus('SUPPORTED', 'positive', evalWith('negative', 'MODERATE_SIGNAL'))).toBe('CONTRADICTED');
    expect(nextLessonStatus('SUPPORTED', 'positive', evalWith('no_difference', 'MODERATE_SIGNAL'))).toBe('WEAKENED');
    expect(nextLessonStatus('SUPPORTED', 'positive', evalWith('insufficient', 'INSUFFICIENT_DATA'))).toBe('SUPPORTED');
  });
});

describe('the learning loop: content → performance → lesson → rule → workflow → challenge', () => {
  it('scores posts relative to peers', () => {
    const db = testDb();
    seedHistory(db);
    const labels = all<{ label: string; n: number }>(db, 'SELECT label, COUNT(*) AS n FROM performance_scores GROUP BY label');
    expect(labels.reduce((a, b) => a + b.n, 0)).toBe(40);
    const winners = get<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM performance_scores ps JOIN platform_posts pp ON pp.id = ps.platform_post_id
       JOIN content_attribute_current a ON a.content_id = pp.content_id AND a.key = 'hook_type'
       WHERE a.value_text = 'confession' AND ps.score > 1`
    )!.n;
    expect(winners).toBeGreaterThanOrEqual(18);
    // Unweighted metrics are stored as era-normalised peer ratios (weight 0) for mining.
    const components = JSON.parse(get<{ components_json: string }>(db, 'SELECT components_json FROM performance_scores LIMIT 1 OFFSET 20')!.components_json) as Array<{ key: string; weight: number }>;
    expect(components.find((c) => c.key === 'deep_action_rate')).toMatchObject({ weight: 0 });
    expect(components.find((c) => c.key === 'share_rate')!.weight).toBeGreaterThan(0);
  });

  it('controls false discoveries across a mining pass', () => {
    expect(bhThreshold([0.001, 0.01, 0.03, 0.2, 0.5], 0.1)).toBe(0.03);
    expect(bhThreshold([0.2, 0.5, 0.9], 0.1)).toBe(0);
  });

  it('only proposes a rule after repeated evidence, and only activates it on human approval', () => {
    const db = testDb();
    seedHistory(db);

    mineLessons(db);
    const lesson = confessionScoreLesson(db)!;
    expect(lesson.status).toBe('SUPPORTED');
    expect(lesson.confidence_label).toBe('STRONG_SIGNAL');
    expect(generateRuleProposals(db).proposed).toBe(0); // one evaluation is not repeated evidence

    mineLessons(db); // the same data again is not repeated evidence
    expect(JSON.parse(confessionScoreLesson(db)!.metrics_json).supportiveStreak).toBe(1);
    expect(generateRuleProposals(db).proposed).toBe(0);

    newObservation(db);
    mineLessons(db);
    expect(JSON.parse(confessionScoreLesson(db)!.metrics_json).supportiveStreak).toBe(2);
    expect(generateRuleProposals(db).proposed).toBeGreaterThan(0);
    expect(generateRuleProposals(db).proposed).toBe(0); // no duplicate pending proposals

    const proposal = get<{ id: number; proposed_text: string; supporting_json: string }>(db, 'SELECT id, proposed_text, supporting_json FROM rule_proposals WHERE lesson_id = ?', lesson.id)!;
    expect(proposal.proposed_text).toMatch(/^Favor hook type: confession — associated with/);
    expect(JSON.parse(proposal.supporting_json).length).toBeGreaterThan(0);

    // Nothing is active before a human decides.
    expect(loadRelevantRules(db, { workflow: 'viral_editor' }).some((r) => r.text === proposal.proposed_text)).toBe(false);

    const { ruleId } = decideProposal(db, proposal.id, { action: 'edit_approve', text: 'Open on the confession when the footage has one.' });
    expect(ruleId).toBeTruthy();
    expect(() => decideProposal(db, proposal.id, { action: 'approve' })).toThrow(/already decided/);
    expect(confessionScoreLesson(db)!.status).toBe('PROMOTED_TO_RULE');

    const editorRules = loadRelevantRules(db, { workflow: 'viral_editor', franchise: 'podcast' });
    expect(editorRules.some((r) => r.text === 'Open on the confession when the footage has one.')).toBe(true);
    expect(loadRelevantRules(db, { workflow: 'caption' }).some((r) => r.ruleId === ruleId)).toBe(false);
  });

  it('keeps observing or rejecting without creating rules or re-proposing on the same evidence', () => {
    const db = testDb();
    seedHistory(db);
    mineLessons(db);
    newObservation(db);
    mineLessons(db);
    generateRuleProposals(db);
    const pending = all<{ id: number; lesson_id: number }>(db, `SELECT id, lesson_id FROM rule_proposals WHERE status = 'pending'`);
    const rulesBefore = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM rules')!.n;
    decideProposal(db, pending[0].id, { action: 'reject', note: 'confessions are not always on-brand' });
    decideProposal(db, pending[1].id, { action: 'observe' });
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM rules')!.n).toBe(rulesBefore);
    mineLessons(db);
    generateRuleProposals(db);
    expect(get(db, `SELECT 1 FROM rule_proposals WHERE lesson_id = ? AND status = 'pending'`, pending[0].lesson_id)).toBeUndefined();
    expect(get(db, `SELECT 1 FROM rule_proposals WHERE lesson_id = ? AND status = 'pending'`, pending[1].lesson_id)).toBeUndefined();
  });

  it('scopes seeded rules: podcast editors get R-015, other franchises and unknown contexts do not', () => {
    const db = testDb();
    const codes = (franchise: string | null) => loadRelevantRules(db, { workflow: 'viral_editor', franchise }).map((r) => r.code);
    expect(codes('podcast')).toContain('R-015');
    expect(codes('bbo-court')).not.toContain('R-015');
    expect(codes(null)).not.toContain('R-015');
    expect(codes('bbo-court')).toContain('R-001');
    expect(loadRelevantRules(db, { workflow: 'caption' }).map((r) => r.code)).toContain('R-014');
    expect(loadRelevantRules(db, { workflow: 'caption' }).map((r) => r.code)).not.toContain('R-001');
  });

  it('lets new evidence challenge an approved rule, and records the change of belief', () => {
    const db = testDb();
    seedHistory(db);
    mineLessons(db);
    newObservation(db);
    mineLessons(db);
    generateRuleProposals(db);
    const lesson = confessionScoreLesson(db)!;
    const proposal = get<{ id: number }>(db, 'SELECT id FROM rule_proposals WHERE lesson_id = ?', lesson.id)!;
    const { ruleId } = decideProposal(db, proposal.id, { action: 'approve' });

    // Recent weeks flip: confessions now underperform.
    const recentStart = Date.UTC(2026, 6, 20);
    for (let i = 0; i < 20; i++) addPost(db, i, recentStart, i % 2 === 0 ? 'confession' : 'question', i % 2 !== 0);
    const now = new Date(Date.UTC(2026, 8, 15));
    computeAllScores(db, activeScoreVersion(db), now);

    expect(detectRuleChallenges(db, now).opened).toBe(1);
    expect(detectRuleChallenges(db, now).opened).toBe(0); // one open challenge per rule

    const challenge = get<{ id: number; summary: string }>(db, `SELECT id, summary FROM rule_challenges WHERE rule_id = ? AND status = 'open'`, ruleId)!;
    expect(challenge.summary).toMatch(/opposite to what the rule expects/);

    decideChallenge(db, challenge.id, { action: 'narrow', appliesTo: { workflows: ['viral_editor'], franchises: ['bbo-after-hours'] } });
    const versions = all<{ version: number; deactivated_at: string | null; superseded_by_version_id: number | null }>(db, 'SELECT version, deactivated_at, superseded_by_version_id FROM rule_versions WHERE rule_id = ? ORDER BY version', ruleId);
    expect(versions).toHaveLength(2);
    expect(versions[0].deactivated_at).not.toBeNull();
    expect(versions[0].superseded_by_version_id).not.toBeNull();
    expect(loadRelevantRules(db, { workflow: 'viral_editor', franchise: 'podcast' }).some((r) => r.ruleId === ruleId)).toBe(false);
    expect(loadRelevantRules(db, { workflow: 'viral_editor', franchise: 'bbo-after-hours' }).some((r) => r.ruleId === ruleId)).toBe(true);

    const changes = beliefChanges(db, '2026-01-01T00:00:00.000Z');
    expect(changes.rules.some((r) => r.superseded_by_version_id !== null)).toBe(true);
  });
});

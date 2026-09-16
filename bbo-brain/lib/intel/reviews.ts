import { z } from 'zod';
import { all, get, json, parseJson, run, type Db } from '@/lib/db/client';
import { aiConfigured, runAi } from '@/lib/ai/run';
import { looseText } from '@/lib/ai/schema';
import { loadRelevantRules, rulesPromptBlock } from '@/lib/rules/load';
import { comparable, loadFacts, type ContentFact, type MetricKey } from './dataset';
import { loadLabels, valueLabel } from './patterns';
import { median } from './stats';

export type PostRef = { contentId: number; title: string; value: number | null; score: number | null; label: string | null; franchise: string | null; publishedAt: string };

const ref = (f: ContentFact, value: number | null): PostRef => ({ contentId: f.contentId, title: f.title, value, score: f.score, label: f.label, franchise: f.franchiseName, publishedAt: f.publishedAt });

function topBy(facts: ContentFact[], get: (f: ContentFact) => number | undefined, n: number, dir: 'desc' | 'asc'): PostRef[] {
  return facts
    .map((f) => ({ f, v: get(f) }))
    .filter((x): x is { f: ContentFact; v: number } => typeof x.v === 'number' && Number.isFinite(x.v))
    .sort((a, b) => (dir === 'desc' ? b.v - a.v : a.v - b.v))
    .slice(0, n)
    .map((x) => ref(x.f, x.v));
}

const COMPARE_KEYS = ['hook_type', 'opening_speaker_role', 'caption_type', 'cta_type', 'duration_bucket', 'franchise', 'editing_style', 'payoff_first', 'reaction_timing', 'has_text_hook', 'posting_day', 'posting_daypart', 'audit_lane'];

export type DimensionDiff = { dimension: string; value: string; winners: number; losers: number; winnerShare: number; loserShare: number };

/** What was different between this period's best and worst posts — counts, not conclusions. */
export function winnerLoserDiffs(db: Db, facts: ContentFact[]): DimensionDiff[] {
  const scored = facts.filter((f) => f.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  if (scored.length < 4) return [];
  const third = Math.max(2, Math.floor(scored.length / 3));
  const winners = scored.slice(0, third);
  const losers = scored.slice(-third);
  const labels = loadLabels(db);
  const diffs: DimensionDiff[] = [];
  const valuesOf = (f: ContentFact, key: string): string[] =>
    key === 'topic' ? f.topics.map((t) => t.slug) : key === 'guest' ? f.people.filter((p) => p.role === 'guest').map((p) => String(p.id)) : f.attrs[key] ? [f.attrs[key]] : key === 'franchise' && f.franchise ? [f.franchise] : [];
  for (const key of [...COMPARE_KEYS, 'topic', 'guest']) {
    const counts = new Map<string, { w: number; l: number }>();
    for (const f of winners) for (const v of valuesOf(f, key)) counts.set(v, { w: (counts.get(v)?.w ?? 0) + 1, l: counts.get(v)?.l ?? 0 });
    for (const f of losers) for (const v of valuesOf(f, key)) counts.set(v, { w: counts.get(v)?.w ?? 0, l: (counts.get(v)?.l ?? 0) + 1 });
    for (const [value, c] of counts) {
      const ws = c.w / winners.length;
      const ls = c.l / losers.length;
      if (Math.abs(ws - ls) >= 0.3 && c.w + c.l >= 2) {
        const dimension = key === 'guest' ? 'guest' : key === 'topic' ? 'topic' : labels.attr.get(key) ?? key;
        const shown = key === 'guest' ? valueLabel(labels, 'person', value) : valueLabel(labels, key === 'topic' ? 'topic' : key, value);
        diffs.push({ dimension, value: shown, winners: c.w, losers: c.l, winnerShare: ws, loserShare: ls });
      }
    }
  }
  return diffs.sort((a, b) => Math.abs(b.winnerShare - b.loserShare) - Math.abs(a.winnerShare - a.loserShare)).slice(0, 12);
}

const SUMMARY_METRICS: MetricKey[] = ['performance_score', 'reach', 'share_rate', 'comment_rate', 'save_rate', 'retention', 'deep_action_rate'];

function medians(facts: ContentFact[]) {
  return Object.fromEntries(SUMMARY_METRICS.map((m) => [m, median(facts.map((f) => f.rates[m]).filter((v): v is number => typeof v === 'number'))])) as Record<MetricKey, number | null>;
}

export type ReviewEvidence = ReturnType<typeof buildReviewEvidence>;

export function buildReviewEvidence(db: Db, period: { start: string; end: string }, previous: { start: string; end: string }, now = new Date()) {
  const all_ = loadFacts(db);
  const inWindow = all_.filter((f) => f.publishedAt >= period.start && f.publishedAt < period.end);
  const prevWindow = all_.filter((f) => f.publishedAt >= previous.start && f.publishedAt < previous.end);
  const mature = comparable(inWindow);
  const prevMature = comparable(prevWindow);
  const history = comparable(all_);
  const day = 86_400_000;
  const labels = loadLabels(db);

  // Topic & guest intelligence over full history.
  const topicStats = new Map<string, { name: string; scores: number[]; last: string; recent14: number; window: number[] }>();
  const guestStats = new Map<number, { name: string; scores: number[]; last: string }>();
  for (const f of history) {
    for (const t of f.topics) {
      const s = topicStats.get(t.slug) ?? { name: t.name, scores: [], last: '', recent14: 0, window: [] };
      s.scores.push(f.score!);
      if (f.publishedAt > s.last) s.last = f.publishedAt;
      if (new Date(f.publishedAt).getTime() >= now.getTime() - 14 * day) s.recent14++;
      if (f.publishedAt >= period.start && f.publishedAt < period.end) s.window.push(f.score!);
      topicStats.set(t.slug, s);
    }
    for (const p of f.people.filter((x) => x.role === 'guest')) {
      const s = guestStats.get(p.id) ?? { name: p.name, scores: [], last: '' };
      s.scores.push(f.score!);
      if (f.publishedAt > s.last) s.last = f.publishedAt;
      guestStats.set(p.id, s);
    }
  }
  const thirtyAgo = new Date(now.getTime() - 30 * day).toISOString();
  const topicsToRevisit = [...topicStats.entries()]
    .filter(([, s]) => s.scores.length >= 5 && (median(s.scores) ?? 0) >= 1.15 && s.last < thirtyAgo)
    .map(([slug, s]) => ({ slug, name: s.name, medianScore: median(s.scores), n: s.scores.length, lastUsed: s.last.slice(0, 10) }))
    .sort((a, b) => (b.medianScore ?? 0) - (a.medianScore ?? 0))
    .slice(0, 5);
  const topicsToPause = [...topicStats.entries()]
    .filter(([, s]) => s.window.length >= 3 && (median(s.window) ?? 1) < 0.85)
    .map(([slug, s]) => ({ slug, name: s.name, medianScoreThisPeriod: median(s.window), nThisPeriod: s.window.length, historicalMedian: median(s.scores), n: s.scores.length }))
    .slice(0, 5);
  const guestsToRevisit = [...guestStats.entries()]
    .filter(([, s]) => s.scores.length >= 2 && (median(s.scores) ?? 0) >= 1.2 && s.last < thirtyAgo)
    .map(([id, s]) => ({ personId: id, name: s.name, medianScore: median(s.scores), appearances: s.scores.length, lastAppearance: s.last.slice(0, 10) }))
    .sort((a, b) => (b.medianScore ?? 0) - (a.medianScore ?? 0))
    .slice(0, 5);

  const franchiseMix = (list: ContentFact[]) => {
    const m = new Map<string, number>();
    for (const f of list) m.set(f.franchiseName ?? 'Unclassified', (m.get(f.franchiseName ?? 'Unclassified') ?? 0) + 1);
    return Object.fromEntries(m);
  };

  const lessonEvents = all<{ code: string; text: string; from_status: string | null; to_status: string; to_confidence: string; occurred_at: string; lesson_id: number }>(
    db,
    `SELECT l.code, l.text, e.from_status, e.to_status, e.to_confidence, e.occurred_at, l.id AS lesson_id FROM lesson_events e JOIN lessons l ON l.id = e.lesson_id
     WHERE e.occurred_at >= ? AND e.occurred_at < ? ORDER BY e.occurred_at DESC LIMIT 30`,
    period.start,
    new Date(new Date(period.end).getTime() + day).toISOString()
  );
  const strongestLesson = get<{ id: number; code: string; text: string; confidence_label: string; sample_size: number | null; status: string }>(
    db,
    `SELECT id, code, text, confidence_label, sample_size, status FROM lessons WHERE status IN ('SUPPORTED','PROMOTED_TO_RULE')
     ORDER BY CASE confidence_label WHEN 'STRONG_SIGNAL' THEN 0 WHEN 'MODERATE_SIGNAL' THEN 1 ELSE 2 END, updated_at DESC LIMIT 1`
  );
  const earlySignal = get<{ id: number; code: string; text: string; sample_size: number | null }>(
    db,
    `SELECT id, code, text, sample_size FROM lessons WHERE confidence_label = 'EARLY_SIGNAL' AND status IN ('NEW','OBSERVING') AND origin = 'pattern_mining' ORDER BY updated_at DESC LIMIT 1`
  );
  const pendingProposal = get<{ id: number; proposed_text: string; sample_size: number | null; confidence_label: string | null }>(db, `SELECT id, proposed_text, sample_size, confidence_label FROM rule_proposals WHERE status = 'pending' ORDER BY id DESC LIMIT 1`);
  const experiment = get<{ id: number; code: string; name: string; status: string; result_summary: string | null }>(
    db,
    `SELECT id, code, name, status, result_summary FROM experiments WHERE status IN ('running','proposed') ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, id LIMIT 1`
  );
  const opportunities = all<{ id: number; title: string; why: string; confidence_label: string; sample_size: number }>(
    db,
    `SELECT id, title, why, confidence_label, sample_size FROM content_opportunities WHERE batch_id = (SELECT batch_id FROM content_opportunities ORDER BY id DESC LIMIT 1) AND status != 'dismissed' ORDER BY priority DESC LIMIT 3`
  );

  return {
    period,
    previous,
    counts: { posts: inWindow.length, mature: mature.length, immature: inWindow.length - mature.length, previousPosts: prevWindow.length, previousMature: prevMature.length },
    top: {
      shares: topBy(mature, (f) => f.rates.shares, 3, 'desc'),
      retention: topBy(mature, (f) => f.rates.retention, 3, 'desc'),
      comments: topBy(mature, (f) => f.rates.comments, 3, 'desc'),
      score: topBy(mature, (f) => f.score ?? undefined, 3, 'desc'),
    },
    bottom: {
      retention: topBy(mature, (f) => f.rates.retention, 3, 'asc'),
      score: topBy(mature, (f) => f.score ?? undefined, 3, 'asc'),
    },
    medians: { current: medians(mature), previous: medians(prevMature), history: medians(history) },
    franchiseMix: { current: franchiseMix(inWindow), previous: franchiseMix(prevWindow) },
    differences: winnerLoserDiffs(db, mature),
    lessonEvents,
    strongestLesson: strongestLesson ?? null,
    earlySignal: earlySignal ?? null,
    pendingProposal: pendingProposal ?? null,
    experiment: experiment ?? null,
    opportunities,
    topicsToRevisit,
    topicsToPause,
    guestsToRevisit,
    labelsNote: `Scores are relative to BBO's own comparable posts (1.0 = expected). Posts under 48h old are excluded from rankings.`,
    attributeLabels: Object.fromEntries(labels.attr),
  };
}

const WEEKLY_KEYS = ['what_worked', 'what_failed', 'what_changed', 'new_pattern', 'early_signal', 'strongest_lesson', 'experiment_for_this_week', 'rule_change_proposed', 'what_to_make_next', 'topics_to_revisit', 'topics_to_pause', 'guests_to_revisit'] as const;
const MONTHLY_KEYS = ['what_bbo_learned', 'strongest_content', 'weakest_content', 'biggest_changes', 'emerging_topic', 'declining_topic', 'best_hook_type', 'weak_hook_type', 'guest_insights', 'duration_insights', 'editing_insights', 'caption_insights', 'platform_differences', 'rules_added', 'rules_challenged', 'experiments_completed', 'experiments_running', 'next_moves'] as const;

const narrativeSchema = (keys: readonly string[]) => z.object(Object.fromEntries(keys.map((k) => [k, looseText()])) as Record<string, ReturnType<typeof looseText>>);

const REVIEW_TEMPLATE = `You write BBO's {{kind}} content review for King Maker. Direct, specific, zero fluff, culturally fluent, never corporate.
Use ONLY the evidence JSON. Every claim cites post titles, sample sizes or medians from it. If evidence is thin (few mature posts), say so plainly.
Correlation language only ("associated with"). Never invent numbers, posts, guests or topics. If a section has no evidence, write "No evidence this period."
Return JSON with exactly these string keys: {{keys}}.`;

const pct = (v: number | null | undefined) => (typeof v === 'number' ? `${(v * 100).toFixed(2)}%` : '—');
const x2 = (v: number | null | undefined) => (typeof v === 'number' ? v.toFixed(2) : '—');

/** Deterministic narrative so a review always exists even with AI unavailable. */
export function fallbackWeeklyNarrative(e: ReviewEvidence): Record<(typeof WEEKLY_KEYS)[number], string> {
  const titles = (refs: PostRef[]) => (refs.length ? refs.map((r) => `"${r.title}" (${x2(r.score)})`).join(', ') : 'No mature posts this period.');
  const cur = e.medians.current;
  const prev = e.medians.previous;
  const diff = e.differences[0];
  return {
    what_worked: `Top by performance score: ${titles(e.top.score)}.`,
    what_failed: `Bottom by performance score: ${titles(e.bottom.score)}.`,
    what_changed: `Median score ${x2(cur.performance_score)} vs ${x2(prev.performance_score)} last period; share rate ${pct(cur.share_rate)} vs ${pct(prev.share_rate)}; ${e.counts.mature} mature posts vs ${e.counts.previousMature}.`,
    new_pattern: diff ? `${diff.dimension} "${diff.value}" appeared in ${diff.winners} of the top third and ${diff.losers} of the bottom third this period (counts only, small sample).` : 'No evidence this period.',
    early_signal: e.earlySignal ? `${e.earlySignal.code}: ${e.earlySignal.text}` : 'No evidence this period.',
    strongest_lesson: e.strongestLesson ? `${e.strongestLesson.code}: ${e.strongestLesson.text}` : 'No evidence this period.',
    experiment_for_this_week: e.experiment ? `${e.experiment.code} ${e.experiment.name} (${e.experiment.status}). ${e.experiment.result_summary ?? ''}` : 'No evidence this period.',
    rule_change_proposed: e.pendingProposal ? `${e.pendingProposal.proposed_text} (${e.pendingProposal.sample_size ?? '?'} posts, ${e.pendingProposal.confidence_label ?? ''})` : 'No pending rule proposals.',
    what_to_make_next: e.opportunities.length ? e.opportunities.map((o) => o.title).join(' · ') : 'No evidence this period.',
    topics_to_revisit: e.topicsToRevisit.length ? e.topicsToRevisit.map((t) => `${t.name} (median ${x2(t.medianScore)}, n=${t.n}, last ${t.lastUsed})`).join('; ') : 'No evidence this period.',
    topics_to_pause: e.topicsToPause.length ? e.topicsToPause.map((t) => `${t.name} (median ${x2(t.medianScoreThisPeriod)} across ${t.nThisPeriod} posts)`).join('; ') : 'No evidence this period.',
    guests_to_revisit: e.guestsToRevisit.length ? e.guestsToRevisit.map((g) => `${g.name} (median ${x2(g.medianScore)}, ${g.appearances} appearances, last ${g.lastAppearance})`).join('; ') : 'No evidence this period.',
  };
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function narrate(db: Db, kind: 'weekly' | 'monthly', keys: readonly string[], evidence: unknown): Promise<{ narrative: Record<string, string> | null; runId: number | null; error: string | null }> {
  if (!aiConfigured()) return { narrative: null, runId: null, error: 'AI not configured' };
  const rules = loadRelevantRules(db, { workflow: `${kind}_review` });
  try {
    const result = await runAi({
      db,
      workflow: `${kind}_review`,
      task: 'synthesis',
      promptSlug: `${kind}-review`,
      template: REVIEW_TEMPLATE,
      schemaVersion: `${kind}-review-v1`,
      system: REVIEW_TEMPLATE.replace('{{kind}}', kind).replace('{{keys}}', keys.join(', ')) + `\n\n${rulesPromptBlock(rules)}`,
      prompt: `EVIDENCE JSON:\n${JSON.stringify(evidence)}`,
      schema: narrativeSchema(keys),
      input: { kind, period: (evidence as { period: unknown }).period },
      ruleVersionIds: rules.map((r) => r.versionId),
      temperature: 0.4,
      maxOutputTokens: 5000,
      thinkingBudget: 1024,
    });
    return { narrative: result.data, runId: result.runId, error: null };
  } catch (err) {
    return { narrative: null, runId: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function buildWeeklyReview(db: Db, now = new Date()): Promise<number> {
  const day = 86_400_000;
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + day);
  const start = new Date(end.getTime() - 7 * day);
  const prevStart = new Date(start.getTime() - 7 * day);
  const evidence = buildReviewEvidence(db, { start: start.toISOString(), end: end.toISOString() }, { start: prevStart.toISOString(), end: start.toISOString() }, now);
  const { narrative, runId, error } = await narrate(db, 'weekly', WEEKLY_KEYS, evidence);
  const final = narrative ? { source: 'ai', ...narrative } : { source: 'deterministic', aiError: error, ...fallbackWeeklyNarrative(evidence) };
  run(
    db,
    `INSERT INTO weekly_reviews (period_start, period_end, evidence_json, narrative_json, ai_run_id) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (period_start, period_end) DO UPDATE SET evidence_json = excluded.evidence_json, narrative_json = excluded.narrative_json, ai_run_id = excluded.ai_run_id, created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    isoDay(start),
    isoDay(new Date(end.getTime() - day)),
    json(evidence),
    json(final),
    runId
  );
  return get<{ id: number }>(db, 'SELECT id FROM weekly_reviews WHERE period_start = ? AND period_end = ?', isoDay(start), isoDay(new Date(end.getTime() - day)))!.id;
}

export async function buildMonthlyReview(db: Db, now = new Date()): Promise<number> {
  const day = 86_400_000;
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + day);
  const start = new Date(end.getTime() - 30 * day);
  const prevStart = new Date(start.getTime() - 30 * day);
  const base = buildReviewEvidence(db, { start: start.toISOString(), end: end.toISOString() }, { start: prevStart.toISOString(), end: start.toISOString() }, now);
  const rulesAdded = all<{ code: string; version: number; text: string; activated_at: string }>(
    db,
    `SELECT r.code, rv.version, rv.text, rv.activated_at FROM rule_versions rv JOIN rules r ON r.id = rv.rule_id WHERE rv.activated_at >= ? AND rv.proposed_by != 'seed' ORDER BY rv.activated_at DESC`,
    start.toISOString()
  );
  const challenges = all<{ id: number; summary: string; status: string; created_at: string }>(db, 'SELECT id, summary, status, created_at FROM rule_challenges WHERE created_at >= ? ORDER BY created_at DESC', start.toISOString());
  const experiments = all<{ code: string; name: string; status: string; result_summary: string | null; updated_at: string }>(db, `SELECT code, name, status, result_summary, updated_at FROM experiments WHERE status IN ('running','completed') ORDER BY updated_at DESC LIMIT 12`);
  const evidence = { ...base, rulesAdded, challenges, experiments };
  const { narrative, runId, error } = await narrate(db, 'monthly', MONTHLY_KEYS, evidence);
  const w = fallbackWeeklyNarrative(base);
  const final = narrative
    ? { source: 'ai', ...narrative }
    : {
        source: 'deterministic',
        aiError: error,
        what_bbo_learned: `${w.strongest_lesson} Belief changes this month: ${base.lessonEvents.filter((e) => ['WEAKENED', 'CONTRADICTED'].includes(e.to_status)).length}.`,
        strongest_content: w.what_worked,
        weakest_content: w.what_failed,
        biggest_changes: w.what_changed,
        emerging_topic: w.topics_to_revisit,
        declining_topic: w.topics_to_pause,
        best_hook_type: base.differences.find((d) => d.dimension === 'Hook type' && d.winnerShare > d.loserShare)?.value ?? 'No evidence this period.',
        weak_hook_type: base.differences.find((d) => d.dimension === 'Hook type' && d.winnerShare < d.loserShare)?.value ?? 'No evidence this period.',
        guest_insights: w.guests_to_revisit,
        duration_insights: base.differences.find((d) => d.dimension === 'Clip length')?.value ?? 'No evidence this period.',
        editing_insights: base.differences.find((d) => d.dimension === 'Editing style')?.value ?? 'No evidence this period.',
        caption_insights: base.differences.find((d) => d.dimension === 'Caption opening type' || d.dimension === 'CTA')?.value ?? 'No evidence this period.',
        platform_differences: 'Only Instagram is connected; no cross-platform comparison is possible yet.',
        rules_added: rulesAdded.length ? rulesAdded.map((r) => `${r.code} v${r.version}: ${r.text}`).join('; ') : 'No rules added.',
        rules_challenged: challenges.length ? challenges.map((c) => c.summary).join('; ') : 'No rules challenged.',
        experiments_completed: experiments.filter((x) => x.status === 'completed').map((x) => `${x.code} ${x.result_summary ?? ''}`).join('; ') || 'None.',
        experiments_running: experiments.filter((x) => x.status === 'running').map((x) => `${x.code} ${x.name}`).join('; ') || 'None.',
        next_moves: w.what_to_make_next,
      };
  run(
    db,
    `INSERT INTO monthly_reviews (period_start, period_end, evidence_json, narrative_json, ai_run_id) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (period_start, period_end) DO UPDATE SET evidence_json = excluded.evidence_json, narrative_json = excluded.narrative_json, ai_run_id = excluded.ai_run_id, created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    isoDay(start),
    isoDay(new Date(end.getTime() - day)),
    json(evidence),
    json(final),
    runId
  );
  return get<{ id: number }>(db, 'SELECT id FROM monthly_reviews WHERE period_start = ? AND period_end = ?', isoDay(start), isoDay(new Date(end.getTime() - day)))!.id;
}

export function reviewList(db: Db, table: 'weekly_reviews' | 'monthly_reviews') {
  return all<{ id: number; period_start: string; period_end: string; created_at: string; narrative_json: string; evidence_json: string }>(db, `SELECT * FROM ${table} ORDER BY period_end DESC`).map((r) => ({
    ...r,
    narrative: parseJson<Record<string, string>>(r.narrative_json, {}),
    evidence: parseJson<ReviewEvidence>(r.evidence_json, null as never),
  }));
}

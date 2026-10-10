import { all, get, parseJson, type Db } from '@/lib/db/client';
import { ruleViolations, type Violation } from '@/lib/rules/violations';
import { loadRelevantRules } from '@/lib/rules/load';
import { performanceContext } from '@/lib/scoring/context';
import { activeScoreVersion } from '@/lib/scoring/engine';
import { analysisQueue } from './analysis';
import { comparable, loadFacts, type ContentFact, type MetricKey } from './dataset';
import { latestOpportunities } from './opportunities';
import { similarContent } from './similar';
import { compareGroups, median, type ConfidenceLabel } from './stats';

const DAY = 86_400_000;

// ── Content library ──────────────────────────────────────────────────────
export type LibraryFilters = {
  q?: string;
  from?: string;
  to?: string;
  franchise?: string;
  platform?: string;
  guest?: string;
  topic?: string;
  hook?: string;
  label?: string;
  duration?: string;
  outcome?: 'winners' | 'losers';
  experiment?: string;
  status?: string;
  violations?: 'yes';
  sort?: 'newest' | 'views' | 'share_rate' | 'comment_rate' | 'retention' | 'score' | 'saves' | 'gatekeeper';
};

export type LibraryRow = ContentFact & { violations: Violation[]; gatekeeperTotal: number | null; experiments: string[] };

export function libraryQuery(db: Db, f: LibraryFilters): { rows: LibraryRow[]; total: number } {
  let facts = loadFacts(db, { since: f.from, until: f.to ? new Date(new Date(f.to).getTime() + DAY).toISOString() : undefined, platform: f.platform });
  const violations = ruleViolations(db, facts);
  const gatekeeper = new Map(all<{ content_id: number; total: number }>(db, 'SELECT published_content_id AS content_id, final_total AS total FROM edit_sessions WHERE published_content_id IS NOT NULL').map((r) => [r.content_id, r.total]));
  const experiments = new Map<number, string[]>();
  for (const e of all<{ content_id: number; code: string }>(db, 'SELECT ec.content_id, e.code FROM experiment_content ec JOIN experiments e ON e.id = ec.experiment_id')) {
    experiments.set(e.content_id, [...(experiments.get(e.content_id) ?? []), e.code]);
  }
  if (f.q) {
    const q = f.q.toLowerCase();
    facts = facts.filter((x) => x.title.toLowerCase().includes(q) || x.caption.toLowerCase().includes(q));
  }
  if (f.franchise) facts = facts.filter((x) => (f.franchise === 'unclassified' ? !x.franchise : x.franchise === f.franchise));
  if (f.guest) facts = facts.filter((x) => x.people.some((p) => String(p.id) === f.guest));
  if (f.topic) facts = facts.filter((x) => x.topics.some((t) => t.slug === f.topic));
  if (f.hook) facts = facts.filter((x) => x.attrs.hook_type === f.hook);
  if (f.label) facts = facts.filter((x) => x.label === f.label);
  if (f.duration) facts = facts.filter((x) => x.attrs.duration_bucket === f.duration);
  if (f.outcome === 'winners') facts = facts.filter((x) => ['BREAKOUT', 'WINNER'].includes(x.label ?? ''));
  if (f.outcome === 'losers') facts = facts.filter((x) => ['LOSER', 'BELOW_AVERAGE'].includes(x.label ?? ''));
  if (f.experiment) facts = facts.filter((x) => experiments.get(x.contentId)?.includes(f.experiment!));
  if (f.violations === 'yes') facts = facts.filter((x) => violations.has(x.contentId));

  const sortKey: Record<NonNullable<LibraryFilters['sort']>, (x: LibraryRow) => number | string> = {
    newest: (x) => x.publishedAt,
    views: (x) => x.raw.views ?? -1,
    share_rate: (x) => x.rates.share_rate ?? -1,
    comment_rate: (x) => x.rates.comment_rate ?? -1,
    retention: (x) => x.rates.retention ?? -1,
    score: (x) => x.score ?? -1,
    saves: (x) => x.raw.saves ?? -1,
    gatekeeper: (x) => x.gatekeeperTotal ?? -1,
  };
  const rows: LibraryRow[] = facts.map((x) => ({ ...x, violations: violations.get(x.contentId) ?? [], gatekeeperTotal: gatekeeper.get(x.contentId) ?? null, experiments: experiments.get(x.contentId) ?? [] }));
  const key = sortKey[f.sort ?? 'newest'];
  rows.sort((a, b) => {
    const av = key(a);
    const bv = key(b);
    return av < bv ? 1 : av > bv ? -1 : 0;
  });
  return { rows, total: rows.length };
}

export function filterOptions(db: Db) {
  return {
    franchises: all<{ slug: string; name: string; n: number }>(db, 'SELECT f.slug, f.name, COUNT(c.id) AS n FROM franchises f LEFT JOIN content c ON c.franchise_id = f.id GROUP BY f.id ORDER BY n DESC'),
    topics: all<{ slug: string; name: string; n: number }>(db, 'SELECT t.slug, t.name, COUNT(ct.content_id) AS n FROM topics t LEFT JOIN content_topics ct ON ct.topic_id = t.id GROUP BY t.id HAVING n > 0 ORDER BY n DESC'),
    guests: all<{ id: number; name: string; n: number }>(db, `SELECT p.id, p.canonical_name AS name, COUNT(*) AS n FROM people p JOIN content_people cp ON cp.person_id = p.id AND cp.role = 'guest' GROUP BY p.id ORDER BY n DESC`),
    hooks: all<{ value: string; n: number }>(db, `SELECT value_text AS value, COUNT(*) AS n FROM content_attribute_current WHERE key = 'hook_type' GROUP BY value_text ORDER BY n DESC`),
    experiments: all<{ code: string; name: string }>(db, 'SELECT code, name FROM experiments ORDER BY id'),
  };
}

// ── Content detail ───────────────────────────────────────────────────────
export type AnalysisRow = {
  id: number;
  content_id: number;
  ai_run_id: number | null;
  trigger_reasons_json: string;
  outcome: 'winner' | 'loser' | 'notable';
  evidence_basis: string;
  actual_topic: string | null;
  underlying_debate: string | null;
  emotional_trigger: string | null;
  hook_mechanics: string | null;
  tension: string | null;
  payoff: string | null;
  dead_setup: string | null;
  reaction_timing: string | null;
  speaker_dynamics: string | null;
  comment_trigger: string | null;
  share_trigger: string | null;
  curiosity_trigger: string | null;
  outcome_explanation: string | null;
  strongest_moment_json: string | null;
  strongest_opening_json: string | null;
  strongest_standalone_json: string | null;
  retention_strengths_json: string | null;
  retention_weaknesses_json: string | null;
  editing_opportunities_json: string | null;
  reusable_lesson: string | null;
  recommended_experiment: string | null;
  confidence: string | null;
  created_at: string;
};

export function contentDetail(db: Db, contentId: number) {
  const allFacts = loadFacts(db);
  const fact = allFacts.find((f) => f.contentId === contentId) ?? loadFacts(db, { contentIds: [contentId], includeDemo: true })[0];
  if (!fact) return null;
  const mature = comparable(allFacts);
  const transcript = get<{ text: string; segments_json: string | null; model: string | null; created_at: string }>(db, 'SELECT text, segments_json, model, created_at FROM transcripts WHERE content_id = ? ORDER BY id DESC LIMIT 1', contentId);
  const analyses = all<AnalysisRow>(
    db,
    'SELECT * FROM content_analyses WHERE content_id = ? ORDER BY id DESC',
    contentId
  ).map((a) => ({
    ...a,
    strongestMoment: parseJson<{ timestamp: string | null; quote: string; why: string } | null>(a.strongest_moment_json, null),
    strongestOpening: parseJson<{ timestamp: string | null; quote: string; why: string; is_current_opening: boolean | null } | null>(a.strongest_opening_json, null),
    strongestStandalone: parseJson<{ timestamp: string | null; quote: string; why: string } | null>(a.strongest_standalone_json, null),
    retentionStrengths: parseJson<string[]>(a.retention_strengths_json, []),
    retentionWeaknesses: parseJson<string[]>(a.retention_weaknesses_json, []),
    editingOpportunities: parseJson<string[]>(a.editing_opportunities_json, []),
    experiment: parseJson<{ hypothesis: string; variable: string | null; control: string | null; variant: string | null } | null>(a.recommended_experiment, null),
    triggers: parseJson<string[]>(a.trigger_reasons_json, []),
  }));
  const history = all<{ metric: string; value: number; observed_at: string; source: string }>(
    db,
    `SELECT metric, value, observed_at, source FROM content_metrics WHERE platform_post_id = ? AND metric IN ('reach','views','shares','saves','comments','likes') ORDER BY observed_at`,
    fact.postId
  );
  const lessons = all<{ id: number; code: string; text: string; status: string; confidence_label: string; relation: string }>(
    db,
    'SELECT l.id, l.code, l.text, l.status, l.confidence_label, lc.relation FROM lesson_content lc JOIN lessons l ON l.id = lc.lesson_id WHERE lc.content_id = ? ORDER BY lc.relation',
    contentId
  );
  const experiments = all<{ id: number; code: string; name: string; status: string; arm: string }>(
    db,
    'SELECT e.id, e.code, e.name, e.status, ec.arm FROM experiment_content ec JOIN experiments e ON e.id = ec.experiment_id WHERE ec.content_id = ?',
    contentId
  );
  const comments = all<{ text: string; like_count: number | null }>(db, 'SELECT text, like_count FROM content_comments WHERE platform_post_id = ? AND text IS NOT NULL ORDER BY like_count DESC LIMIT 12', fact.postId);
  const commentTotal = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM content_comments WHERE platform_post_id = ?', fact.postId)!.n;
  const attributes = all<{ key: string; label: string; value_text: string; source: string; confidence: number | null; attr_group: string }>(
    db,
    `SELECT a.key, d.label, a.value_text, a.source, a.confidence, d.attr_group FROM content_attribute_current a JOIN attribute_definitions d ON d.key = a.key WHERE a.content_id = ? ORDER BY d.attr_group, d.label`,
    contentId
  );
  return {
    fact,
    transcript: transcript ? { ...transcript, segments: parseJson<Array<{ start: number; end: number; text: string }>>(transcript.segments_json, []) } : null,
    analyses,
    context: performanceContext(fact, mature),
    history,
    lessons,
    experiments,
    comments,
    commentTotal,
    attributes,
    rules: loadRelevantRules(db, { workflow: 'viral_editor', franchise: fact.franchise, platform: fact.platform, format: fact.format }),
    violations: ruleViolations(db, [fact]).get(contentId) ?? [],
    similar: similarContent(mature, fact, 4),
    scoreVersion: activeScoreVersion(db).version,
  };
}

// ── People ───────────────────────────────────────────────────────────────
function medianOf(facts: ContentFact[], metric: MetricKey): number | null {
  return median(facts.map((f) => f.rates[metric]).filter((v): v is number => typeof v === 'number'));
}

export function peopleIndex(db: Db) {
  const facts = loadFacts(db);
  const people = all<{ id: number; canonical_name: string; type: string; gender: string | null; instagram_handle: string | null }>(db, 'SELECT id, canonical_name, type, gender, instagram_handle FROM people ORDER BY canonical_name');
  return people
    .map((p) => {
      const appearances = facts.filter((f) => f.people.some((x) => x.id === p.id));
      const scored = appearances.filter((f) => f.isMature && f.score !== null);
      return {
        ...p,
        roles: [...new Set(appearances.flatMap((f) => f.people.filter((x) => x.id === p.id).map((x) => x.role)))],
        appearances: appearances.length,
        scored: scored.length,
        medianScore: median(scored.map((f) => f.score as number)),
        // Medians of era-normalised ratios: 1.0x = typical for posts of the same time and format.
        shareRatio: medianOf(scored, 'share_rel'),
        commentRatio: medianOf(scored, 'comment_rel'),
        retentionRatio: medianOf(scored, 'retention_rel'),
        lastAppearance: appearances.map((f) => f.publishedAt).sort().pop() ?? null,
      };
    })
    .filter((p) => p.appearances > 0)
    .sort((a, b) => b.appearances - a.appearances || (b.medianScore ?? 0) - (a.medianScore ?? 0));
}

function breakdown(facts: ContentFact[], keyOf: (f: ContentFact) => string[]): Array<{ value: string; n: number; medianScore: number | null }> {
  const groups = new Map<string, number[]>();
  for (const f of facts) for (const k of keyOf(f)) groups.set(k, [...(groups.get(k) ?? []), f.score as number]);
  return [...groups.entries()].map(([value, s]) => ({ value, n: s.length, medianScore: median(s) })).sort((a, b) => (b.medianScore ?? 0) - (a.medianScore ?? 0));
}

export function personDetail(db: Db, personId: number) {
  const person = get<{ id: number; canonical_name: string; type: string; gender: string | null; instagram_handle: string | null; notes: string | null }>(db, 'SELECT * FROM people WHERE id = ?', personId);
  if (!person) return null;
  const facts = loadFacts(db);
  const mature = comparable(facts);
  const theirs = facts.filter((f) => f.people.some((p) => p.id === personId));
  const scored = theirs.filter((f) => f.isMature && f.score !== null);
  const others = mature.filter((f) => !f.people.some((p) => p.id === personId));
  const comparison = compareGroups(
    scored.map((f) => ({ value: f.score as number, at: f.publishedAt })),
    others.map((f) => ({ value: f.score as number, at: f.publishedAt }))
  );
  const last = theirs.map((f) => f.publishedAt).sort().pop() ?? null;
  const daysSince = last ? Math.floor((Date.now() - new Date(last).getTime()) / DAY) : null;
  const verdict =
    scored.length < 2
      ? { text: `Not enough scored appearances to judge (${scored.length}).`, tone: 'neutral' as const }
      : (median(scored.map((f) => f.score as number)) ?? 0) >= 1.15
        ? { text: `Content featuring ${person.canonical_name} is associated with above-baseline performance across ${scored.length} appearances${daysSince !== null && daysSince > 30 ? ` — last seen ${daysSince} days ago. Worth bringing back.` : '.'}`, tone: 'up' as const }
        : { text: `Content featuring ${person.canonical_name} has not outperformed BBO's baseline across ${scored.length} appearances.`, tone: 'down' as const };
  const aliases = all<{ alias: string; source: string }>(db, `SELECT alias, source FROM entity_aliases WHERE entity_type = 'person' AND entity_id = ?`, String(personId));
  return {
    person,
    aliases,
    appearances: theirs,
    comparison,
    verdict,
    lastAppearance: last,
    byTopic: breakdown(scored, (f) => f.topics.map((t) => t.name)),
    byHook: breakdown(scored, (f) => (f.attrs.hook_type ? [f.attrs.hook_type.replace(/_/g, ' ')] : [])),
    byFranchise: breakdown(scored, (f) => (f.franchiseName ? [f.franchiseName] : [])),
    strongest: [...scored].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 3),
    weakest: [...scored].sort((a, b) => (a.score ?? 0) - (b.score ?? 0)).slice(0, 3),
  };
}

// ── Topics ───────────────────────────────────────────────────────────────
export type TopicFlag = 'comments_not_retention' | 'shares_driver' | 'oversaturated' | 'dormant_strong' | 'underperforming';

export function topicIndex(db: Db, now = new Date()) {
  const facts = loadFacts(db);
  const topics = all<{ id: number; slug: string; name: string; parent_id: number | null; parent_name: string | null }>(db, 'SELECT t.id, t.slug, t.name, t.parent_id, p.name AS parent_name FROM topics t LEFT JOIN topics p ON p.id = t.parent_id ORDER BY t.name');
  return topics.map((t) => {
    const tf = facts.filter((f) => f.topics.some((x) => x.id === t.id));
    const scored = tf.filter((f) => f.isMature && f.score !== null);
    const shareRatio = medianOf(scored, 'share_rel');
    const commentRatio = medianOf(scored, 'comment_rel');
    const retentionRatio = medianOf(scored, 'retention_rel');
    const medianScore = median(scored.map((f) => f.score as number));
    const last = tf.map((f) => f.publishedAt).sort().pop() ?? null;
    const last14 = tf.filter((f) => new Date(f.publishedAt).getTime() >= now.getTime() - 14 * DAY).length;
    const flags: TopicFlag[] = [];
    if (scored.length >= 3 && commentRatio !== null && retentionRatio !== null && commentRatio >= 1.3 && retentionRatio < 0.9) flags.push('comments_not_retention');
    if (scored.length >= 3 && shareRatio !== null && shareRatio >= 1.3) flags.push('shares_driver');
    if (last14 >= 4 && medianScore !== null && medianScore < 1) flags.push('oversaturated');
    if (scored.length >= 5 && (medianScore ?? 0) >= 1.15 && last && new Date(last).getTime() < now.getTime() - 30 * DAY) flags.push('dormant_strong');
    if (scored.length >= 5 && (medianScore ?? 1) < 0.85) flags.push('underperforming');
    return { ...t, posts: tf.length, scored: scored.length, medianScore, shareRatio, commentRatio, retentionRatio, lastUsed: last, last14, flags };
  });
}

export function topicDetail(db: Db, slug: string) {
  const topic = get<{ id: number; slug: string; name: string; parent_id: number | null }>(db, 'SELECT * FROM topics WHERE slug = ?', slug);
  if (!topic) return null;
  const facts = loadFacts(db);
  const mature = comparable(facts);
  const theirs = facts.filter((f) => f.topics.some((t) => t.id === topic.id));
  const scored = theirs.filter((f) => f.isMature && f.score !== null);
  const rest = mature.filter((f) => !f.topics.some((t) => t.id === topic.id));
  const obs = (list: ContentFact[], m: MetricKey) => list.flatMap((f) => (typeof f.rates[m] === 'number' ? [{ value: f.rates[m] as number, at: f.publishedAt }] : []));
  const comparisons = (['performance_score', 'share_rel', 'comment_rel', 'retention_rel', 'save_rel'] as MetricKey[]).map((m) => ({ metric: m, comparison: compareGroups(obs(scored, m), obs(rest, m)) }));
  const genderSplit = breakdown(scored, (f) => {
    const g = f.people.filter((p) => p.role === 'guest').map((p) => p.gender ?? 'unknown');
    const mix = f.attrs.guest_gender_mix;
    return mix ? [mix] : g.length ? [...new Set(g)] : ['no tagged guest'];
  });
  return {
    topic,
    parent: topic.parent_id ? get<{ slug: string; name: string }>(db, 'SELECT slug, name FROM topics WHERE id = ?', topic.parent_id) : null,
    children: all<{ slug: string; name: string }>(db, 'SELECT slug, name FROM topics WHERE parent_id = ?', topic.id),
    aliases: all<{ alias: string }>(db, `SELECT alias FROM entity_aliases WHERE entity_type = 'topic' AND entity_id = ?`, String(topic.id)),
    posts: theirs,
    comparisons,
    byFranchise: breakdown(scored, (f) => (f.franchiseName ? [f.franchiseName] : ['Unclassified'])),
    byHook: breakdown(scored, (f) => (f.attrs.hook_type ? [f.attrs.hook_type.replace(/_/g, ' ')] : [])),
    byGuestGender: genderSplit,
    byGuest: breakdown(scored, (f) => f.people.filter((p) => p.role === 'guest').map((p) => p.name)).filter((g) => g.n >= 1).slice(0, 8),
  };
}

// ── Command center ───────────────────────────────────────────────────────
export function commandCenter(db: Db, now = new Date()) {
  const facts = loadFacts(db);
  const mature = comparable(facts);
  const t30 = new Date(now.getTime() - 30 * DAY).toISOString();
  const recentMature = mature.filter((f) => f.publishedAt >= t30);
  const q = analysisQueue(db);
  return {
    totals: {
      content: facts.length,
      scored: mature.length,
      lessons: get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM lessons')!.n,
      activeRules: get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM rules WHERE status = 'active'`)!.n,
      firstPost: facts.map((f) => f.publishedAt).sort()[0] ?? null,
      lastPost: facts.map((f) => f.publishedAt).sort().pop() ?? null,
    },
    breakouts: recentMature.filter((f) => f.label === 'BREAKOUT' || f.label === 'WINNER').sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 4),
    losers: recentMature.filter((f) => f.label === 'LOSER').sort((a, b) => (a.score ?? 0) - (b.score ?? 0)).slice(0, 4),
    recent: facts.slice(0, 8),
    proposals: all<{ id: number; proposed_text: string; sample_size: number | null; confidence_label: ConfidenceLabel | null; created_at: string }>(db, `SELECT id, proposed_text, sample_size, confidence_label, created_at FROM rule_proposals WHERE status = 'pending' ORDER BY id DESC LIMIT 4`),
    challenges: all<{ id: number; summary: string; confidence_label: string | null; code: string }>(db, `SELECT c.id, c.summary, c.confidence_label, r.code FROM rule_challenges c JOIN rules r ON r.id = c.rule_id WHERE c.status = 'open' ORDER BY c.id DESC LIMIT 4`),
    experiments: all<{ id: number; code: string; name: string; status: string; result_summary: string | null }>(db, `SELECT id, code, name, status, result_summary FROM experiments WHERE status IN ('running','proposed') ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, id DESC LIMIT 5`),
    newLessons: all<{ id: number; code: string; text: string; to_status: string; to_confidence: string; occurred_at: string }>(
      db,
      `SELECT l.id, l.code, l.text, e.to_status, e.to_confidence, e.occurred_at FROM lesson_events e JOIN lessons l ON l.id = e.lesson_id
       WHERE e.occurred_at >= ? ORDER BY e.occurred_at DESC LIMIT 6`,
      new Date(now.getTime() - 14 * DAY).toISOString()
    ),
    opportunities: latestOpportunities(db).items.slice(0, 3),
    weekly: get<{ id: number; period_start: string; period_end: string; narrative_json: string }>(db, 'SELECT id, period_start, period_end, narrative_json FROM weekly_reviews ORDER BY period_end DESC LIMIT 1'),
    analysisQueue: { ready: q.ready.slice(0, 5), readyCount: q.ready.length, waitingCount: q.waitingForMedia.length, analysed: q.analysed },
    gatekeeperFailures: all<{ id: number; title: string; final_total: number | null; updated_at: string }>(db, `SELECT id, title, final_total, updated_at FROM edit_sessions WHERE status = 'needs_human' ORDER BY updated_at DESC LIMIT 4`),
    entityReviews: get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM entity_resolution_candidates WHERE status = 'pending'`)!.n,
    syncHealth: all<{ kind: string; status: string; finished_at: string | null; error: string | null }>(
      db,
      `SELECT kind, status, finished_at, error FROM sync_jobs WHERE id IN (SELECT MAX(id) FROM sync_jobs GROUP BY kind) ORDER BY started_at DESC`
    ),
  };
}

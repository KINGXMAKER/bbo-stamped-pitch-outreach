import { z } from 'zod';
import { all, get, type Db } from '@/lib/db/client';
import { aiConfigured, runAi } from '@/lib/ai/run';
import { looseList, looseText } from '@/lib/ai/schema';
import { allActiveRules } from '@/lib/rules/load';
import { beliefChanges } from '@/lib/rules/engine';
import { comparable, loadFacts, METRIC_DEFS, type ContentFact, type MetricKey } from './dataset';
import { latestOpportunities } from './opportunities';
import { loadLabels, parsePattern, describePattern, evaluatePattern, valueLabel } from './patterns';
import { search } from './search';
import { compareGroups, median, type ConfidenceLabel, type GroupComparison } from './stats';
import { topicIndex } from './queries';

/**
 * Ask BBO: question → intent → SQL-backed evidence → AI explains the evidence.
 * The model never sees the database and never produces a number; it narrates
 * an evidence package the code already calculated, and the UI shows that
 * package next to the answer.
 */

export type Intent =
  | { kind: 'learned'; days: number | null }
  | { kind: 'attribute'; key: string; metric: MetricKey; franchise?: string | null; guestGender?: string | null }
  | { kind: 'topics'; metric: MetricKey; mode: 'best' | 'comments_not_retention'; guestGender?: string | null; franchise?: string | null }
  | { kind: 'guests'; metric: MetricKey; mode: 'best' | 'comments_not_retention' }
  | { kind: 'topic_gap'; from: string; to: string }
  | { kind: 'make_next' }
  | { kind: 'stop_doing' }
  | { kind: 'test_next' }
  | { kind: 'rules_evidence' }
  | { kind: 'rules_challenged' }
  | { kind: 'belief_changes'; days: number }
  | { kind: 'why_content'; query: string }
  | { kind: 'search'; query: string };

export type Table = { title: string; columns: string[]; rows: Array<Array<string | number | null>> };

export type Evidence = {
  intent: Intent;
  title: string;
  dateRange: { from: string; to: string } | null;
  sampleSize: number;
  baseline: string | null;
  confidence: ConfidenceLabel | 'N/A';
  tables: Table[];
  supporting: Array<{ contentId: number; title: string; score: number | null; label: string | null }>;
  rules: Array<{ code: string; text: string }>;
  experiments: Array<{ code: string; name: string; status: string }>;
  notes: string[];
};

// Questions span years of history, so they are answered with era-normalised metrics.
const METRIC_WORDS: Array<[RegExp, MetricKey]> = [
  [/deep action/, 'deep_action_rel'],
  [/share/, 'share_rel'],
  [/comment/, 'comment_rel'],
  [/save/, 'save_rel'],
  [/retention|watch|hold|leave|drop/, 'retention_rel'],
  [/reach|views?\b/, 'reach_rel'],
];

function metricFrom(q: string, fallback: MetricKey = 'performance_score'): MetricKey {
  return METRIC_WORDS.find(([re]) => re.test(q))?.[1] ?? fallback;
}

function franchiseFrom(db: Db, q: string): string | null {
  for (const f of all<{ slug: string; alias_norm: string }>(db, `SELECT f.slug, a.alias_norm FROM entity_aliases a JOIN franchises f ON CAST(f.id AS TEXT) = a.entity_id WHERE a.entity_type = 'franchise' ORDER BY LENGTH(a.alias_norm) DESC`)) {
    if (f.alias_norm.length >= 4 && q.includes(f.alias_norm)) return f.slug;
  }
  return null;
}

/** High-precision deterministic router. Returns null when unsure. */
export function routeQuestion(db: Db, question: string): Intent | null {
  const q = question.toLowerCase().replace(/[’']/g, "'");
  const gender = /\bmale\b|\bmen\b|\bguys?\b/.test(q) && !/female|women/.test(q) ? 'male' : /female|\bwomen\b|\bgirls?\b/.test(q) ? 'female' : null;
  const days = /this week|past week|last 7/.test(q) ? 7 : /this month|past month|30 days/.test(q) ? 30 : /three months|3 months|90 days/.test(q) ? 90 : null;

  if (/no longer believe|changed (our|its) mind|used to believe|believe.*(ago|before)/.test(q)) return { kind: 'belief_changes', days: days ?? 90 };
  if (/being challenged|rules?.*(challenged|contradict)|challenged.*rules?/.test(q)) return { kind: 'rules_challenged' };
  if (/rules?.*(strongest|most) evidence|evidence behind.*rules?/.test(q)) return { kind: 'rules_evidence' };
  if (/stop doing|should we stop|stop making/.test(q)) return { kind: 'stop_doing' };
  if (/test next|should we test|what to test|experiment/.test(q)) return { kind: 'test_next' };
  if (/make (next|this week)|should (i|we|bbo) make|what to make|bring back|old topics|revisit/.test(q)) return { kind: 'make_next' };
  if (/learn(ed|t)?\b|strongest content patterns|patterns right now/.test(q)) return { kind: 'learned', days };
  if (/why did .* (win|lose|flop|pop|do)/.test(q)) {
    const m = q.match(/why did (?:the |this |our )?(.+?) (?:clip |post |reel )?(?:win|lose|flop|pop|do)/);
    return { kind: 'why_content', query: m?.[1] ?? question };
  }
  const gap = q.match(/(?:on|in) (?:the )?(podcast|street interviews?|bbo court|court|group chat)\b.*(?:haven't|not|never).*(?:in|been used in|used in) (?:the )?(bbo court|court|podcast|street interviews?|group chat)/);
  if (gap) {
    const slug = (s: string) => (s.includes('court') ? 'bbo-court' : s.includes('street') ? 'street-interview' : s.includes('group') ? 'bbo-group-chat' : 'podcast');
    return { kind: 'topic_gap', from: slug(gap[1]), to: slug(gap[2]) };
  }
  // Topics before guests: "which topics work when the guest is male" is a topic question with a guest filter.
  if (/topics?/.test(q) && !/hook|caption|length|second/.test(q)) {
    return { kind: 'topics', metric: metricFrom(q), mode: /comments? but (poor|weak|bad|low) retention/.test(q) ? 'comments_not_retention' : 'best', guestGender: gender, franchise: franchiseFrom(db, q) };
  }
  if (/guests?/.test(q)) return { kind: 'guests', metric: metricFrom(q), mode: /comments? but (poor|weak|bad|low) retention/.test(q) ? 'comments_not_retention' : 'best' };
  if (/hook|open(ing|s)? |first (two|2|three|3)[- ]second/.test(q)) return { kind: 'attribute', key: /question/.test(q) && /open/.test(q) ? 'question_opening' : 'hook_type', metric: metricFrom(q), franchise: franchiseFrom(db, q), guestGender: gender };
  if (/caption/.test(q)) return { kind: 'attribute', key: 'caption_type', metric: metricFrom(q, 'comment_rel'), franchise: franchiseFrom(db, q) };
  if (/\bcta\b|call to action/.test(q)) return { kind: 'attribute', key: 'cta_type', metric: metricFrom(q, 'deep_action_rel'), franchise: franchiseFrom(db, q) };
  if (/length|seconds?\b|duration|long(er)? clips|short(er)? clips/.test(q)) return { kind: 'attribute', key: 'duration_bucket', metric: metricFrom(q), franchise: franchiseFrom(db, q) };
  if (/reaction/.test(q)) return { kind: 'attribute', key: 'reaction_timing', metric: metricFrom(q, 'retention_rel'), franchise: franchiseFrom(db, q) };
  if (/day of the week|what day|posting time|time of day/.test(q)) return { kind: 'attribute', key: /time/.test(q) ? 'posting_daypart' : 'posting_day', metric: metricFrom(q) };
  if (/franchise|format/.test(q)) return { kind: 'attribute', key: 'franchise', metric: metricFrom(q) };
  return null;
}

const IntentSchema = z.object({
  kind: z.enum(['learned', 'attribute', 'topics', 'guests', 'topic_gap', 'make_next', 'stop_doing', 'test_next', 'rules_evidence', 'rules_challenged', 'belief_changes', 'why_content', 'search']),
  key: z.string().nullable().default(null),
  metric: z.string().nullable().default(null),
  mode: z.string().nullable().default(null),
  franchise: z.string().nullable().default(null),
  from: z.string().nullable().default(null),
  to: z.string().nullable().default(null),
  days: z.number().nullable().default(null),
  query: z.string().nullable().default(null),
});

const CLASSIFY_TEMPLATE = `Classify a question about BBO's content performance into ONE query intent. Do not answer it.
Intents: learned(days), attribute(key, metric, franchise), topics(metric, mode best|comments_not_retention), guests(metric, mode), topic_gap(from, to franchise slugs), make_next, stop_doing, test_next, rules_evidence, rules_challenged, belief_changes(days), why_content(query = words identifying the post), search(query).
Attribute keys: {{keys}}. Metrics: {{metrics}}. Franchise slugs: {{franchises}}.
Return JSON {kind, key, metric, mode, franchise, from, to, days, query} with nulls for unused fields.`;

async function classifyWithAi(db: Db, question: string): Promise<Intent | null> {
  if (!aiConfigured()) return null;
  const keys = all<{ key: string }>(db, `SELECT key FROM attribute_definitions WHERE is_comparable = 1`).map((k) => k.key);
  const franchises = all<{ slug: string }>(db, 'SELECT slug FROM franchises').map((f) => f.slug);
  try {
    const r = await runAi({
      db,
      workflow: 'ask_classify',
      promptSlug: 'ask-classify',
      template: CLASSIFY_TEMPLATE,
      schemaVersion: 'ask-intent-v1',
      system: CLASSIFY_TEMPLATE.replace('{{keys}}', keys.join(', ')).replace('{{metrics}}', Object.keys(METRIC_DEFS).join(', ')).replace('{{franchises}}', franchises.join(', ')),
      prompt: question,
      schema: IntentSchema,
      input: { question },
      temperature: 0,
      maxOutputTokens: 300,
      thinkingBudget: 0,
    });
    const d = r.data;
    const metric = (d.metric && d.metric in METRIC_DEFS ? d.metric : 'performance_score') as MetricKey;
    switch (d.kind) {
      case 'attribute':
        return d.key && keys.includes(d.key) ? { kind: 'attribute', key: d.key, metric, franchise: d.franchise && franchises.includes(d.franchise) ? d.franchise : null } : null;
      case 'topics':
        return { kind: 'topics', metric, mode: d.mode === 'comments_not_retention' ? 'comments_not_retention' : 'best' };
      case 'guests':
        return { kind: 'guests', metric, mode: d.mode === 'comments_not_retention' ? 'comments_not_retention' : 'best' };
      case 'topic_gap':
        return d.from && d.to && franchises.includes(d.from) && franchises.includes(d.to) ? { kind: 'topic_gap', from: d.from, to: d.to } : null;
      case 'learned':
        return { kind: 'learned', days: d.days };
      case 'belief_changes':
        return { kind: 'belief_changes', days: d.days ?? 90 };
      case 'why_content':
        return { kind: 'why_content', query: d.query ?? question };
      case 'search':
        return { kind: 'search', query: d.query ?? question };
      default:
        return { kind: d.kind } as Intent;
    }
  } catch {
    return null;
  }
}

const f2 = (v: number | null | undefined) => (typeof v === 'number' ? Number(v.toFixed(3)) : null);
const rangeOf = (facts: ContentFact[]) => {
  const d = facts.map((f) => f.publishedAt).sort();
  return d.length ? { from: d[0].slice(0, 10), to: d[d.length - 1].slice(0, 10) } : null;
};
const sup = (facts: ContentFact[], n = 5) => [...facts].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, n).map((f) => ({ contentId: f.contentId, title: f.title, score: f.score, label: f.label }));
const strongest = (cs: GroupComparison[]): ConfidenceLabel => (['STRONG_SIGNAL', 'MODERATE_SIGNAL', 'EARLY_SIGNAL', 'INSUFFICIENT_DATA'] as ConfidenceLabel[]).find((l) => cs.some((c) => c.confidence === l)) ?? 'INSUFFICIENT_DATA';

function relatedRulesAndExperiments(db: Db, key: string | null) {
  const rules = allActiveRules(db).filter((r) => {
    if (!key) return false;
    const p = get<{ pattern_json: string | null }>(db, 'SELECT pattern_json FROM rules WHERE id = ?', r.ruleId);
    return parsePattern(p?.pattern_json)?.key === key;
  });
  const experiments = key ? all<{ code: string; name: string; status: string }>(db, `SELECT code, name, status FROM experiments WHERE variable_key = ? AND status != 'abandoned'`, key) : [];
  return { rules: rules.map((r) => ({ code: r.code, text: r.text })), experiments };
}

export function buildEvidence(db: Db, intent: Intent): Evidence {
  const facts = comparable(loadFacts(db));
  const labels = loadLabels(db);
  const base: Omit<Evidence, 'title'> = { intent, dateRange: rangeOf(facts), sampleSize: facts.length, baseline: 'All mature, scored BBO posts (score 1.0 = expected for comparable posts)', confidence: 'N/A', tables: [], supporting: [], rules: [], experiments: [], notes: [] };

  switch (intent.kind) {
    case 'attribute': {
      let pool = intent.franchise ? facts.filter((f) => f.franchise === intent.franchise) : facts;
      if (intent.guestGender) {
        pool = pool.filter((f) => f.attrs.guest_gender_mix === intent.guestGender || f.people.some((p) => p.role === 'guest' && p.gender === intent.guestGender));
        base.notes.push(`Guest gender comes from AI coding or People records; posts with unknown guest gender are excluded (${pool.length} posts remain).`);
      }
      const values = [...new Set(pool.map((f) => f.attrs[intent.key] ?? (intent.key === 'franchise' ? f.franchise ?? undefined : undefined)).filter(Boolean))] as string[];
      const rows = values
        .map((v) => {
          const e = evaluatePattern(pool, { key: intent.key, group: v, metric: intent.metric });
          return { v, e };
        })
        .sort((a, b) => (b.e.comparison.medianGroup ?? 0) - (a.e.comparison.medianGroup ?? 0));
      const coded = pool.filter((f) => (intent.key === 'franchise' ? f.franchise : f.attrs[intent.key]) !== undefined).length;
      const title = `${labels.attr.get(intent.key) ?? intent.key} vs ${METRIC_DEFS[intent.metric].label}${intent.franchise ? ` in ${valueLabel(labels, 'franchise', intent.franchise)}` : ''}`;
      const best = rows[0];
      const rr = relatedRulesAndExperiments(db, intent.key);
      if (coded < pool.length * 0.5) base.notes.push(`Only ${coded} of ${pool.length} posts have "${labels.attr.get(intent.key) ?? intent.key}" coded. Run AI attribute coding to widen the sample.`);
      return {
        ...base,
        ...rr,
        title,
        sampleSize: coded,
        dateRange: rangeOf(pool),
        confidence: strongest(rows.map((r) => r.e.comparison)),
        tables: [
          {
            title,
            columns: ['Value', 'Posts', `Median ${METRIC_DEFS[intent.metric].label}`, 'vs everything else', 'Signal'],
            rows: rows.map((r) => [valueLabel(labels, intent.key, r.v), r.e.comparison.nGroup, f2(r.e.comparison.medianGroup), r.e.comparison.effect ? `${r.e.comparison.effect.toFixed(2)}x` : '—', r.e.comparison.confidence]),
          },
        ],
        supporting: best ? sup(best.e.groupFacts) : [],
      };
    }
    case 'topics': {
      let pool = intent.franchise ? facts.filter((f) => f.franchise === intent.franchise) : facts;
      if (intent.guestGender) {
        pool = pool.filter((f) => f.attrs.guest_gender_mix === intent.guestGender || f.people.some((p) => p.role === 'guest' && p.gender === intent.guestGender));
        base.notes.push(`Filtered to posts whose guest is coded ${intent.guestGender}: ${pool.length} posts. Guest gender is often unknown — set it on People pages to widen this.`);
      }
      const topics = topicIndex(db);
      if (intent.mode === 'comments_not_retention') {
        const flagged = topics.filter((t) => t.flags.includes('comments_not_retention'));
        return {
          ...base,
          title: 'Topics that generate comments but weak retention',
          confidence: flagged.length ? 'EARLY_SIGNAL' : 'INSUFFICIENT_DATA',
          tables: [{ title: 'Comment rate vs retention (ratios to BBO median)', columns: ['Topic', 'Scored posts', 'Comment ratio', 'Retention ratio', 'Median score'], rows: flagged.map((t) => [t.name, t.scored, f2(t.commentRatio), f2(t.retentionRatio), f2(t.medianScore)]) }],
          notes: [...base.notes, 'Flag rule: ≥3 scored posts, comment rate ≥1.3x the BBO median and retention <0.9x.'],
        };
      }
      const rows = [...new Set(pool.flatMap((f) => f.topics.map((t) => t.slug)))]
        .map((slug) => ({ slug, e: evaluatePattern(pool, { key: 'topic', group: slug, metric: intent.metric }) }))
        .filter((r) => r.e.comparison.nGroup >= 3)
        .sort((a, b) => (b.e.comparison.effect ?? 0) - (a.e.comparison.effect ?? 0));
      return {
        ...base,
        title: `Topics by ${METRIC_DEFS[intent.metric].label}${intent.guestGender ? ` (guest: ${intent.guestGender})` : ''}`,
        sampleSize: pool.length,
        dateRange: rangeOf(pool),
        confidence: strongest(rows.map((r) => r.e.comparison)),
        tables: [{ title: 'Topic performance', columns: ['Topic', 'Posts', `Median ${METRIC_DEFS[intent.metric].label}`, 'vs other topics', 'Signal'], rows: rows.map((r) => [valueLabel(labels, 'topic', r.slug), r.e.comparison.nGroup, f2(r.e.comparison.medianGroup), r.e.comparison.effect ? `${r.e.comparison.effect.toFixed(2)}x` : '—', r.e.comparison.confidence]) }],
        supporting: rows[0] ? sup(rows[0].e.groupFacts) : [],
      };
    }
    case 'guests': {
      const byGuest = new Map<number, { name: string; facts: ContentFact[] }>();
      for (const f of facts) for (const p of f.people.filter((x) => x.role === 'guest')) byGuest.set(p.id, { name: p.name, facts: [...(byGuest.get(p.id)?.facts ?? []), f] });
      const rows = [...byGuest.values()]
        .filter((g) => g.facts.length >= 2)
        .map((g) => {
          const m = (k: MetricKey) => median(g.facts.map((f) => f.rates[k]).filter((v): v is number => typeof v === 'number'));
          return { name: g.name, n: g.facts.length, value: m(intent.metric === 'performance_score' ? 'share_rel' : intent.metric), score: m('performance_score'), comments: m('comment_rel'), retention: m('retention_rel'), facts: g.facts };
        });
      const filtered = intent.mode === 'comments_not_retention' ? rows.filter((r) => (r.comments ?? 0) >= 1.3 && (r.retention ?? 1) < 0.9) : rows;
      filtered.sort((a, b) => (intent.metric === 'performance_score' ? (b.score ?? 0) - (a.score ?? 0) : (b.value ?? 0) - (a.value ?? 0)));
      return {
        ...base,
        title: intent.mode === 'comments_not_retention' ? 'Guests who generate comments but weak retention' : `Guests by ${METRIC_DEFS[intent.metric].label}`,
        confidence: filtered.some((r) => r.n >= 5) ? 'EARLY_SIGNAL' : 'INSUFFICIENT_DATA',
        tables: [{ title: 'Guests with 2+ scored appearances', columns: ['Guest', 'Appearances', 'Median score', `${METRIC_DEFS[intent.metric === 'performance_score' ? 'share_rel' : intent.metric].label}`, 'Comment ratio', 'Retention ratio'], rows: filtered.slice(0, 15).map((r) => [r.name, r.n, f2(r.score), f2(r.value), f2(r.comments), f2(r.retention)]) }],
        supporting: filtered[0] ? sup(filtered[0].facts) : [],
        notes: ['Guests are identified from caption tags and People records; untagged appearances are not counted.', 'With 2–4 appearances per guest, treat rankings as early signals at best.'],
      };
    }
    case 'topic_gap': {
      const inFrom = facts.filter((f) => f.franchise === intent.from);
      const inTo = new Set(facts.filter((f) => f.franchise === intent.to).flatMap((f) => f.topics.map((t) => t.slug)));
      const rows = [...new Set(inFrom.flatMap((f) => f.topics.map((t) => t.slug)))]
        .filter((slug) => !inTo.has(slug))
        .map((slug) => {
          const tf = inFrom.filter((f) => f.topics.some((t) => t.slug === slug));
          return { slug, n: tf.length, med: median(tf.map((f) => f.score as number)), tf };
        })
        .filter((r) => (r.med ?? 0) >= 1)
        .sort((a, b) => (b.med ?? 0) - (a.med ?? 0));
      return {
        ...base,
        title: `Topics that perform in ${valueLabel(labels, 'franchise', intent.from)} but haven't been used in ${valueLabel(labels, 'franchise', intent.to)}`,
        sampleSize: inFrom.length,
        confidence: rows.some((r) => r.n >= 5) ? 'EARLY_SIGNAL' : 'INSUFFICIENT_DATA',
        tables: [{ title: 'Unused topic transfers', columns: ['Topic', `${valueLabel(labels, 'franchise', intent.from)} posts`, 'Median score'], rows: rows.map((r) => [valueLabel(labels, 'topic', r.slug), r.n, f2(r.med)]) }],
        supporting: rows[0] ? sup(rows[0].tf) : [],
        notes: inFrom.length ? [] : [`No scored posts are classified as ${valueLabel(labels, 'franchise', intent.from)} yet.`],
      };
    }
    case 'make_next': {
      const { items } = latestOpportunities(db);
      return {
        ...base,
        title: 'What BBO should make next',
        confidence: (items[0]?.confidence_label as ConfidenceLabel) ?? 'INSUFFICIENT_DATA',
        tables: [{ title: 'Ranked opportunities', columns: ['Opportunity', 'Why', 'Sample', 'Confidence'], rows: items.slice(0, 8).map((o) => [o.title, o.why, o.sample_size, o.confidence_label]) }],
        supporting: items.flatMap((o) => o.supporting).slice(0, 6).map((s) => ({ ...s, label: null })),
        notes: items.length ? [] : ['No opportunity batch yet — run the opportunities job.'],
      };
    }
    case 'stop_doing': {
      const lessons = all<{ code: string; text: string; confidence_label: string; sample_size: number | null; status: string }>(
        db,
        `SELECT code, text, confidence_label, sample_size, status FROM lessons WHERE direction = 'negative' AND status IN ('SUPPORTED','PROMOTED_TO_RULE','OBSERVING') ORDER BY CASE confidence_label WHEN 'STRONG_SIGNAL' THEN 0 WHEN 'MODERATE_SIGNAL' THEN 1 WHEN 'EARLY_SIGNAL' THEN 2 ELSE 3 END LIMIT 10`
      );
      return { ...base, title: 'What BBO should stop doing', confidence: (lessons[0]?.confidence_label as ConfidenceLabel) ?? 'INSUFFICIENT_DATA', tables: [{ title: 'Negative associations', columns: ['Lesson', 'Finding', 'Status', 'Sample', 'Confidence'], rows: lessons.map((l) => [l.code, l.text, l.status, l.sample_size, l.confidence_label]) }] };
    }
    case 'test_next': {
      const experiments = all<{ code: string; name: string; status: string; hypothesis: string; result_summary: string | null }>(db, `SELECT code, name, status, hypothesis, result_summary FROM experiments WHERE status IN ('proposed','running') ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, id`);
      const early = all<{ code: string; text: string; sample_size: number | null }>(db, `SELECT code, text, sample_size FROM lessons WHERE confidence_label = 'EARLY_SIGNAL' AND status IN ('NEW','OBSERVING') ORDER BY updated_at DESC LIMIT 8`);
      return {
        ...base,
        title: 'What BBO should test next',
        experiments: experiments.map((e) => ({ code: e.code, name: e.name, status: e.status })),
        tables: [
          { title: 'Experiments', columns: ['Code', 'Test', 'Status', 'Hypothesis', 'Result so far'], rows: experiments.map((e) => [e.code, e.name, e.status, e.hypothesis, e.result_summary]) },
          { title: 'Early signals without enough evidence', columns: ['Lesson', 'Finding', 'Sample'], rows: early.map((l) => [l.code, l.text, l.sample_size]) },
        ],
      };
    }
    case 'rules_evidence': {
      const rows = all<{ id: number; code: string; text: string; pattern_json: string | null; supporting: number; contradicting: number; lessons: number }>(
        db,
        `SELECT r.id, r.code, rv.text, r.pattern_json,
                (SELECT COUNT(*) FROM rule_content rc WHERE rc.rule_id = r.id AND rc.relation = 'supporting') AS supporting,
                (SELECT COUNT(*) FROM rule_content rc WHERE rc.rule_id = r.id AND rc.relation = 'contradicting') AS contradicting,
                (SELECT COUNT(*) FROM lessons l WHERE l.related_rule_id = r.id) AS lessons
         FROM rules r JOIN rule_versions rv ON rv.id = r.current_version_id WHERE r.status = 'active' ORDER BY r.code`
      ).map((r) => {
        const p = parsePattern(r.pattern_json);
        const e = p ? evaluatePattern(facts, p) : null;
        return { ...r, e, describe: p ? describePattern(labels, p) : 'principle — not measurable from metrics' };
      });
      rows.sort((a, b) => (b.e ? ['INSUFFICIENT_DATA', 'EARLY_SIGNAL', 'MODERATE_SIGNAL', 'STRONG_SIGNAL'].indexOf(b.e.comparison.confidence) : -1) - (a.e ? ['INSUFFICIENT_DATA', 'EARLY_SIGNAL', 'MODERATE_SIGNAL', 'STRONG_SIGNAL'].indexOf(a.e.comparison.confidence) : -1));
      return {
        ...base,
        title: 'BBO rules ranked by evidence',
        rules: rows.map((r) => ({ code: r.code, text: r.text })),
        tables: [{ title: 'Current evidence for each active rule', columns: ['Rule', 'Text', 'Test', 'Current result', 'Signal', 'Supporting / contradicting posts'], rows: rows.map((r) => [r.code, r.text, r.describe, r.e ? `${r.e.comparison.verdict} ${r.e.comparison.effect?.toFixed(2) ?? '—'}x (${r.e.comparison.nGroup} vs ${r.e.comparison.nRest})` : '—', r.e?.comparison.confidence ?? 'N/A', `${r.supporting} / ${r.contradicting}`]) }],
        notes: ['Most seed rules are editorial principles; only rules with a machine-checkable pattern can be scored against data.'],
      };
    }
    case 'rules_challenged': {
      const challenges = all<{ code: string; summary: string; confidence_label: string | null; status: string; created_at: string }>(db, `SELECT r.code, c.summary, c.confidence_label, c.status, c.created_at FROM rule_challenges c JOIN rules r ON r.id = c.rule_id ORDER BY c.id DESC LIMIT 12`);
      const contradicted = all<{ code: string; text: string; status: string }>(db, `SELECT code, text, status FROM lessons WHERE status IN ('CONTRADICTED','WEAKENED') ORDER BY updated_at DESC LIMIT 10`);
      return {
        ...base,
        title: 'Rules being challenged by newer data',
        tables: [
          { title: 'Rule challenges', columns: ['Rule', 'Challenge', 'Signal', 'Status', 'Opened'], rows: challenges.map((c) => [c.code, c.summary, c.confidence_label, c.status, c.created_at.slice(0, 10)]) },
          { title: 'Weakened or contradicted lessons', columns: ['Lesson', 'Finding', 'Status'], rows: contradicted.map((l) => [l.code, l.text, l.status]) },
        ],
      };
    }
    case 'belief_changes': {
      const since = new Date(Date.now() - intent.days * 86_400_000).toISOString();
      const changes = beliefChanges(db, since);
      return {
        ...base,
        title: `What BBO believed in the last ${intent.days} days that it no longer believes`,
        tables: [
          { title: 'Lessons that weakened, were contradicted or archived', columns: ['Lesson', 'Belief', 'From', 'To', 'When', 'Why'], rows: changes.lessons.map((l) => [l.code, l.text, l.from_status, l.to_status, l.occurred_at.slice(0, 10), l.note]) },
          { title: 'Rule versions retired', columns: ['Rule', 'Old text', 'Replaced by', 'When'], rows: changes.rules.map((r) => [`${r.code} v${r.version}`, r.text, r.new_text ?? 'deactivated', r.deactivated_at.slice(0, 10)]) },
        ],
        sampleSize: changes.lessons.length + changes.rules.length,
      };
    }
    case 'why_content': {
      const hits = search(db, intent.query, { types: ['content'], limit: 5 });
      const match = hits[0] ? loadFacts(db, { contentIds: [Number(hits[0].entityId)] })[0] : undefined;
      if (!match) return { ...base, title: `No post matched "${intent.query}"`, notes: ['Try words from the caption, or open the post from the Content Library.'] };
      const analysis = get<{ outcome_explanation: string | null; actual_topic: string | null; hook_mechanics: string | null; share_trigger: string | null; comment_trigger: string | null; reusable_lesson: string | null; confidence: string | null; evidence_basis: string }>(
        db,
        'SELECT outcome_explanation, actual_topic, hook_mechanics, share_trigger, comment_trigger, reusable_lesson, confidence, evidence_basis FROM content_analyses WHERE content_id = ? ORDER BY id DESC LIMIT 1',
        match.contentId
      );
      return {
        ...base,
        title: `Why "${match.title}" performed the way it did`,
        sampleSize: 1,
        dateRange: { from: match.publishedAt.slice(0, 10), to: match.publishedAt.slice(0, 10) },
        confidence: analysis ? 'EARLY_SIGNAL' : 'INSUFFICIENT_DATA',
        supporting: [{ contentId: match.contentId, title: match.title, score: match.score, label: match.label }],
        tables: [
          { title: 'Performance vs peers', columns: ['Component', 'Value', 'Peer median', 'Ratio'], rows: match.components.map((c) => [c.key, f2(c.value), f2(c.peerMedian), `${c.ratio.toFixed(2)}x`]) },
          ...(analysis ? [{ title: `Stored AI analysis (${analysis.evidence_basis}, ${analysis.confidence} confidence)`, columns: ['Field', 'Finding'], rows: Object.entries(analysis).filter(([k]) => !['confidence', 'evidence_basis'].includes(k)).map(([k, v]) => [k.replace(/_/g, ' '), v as string]) }] : []),
        ],
        notes: analysis ? [] : ['This post has no AI analysis yet. Open it and run analysis once its transcript/frames are ingested.'],
      };
    }
    case 'learned': {
      const since = intent.days ? new Date(Date.now() - intent.days * 86_400_000).toISOString() : null;
      const lessons = all<{ code: string; text: string; status: string; confidence_label: string; sample_size: number | null; updated_at: string; origin: string }>(
        db,
        `SELECT code, text, status, confidence_label, sample_size, updated_at, origin FROM lessons
         WHERE status IN ('SUPPORTED','PROMOTED_TO_RULE','OBSERVING','NEW') ${since ? 'AND (updated_at >= ? OR first_seen_at >= ?)' : ''}
         ORDER BY CASE confidence_label WHEN 'STRONG_SIGNAL' THEN 0 WHEN 'MODERATE_SIGNAL' THEN 1 WHEN 'EARLY_SIGNAL' THEN 2 ELSE 3 END, updated_at DESC LIMIT 15`,
        ...(since ? [since, since] : [])
      );
      const events = since ? all<{ code: string; to_status: string; note: string | null; occurred_at: string }>(db, `SELECT l.code, e.to_status, e.note, e.occurred_at FROM lesson_events e JOIN lessons l ON l.id = e.lesson_id WHERE e.occurred_at >= ? ORDER BY e.occurred_at DESC LIMIT 20`, since) : [];
      return {
        ...base,
        title: intent.days ? `What BBO learned in the last ${intent.days} days` : 'What BBO has learned',
        confidence: (lessons[0]?.confidence_label as ConfidenceLabel) ?? 'INSUFFICIENT_DATA',
        sampleSize: lessons.length,
        tables: [
          { title: 'Lessons (strongest evidence first)', columns: ['Lesson', 'Finding', 'Status', 'Confidence', 'Sample', 'Origin'], rows: lessons.map((l) => [l.code, l.text, l.status, l.confidence_label, l.sample_size, l.origin.replace(/_/g, ' ')]) },
          ...(events.length ? [{ title: 'Belief changes in the window', columns: ['Lesson', 'Now', 'Why', 'When'], rows: events.map((e) => [e.code, e.to_status, e.note, e.occurred_at.slice(0, 10)]) }] : []),
        ],
      };
    }
    case 'search': {
      const hits = search(db, intent.query, { limit: 15 });
      return { ...base, title: `Records matching "${intent.query}"`, sampleSize: hits.length, confidence: 'N/A', tables: [{ title: 'Search results', columns: ['Type', 'Title', 'Match'], rows: hits.map((h) => [h.entityType, h.title, h.snippet]) }], notes: ['This question did not map to an analysis, so these are matching records rather than a calculated answer.'] };
    }
  }
}

const ExplainSchema = z.object({ answer: looseText(), caveats: looseList().default([]) });

const EXPLAIN_TEMPLATE = `You answer King Maker's question about BBO content using ONLY the evidence JSON the system calculated.
- Lead with the direct answer in 2–4 sentences, then the specifics. Plain, sharp, no fluff.
- Quote numbers, sample sizes and date ranges exactly as given. Never invent or round in a misleading way.
- Use "associated with", never "caused", unless the evidence is a completed experiment.
- If the evidence is thin or empty, say that clearly and say what data would answer it.
Return JSON {answer, caveats[]}.`;

export type AskResult = { question: string; intent: Intent; routedBy: 'rules' | 'ai' | 'fallback'; evidence: Evidence; answer: string; caveats: string[]; answeredBy: 'ai' | 'deterministic'; runId: number | null };

export function deterministicAnswer(e: Evidence): string {
  const t = e.tables[0];
  if (!t || !t.rows.length) return `${e.title}: no records in BBO BRAIN answer this yet.${e.notes.length ? ` ${e.notes.join(' ')}` : ''}`;
  const top = t.rows.slice(0, 3).map((r) => r.filter((c) => c !== null && c !== '').join(' · ')).join('\n• ');
  return `${e.title} (${e.sampleSize} records${e.dateRange ? `, ${e.dateRange.from} → ${e.dateRange.to}` : ''}; signal: ${e.confidence}).\n• ${top}`;
}

export async function askBbo(db: Db, question: string): Promise<AskResult> {
  let routedBy: AskResult['routedBy'] = 'rules';
  let intent = routeQuestion(db, question);
  if (!intent) {
    intent = await classifyWithAi(db, question);
    routedBy = intent ? 'ai' : 'fallback';
  }
  if (!intent) intent = { kind: 'search', query: question };
  const evidence = buildEvidence(db, intent);

  if (!aiConfigured()) {
    return { question, intent, routedBy, evidence, answer: deterministicAnswer(evidence), caveats: evidence.notes, answeredBy: 'deterministic', runId: null };
  }
  try {
    const r = await runAi({
      db,
      workflow: 'ask',
      promptSlug: 'ask-explain',
      template: EXPLAIN_TEMPLATE,
      schemaVersion: 'ask-explain-v1',
      system: EXPLAIN_TEMPLATE,
      prompt: `QUESTION: ${question}\n\nEVIDENCE JSON:\n${JSON.stringify({ ...evidence, tables: evidence.tables.map((t) => ({ ...t, rows: t.rows.slice(0, 25) })) })}`,
      schema: ExplainSchema,
      input: { question, intent, tableRows: evidence.tables.map((t) => t.rows.length), supporting: evidence.supporting.map((s) => s.contentId) },
      temperature: 0.2,
      maxOutputTokens: 1500,
      thinkingBudget: 0,
    });
    return { question, intent, routedBy, evidence, answer: r.data.answer, caveats: [...evidence.notes, ...r.data.caveats], answeredBy: 'ai', runId: r.runId };
  } catch {
    return { question, intent, routedBy, evidence, answer: deterministicAnswer(evidence), caveats: [...evidence.notes, 'AI explanation unavailable — showing the calculated evidence directly.'], answeredBy: 'deterministic', runId: null };
  }
}

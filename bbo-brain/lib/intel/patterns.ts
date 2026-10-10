import { BUCKET_DEFINITIONS } from '@/lib/seed/reference';
import { all, type Db } from '@/lib/db/client';
import { compareGroups, type GroupComparison, type Observation } from './stats';
import { METRIC_DEFS, metricValue, type ContentFact, type MetricKey } from './dataset';

/**
 * A pattern is a machine-checkable claim: "content where <key> = <group>
 * (optionally within a franchise) differs on <metric> from <compare | the rest>".
 * Lessons, rules, challenges and experiments all evaluate through here.
 */
const BUCKET_LABEL: Record<string, string> = Object.fromEntries(Object.entries(BUCKET_DEFINITIONS).map(([k, v]) => [k, v.label.toLowerCase()]));

export type Pattern = {
  key: string; // attribute key, or 'topic' / 'person'
  group: string;
  compare?: string;
  metric: MetricKey;
  franchise?: string;
  /** Content bucket the comparison runs inside. Buckets are never mixed in one comparison. */
  bucket?: string;
};

export function canonicalPattern(p: Pattern): string {
  const base = { key: p.key, group: p.group, compare: p.compare ?? null, metric: p.metric, franchise: p.franchise ?? null };
  // Unscoped patterns keep their original identity, so existing lessons still match.
  return JSON.stringify(p.bucket ? { ...base, bucket: p.bucket } : base);
}

export function parsePattern(raw: string | null | undefined): Pattern | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (typeof p.key !== 'string' || typeof p.group !== 'string' || typeof p.metric !== 'string') return null;
    if (!(p.metric in METRIC_DEFS)) return null;
    return {
      key: p.key,
      group: p.group,
      compare: typeof p.compare === 'string' ? p.compare : undefined,
      metric: p.metric as MetricKey,
      franchise: typeof p.franchise === 'string' ? p.franchise : undefined,
      bucket: typeof p.bucket === 'string' ? p.bucket : undefined,
    };
  } catch {
    return null;
  }
}

/** Value(s) of a pattern key on a fact. Undefined = unknown (excluded from the comparison). */
export function valuesFor(fact: ContentFact, key: string): string[] | undefined {
  if (key === 'topic') return fact.topics.map((t) => t.slug);
  if (key === 'person') return fact.people.filter((p) => p.role === 'guest').map((p) => String(p.id));
  if (key === 'franchise') return fact.franchise ? [fact.franchise] : undefined;
  const v = fact.attrs[key];
  return v === undefined ? undefined : [v];
}

export type PatternEvaluation = {
  pattern: Pattern;
  comparison: GroupComparison;
  groupFacts: ContentFact[];
  restFacts: ContentFact[];
  dateRange: { from: string; to: string } | null;
};

export function evaluatePattern(facts: ContentFact[], pattern: Pattern, options: { asOf?: string } = {}): PatternEvaluation {
  const scoped = pattern.bucket ? facts.filter((f) => f.attrs.content_bucket === pattern.bucket) : facts;
  const pool = pattern.franchise ? scoped.filter((f) => f.franchise === pattern.franchise) : scoped;
  const multi = pattern.key === 'topic' || pattern.key === 'person';
  const groupFacts: ContentFact[] = [];
  const restFacts: ContentFact[] = [];
  for (const fact of pool) {
    const values = valuesFor(fact, pattern.key);
    if (values === undefined) continue;
    const inGroup = values.includes(pattern.group);
    if (inGroup) groupFacts.push(fact);
    else if (pattern.compare ? values.includes(pattern.compare) : multi || values.length > 0) restFacts.push(fact);
  }
  const toObs = (list: ContentFact[]): Observation[] =>
    list.flatMap((f) => {
      const value = metricValue(f, pattern.metric);
      return value === null ? [] : [{ value, at: f.publishedAt, contentId: f.contentId }];
    });
  const comparison = compareGroups(toObs(groupFacts), toObs(restFacts), options);
  const dates = [...groupFacts, ...restFacts].map((f) => f.publishedAt).sort();
  return { pattern, comparison, groupFacts, restFacts, dateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null };
}

export type Labels = { attr: Map<string, string>; topics: Map<string, string>; people: Map<string, string>; franchises: Map<string, string> };

export function loadLabels(db: Db): Labels {
  return {
    attr: new Map(all<{ key: string; label: string }>(db, 'SELECT key, label FROM attribute_definitions').map((a) => [a.key, a.label])),
    topics: new Map(all<{ slug: string; name: string }>(db, 'SELECT slug, name FROM topics').map((t) => [t.slug, t.name])),
    people: new Map(all<{ id: number; canonical_name: string }>(db, 'SELECT id, canonical_name FROM people').map((p) => [String(p.id), p.canonical_name])),
    franchises: new Map(all<{ slug: string; name: string }>(db, 'SELECT slug, name FROM franchises').map((f) => [f.slug, f.name])),
  };
}

export function valueLabel(labels: Labels, key: string, value: string): string {
  if (key === 'topic') return labels.topics.get(value) ?? value;
  if (key === 'person') return labels.people.get(value) ?? value;
  if (key === 'franchise') return labels.franchises.get(value) ?? value;
  if (value === 'true') return 'yes';
  if (value === 'false') return 'no';
  return value.replace(/_/g, ' ');
}

export function describePattern(labels: Labels, p: Pattern): string {
  const subject =
    p.key === 'topic'
      ? `content about ${valueLabel(labels, p.key, p.group)}`
      : p.key === 'person'
        ? `content featuring ${valueLabel(labels, p.key, p.group)}`
        : `${labels.attr.get(p.key) ?? p.key}: ${valueLabel(labels, p.key, p.group)}`;
  const against = p.compare ? `vs ${valueLabel(labels, p.key, p.compare)}` : 'vs everything else';
  const scope = `${p.bucket ? ` within ${BUCKET_LABEL[p.bucket] ?? p.bucket}` : ''}${p.franchise ? ` within ${valueLabel(labels, 'franchise', p.franchise)}` : ''}`;
  return `${subject} ${against}${scope} — ${METRIC_DEFS[p.metric].label}`;
}

/** Correlational sentence for a lesson, with sample sizes and dates baked in. */
export function lessonSentence(labels: Labels, e: PatternEvaluation): string {
  const c = e.comparison;
  const p = e.pattern;
  const x = c.effect ?? 1;
  const subject =
    p.key === 'topic'
      ? `Content about ${valueLabel(labels, p.key, p.group)}`
      : p.key === 'person'
        ? `Content featuring ${valueLabel(labels, p.key, p.group)}`
        : `Posts with ${(labels.attr.get(p.key) ?? p.key).toLowerCase()} = ${valueLabel(labels, p.key, p.group)}`;
  const against = p.compare ? `posts with ${valueLabel(labels, p.key, p.compare)}` : 'other posts';
  const scope = `${p.bucket ? ` in ${BUCKET_LABEL[p.bucket] ?? p.bucket}` : ''}${p.franchise ? ` in ${valueLabel(labels, 'franchise', p.franchise)}` : ''}`;
  const range = e.dateRange ? ` (${e.dateRange.from.slice(0, 10)} → ${e.dateRange.to.slice(0, 10)})` : '';
  const metric = METRIC_DEFS[p.metric].label;
  if (c.verdict === 'no_difference') {
    return `${subject}${scope} show no meaningful difference in ${metric} from ${against}: ${x.toFixed(2)}x across ${c.nGroup} vs ${c.nRest} posts${range}.`;
  }
  const dir = c.verdict === 'positive' ? 'stronger' : 'weaker';
  return `${subject}${scope} are associated with ${dir} ${metric} than ${against}: ${x.toFixed(2)}x the median across ${c.nGroup} vs ${c.nRest} posts${range}.`;
}

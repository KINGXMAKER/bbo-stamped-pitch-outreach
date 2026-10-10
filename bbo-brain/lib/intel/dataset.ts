import { all, parseJson, type Db } from '@/lib/db/client';
import { activeScoreVersion } from '@/lib/scoring/engine';
import { deriveComponents, type ComponentResult } from '@/lib/scoring/formula';

/**
 * The evidence table. Every intelligence module — mining, reviews, opportunities,
 * Ask BBO, the library — reads ContentFacts built here from stored records, so
 * every number the product shows traces back to a metric snapshot row.
 */

export type MetricKey =
  | 'performance_score'
  | 'reach'
  | 'views'
  | 'share_rate'
  | 'comment_rate'
  | 'save_rate'
  | 'like_rate'
  | 'deep_action_rate'
  | 'retention'
  | 'hold_3s'
  | 'shares'
  | 'comments'
  | 'saves'
  // Era-normalised: each post's rate ÷ its peer-group median (1.0 = typical for its time).
  | 'share_rel'
  | 'comment_rel'
  | 'save_rel'
  | 'retention_rel'
  | 'hold_rel'
  | 'reach_rel'
  | 'deep_action_rel';

const REL_FROM_COMPONENT: Record<string, MetricKey> = {
  share_rate: 'share_rel',
  comment_rate: 'comment_rel',
  save_rate: 'save_rel',
  retention: 'retention_rel',
  hold_3s: 'hold_rel',
  reach: 'reach_rel',
  deep_action_rate: 'deep_action_rel',
};

export type ContentFact = {
  contentId: number;
  postId: number;
  title: string;
  platform: string;
  format: string | null;
  publishedAt: string;
  url: string | null;
  caption: string;
  franchise: string | null;
  franchiseName: string | null;
  durationS: number | null;
  isDemo: boolean;
  isMature: boolean;
  score: number | null;
  label: string | null;
  percentile: number | null;
  baselineGroup: string | null;
  components: ComponentResult[];
  raw: Record<string, number>;
  rates: Partial<Record<MetricKey, number>>;
  attrs: Record<string, string>;
  attrSources: Record<string, string>;
  topics: Array<{ id: number; slug: string; name: string; isPrimary: boolean }>;
  people: Array<{ id: number; name: string; role: string; gender: string | null }>;
  thumbPath: string | null;
  hasTranscript: boolean;
};

export const METRIC_DEFS: Record<MetricKey, { label: string; kind: 'score' | 'rate' | 'count' | 'ratio' }> = {
  performance_score: { label: 'performance score', kind: 'score' },
  reach: { label: 'reach', kind: 'count' },
  views: { label: 'views', kind: 'count' },
  share_rate: { label: 'share rate', kind: 'rate' },
  comment_rate: { label: 'comment rate', kind: 'rate' },
  save_rate: { label: 'save rate', kind: 'rate' },
  like_rate: { label: 'like rate', kind: 'rate' },
  deep_action_rate: { label: 'deep action rate', kind: 'rate' },
  retention: { label: 'retention', kind: 'ratio' },
  hold_3s: { label: '3-second hold', kind: 'rate' },
  shares: { label: 'shares', kind: 'count' },
  comments: { label: 'comments', kind: 'count' },
  saves: { label: 'saves', kind: 'count' },
  share_rel: { label: 'share rate vs peers', kind: 'ratio' },
  comment_rel: { label: 'comment rate vs peers', kind: 'ratio' },
  save_rel: { label: 'save rate vs peers', kind: 'ratio' },
  retention_rel: { label: 'retention vs peers', kind: 'ratio' },
  hold_rel: { label: '3-second hold vs peers', kind: 'ratio' },
  reach_rel: { label: 'reach vs peers', kind: 'ratio' },
  deep_action_rel: { label: 'deep action rate vs peers', kind: 'ratio' },
};

export function metricValue(fact: ContentFact, metric: MetricKey): number | null {
  const v = fact.rates[metric];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export type FactFilter = {
  contentIds?: number[];
  since?: string;
  until?: string;
  platform?: string;
  includeDemo?: boolean;
};

export function loadFacts(db: Db, filter: FactFilter = {}): ContentFact[] {
  const version = activeScoreVersion(db);
  const where: string[] = [`c.status = 'published'`, 'pp.published_at IS NOT NULL'];
  const params: unknown[] = [version.id];
  if (!filter.includeDemo) where.push('c.is_demo = 0');
  if (filter.since) {
    where.push('pp.published_at >= ?');
    params.push(filter.since);
  }
  if (filter.until) {
    where.push('pp.published_at < ?');
    params.push(filter.until);
  }
  if (filter.platform) {
    where.push('pp.platform_id = ?');
    params.push(filter.platform);
  }
  if (filter.contentIds?.length) where.push(`c.id IN (${filter.contentIds.map(Number).join(',')})`);

  const rows = all<{
    content_id: number;
    post_id: number;
    title: string;
    platform_id: string;
    format: string | null;
    published_at: string;
    source_url: string | null;
    caption: string | null;
    franchise_slug: string | null;
    franchise_name: string | null;
    duration_s: number | null;
    is_demo: number;
    thumb_path: string | null;
    score: number | null;
    label: string | null;
    percentile: number | null;
    baseline_group: string | null;
    components_json: string | null;
    is_mature: number | null;
    has_transcript: number;
  }>(
    db,
    `SELECT c.id AS content_id, pp.id AS post_id, c.title, pp.platform_id, c.format, pp.published_at, pp.source_url, pp.caption,
            f.slug AS franchise_slug, f.name AS franchise_name, c.duration_s, c.is_demo, c.thumb_path,
            ps.score, ps.label, ps.percentile, ps.baseline_group, ps.components_json, ps.is_mature,
            EXISTS (SELECT 1 FROM transcripts t WHERE t.content_id = c.id) AS has_transcript
     FROM content c
     JOIN platform_posts pp ON pp.id = c.primary_post_id
     LEFT JOIN franchises f ON f.id = c.franchise_id
     LEFT JOIN performance_scores ps ON ps.platform_post_id = pp.id AND ps.score_version_id = ?
     WHERE ${where.join(' AND ')}
     ORDER BY pp.published_at DESC`,
    ...params
  );
  if (!rows.length) return [];

  const ids = rows.map((r) => r.content_id).join(',');
  const postIds = rows.map((r) => r.post_id).join(',');

  const metrics = new Map<number, Record<string, number>>();
  for (const m of all<{ platform_post_id: number; metric: string; value: number }>(
    db,
    `SELECT platform_post_id, metric, value FROM content_metric_latest WHERE platform_post_id IN (${postIds})`
  )) {
    const entry = metrics.get(m.platform_post_id) ?? {};
    entry[m.metric] = m.value;
    metrics.set(m.platform_post_id, entry);
  }

  const attrs = new Map<number, { values: Record<string, string>; sources: Record<string, string> }>();
  for (const a of all<{ content_id: number; key: string; value_text: string; source: string }>(
    db,
    `SELECT content_id, key, value_text, source FROM content_attribute_current WHERE content_id IN (${ids})`
  )) {
    const entry = attrs.get(a.content_id) ?? { values: {}, sources: {} };
    entry.values[a.key] = a.value_text;
    entry.sources[a.key] = a.source;
    attrs.set(a.content_id, entry);
  }

  const topics = new Map<number, ContentFact['topics']>();
  for (const t of all<{ content_id: number; id: number; slug: string; name: string; is_primary: number }>(
    db,
    `SELECT ct.content_id, t.id, t.slug, t.name, ct.is_primary FROM content_topics ct JOIN topics t ON t.id = ct.topic_id WHERE ct.content_id IN (${ids})`
  )) {
    topics.set(t.content_id, [...(topics.get(t.content_id) ?? []), { id: t.id, slug: t.slug, name: t.name, isPrimary: t.is_primary === 1 }]);
  }

  const people = new Map<number, ContentFact['people']>();
  for (const p of all<{ content_id: number; id: number; canonical_name: string; role: string; gender: string | null }>(
    db,
    `SELECT cp.content_id, p.id, p.canonical_name, cp.role, p.gender FROM content_people cp JOIN people p ON p.id = cp.person_id WHERE cp.content_id IN (${ids})`
  )) {
    people.set(p.content_id, [...(people.get(p.content_id) ?? []), { id: p.id, name: p.canonical_name, role: p.role, gender: p.gender }]);
  }

  return rows.map((r) => {
    const raw = metrics.get(r.post_id) ?? {};
    const derived = deriveComponents(
      { reach: raw.reach, likes: raw.likes, comments: raw.comments, saves: raw.saves, shares: raw.shares, avg_watch_time_ms: raw.avg_watch_time_ms, skip_rate: raw.skip_rate, follows: raw.follows },
      r.duration_s
    );
    const components = parseJson<ComponentResult[]>(r.components_json, []);
    const rates: Partial<Record<MetricKey, number>> = {
      share_rate: derived.share_rate,
      comment_rate: derived.comment_rate,
      save_rate: derived.save_rate,
      like_rate: derived.like_rate,
      retention: derived.retention,
      hold_3s: derived.hold_3s,
      reach: raw.reach,
      views: raw.views,
      shares: raw.shares,
      comments: raw.comments,
      saves: raw.saves,
    };
    if (raw.reach > 0 && [raw.shares, raw.saves, raw.comments].every((v) => typeof v === 'number')) {
      rates.deep_action_rate = (raw.shares + raw.saves + raw.comments) / raw.reach;
    }
    if (typeof r.score === 'number') rates.performance_score = r.score;
    for (const c of components) {
      const rel = REL_FROM_COMPONENT[c.key];
      if (rel && Number.isFinite(c.ratio)) rates[rel] = c.ratio;
    }
    const a = attrs.get(r.content_id);
    return {
      contentId: r.content_id,
      postId: r.post_id,
      title: r.title,
      platform: r.platform_id,
      format: r.format,
      publishedAt: r.published_at,
      url: r.source_url,
      caption: r.caption ?? '',
      franchise: r.franchise_slug,
      franchiseName: r.franchise_name,
      durationS: r.duration_s,
      isDemo: r.is_demo === 1,
      isMature: r.is_mature === 1,
      score: r.score,
      label: r.label,
      percentile: r.percentile,
      baselineGroup: r.baseline_group,
      components,
      raw,
      rates,
      attrs: a?.values ?? {},
      attrSources: a?.sources ?? {},
      topics: topics.get(r.content_id) ?? [],
      people: people.get(r.content_id) ?? [],
      thumbPath: r.thumb_path,
      hasTranscript: r.has_transcript === 1,
    };
  });
}

/** Mature, scored facts only — the population every comparison is allowed to use. */
export function comparable(facts: ContentFact[]): ContentFact[] {
  return facts.filter((f) => f.isMature && f.score !== null);
}

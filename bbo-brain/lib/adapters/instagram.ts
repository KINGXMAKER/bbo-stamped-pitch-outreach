import type { ComposioProxy } from './composio';
import {
  SourceError,
  type AccountMetricPoint,
  type AnalyticsSourceAdapter,
  type CanonicalMetric,
  type ContentSourceAdapter,
  type PostMetricsResult,
  type SourceComment,
  type SourcePost,
} from './types';

const MEDIA_FIELDS =
  'id,caption,media_type,media_product_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count';

/** Verified live 2026-09-15: every one of these returns for Reels. */
const REEL_METRICS = [
  'reach',
  'views',
  'likes',
  'comments',
  'saved',
  'shares',
  'total_interactions',
  'ig_reels_avg_watch_time',
  'ig_reels_video_view_total_time',
  'reels_skip_rate',
];
/** Feed posts additionally expose follows / profile visits (Reels reject them). */
const FEED_METRICS = ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'profile_visits', 'follows'];

const METRIC_MAP: Record<string, CanonicalMetric> = {
  reach: 'reach',
  views: 'views',
  likes: 'likes',
  comments: 'comments',
  saved: 'saves',
  shares: 'shares',
  total_interactions: 'total_interactions',
  ig_reels_avg_watch_time: 'avg_watch_time_ms',
  ig_reels_video_view_total_time: 'total_watch_time_ms',
  reels_skip_rate: 'skip_rate',
  profile_visits: 'profile_visits',
  follows: 'follows',
};

type GraphMedia = {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  media_url?: string;
  permalink?: string;
  thumbnail_url?: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
};

type GraphInsights = {
  data?: Array<{ name: string; values?: Array<{ value?: number }>; total_value?: { value?: number } }>;
};

/** Graph timestamps are "+0000"; normalise to ISO-8601 with Z. */
export function graphTimeToIso(ts: string): string {
  return new Date(ts.replace(/\+0000$/, 'Z')).toISOString();
}

export function toSourcePost(m: GraphMedia): SourcePost {
  return {
    platform: 'instagram',
    externalId: m.id,
    url: m.permalink ?? null,
    mediaType: m.media_type ?? null,
    mediaProductType: m.media_product_type ?? null,
    caption: m.caption ?? '',
    thumbnailUrl: m.thumbnail_url ?? (m.media_type === 'IMAGE' ? m.media_url ?? null : null),
    mediaUrl: m.media_url ?? null,
    publishedAt: graphTimeToIso(m.timestamp),
    raw: { ...m, media_url: undefined, thumbnail_url: undefined }, // CDN URLs expire; don't archive them
  };
}

export function parseInsights(body: GraphInsights): Partial<Record<CanonicalMetric, number>> {
  const out: Partial<Record<CanonicalMetric, number>> = {};
  for (const item of body.data ?? []) {
    const canonical = METRIC_MAP[item.name];
    const value = item.values?.[0]?.value ?? item.total_value?.value;
    if (canonical && typeof value === 'number' && Number.isFinite(value)) out[canonical] = value;
  }
  return out;
}

export class InstagramComposioAdapter implements ContentSourceAdapter, AnalyticsSourceAdapter {
  readonly id = 'composio_instagram';
  readonly platform = 'instagram';
  /** Metrics Instagram rejected for a media product type, remembered for the run. */
  private readonly unsupported = new Map<string, Set<string>>();

  constructor(
    private readonly proxy: ComposioProxy,
    private readonly igUserId: string
  ) {}

  get apiCalls(): number {
    return this.proxy.calls;
  }

  async profile(): Promise<{ username: string; followersCount: number | null; mediaCount: number | null }> {
    const body = await this.proxy.get<{ username?: string; followers_count?: number; media_count?: number }>(
      `/${this.igUserId}?fields=username,followers_count,media_count`
    );
    return { username: body.username ?? 'unknown', followersCount: body.followers_count ?? null, mediaCount: body.media_count ?? null };
  }

  /** Media URLs expire within hours, so downloads always ask for a fresh one. */
  async proxyMedia(externalId: string): Promise<{ mediaUrl: string | null; mediaType: string | null }> {
    const body = await this.proxy.get<{ media_url?: string; media_type?: string; children?: { data?: Array<{ media_url?: string; media_type?: string }> } }>(
      `/${externalId}?fields=media_url,media_type,children{media_url,media_type}`
    );
    if (body.media_url) return { mediaUrl: body.media_url, mediaType: body.media_type ?? null };
    const first = body.children?.data?.[0];
    return { mediaUrl: first?.media_url ?? null, mediaType: first?.media_type ?? body.media_type ?? null };
  }

  async listPosts({ since, maxPages = 20 }: { since?: string; maxPages?: number }): Promise<SourcePost[]> {
    const posts: SourcePost[] = [];
    let after: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const endpoint = `/${this.igUserId}/media?fields=${MEDIA_FIELDS}&limit=100${after ? `&after=${after}` : ''}`;
      const body = await this.proxy.get<{ data?: GraphMedia[]; paging?: { cursors?: { after?: string }; next?: string } }>(endpoint);
      const batch = (body.data ?? []).map(toSourcePost);
      posts.push(...batch);
      const oldest = batch[batch.length - 1]?.publishedAt;
      if (since && oldest && oldest < since) break;
      if (!body.paging?.next || !body.paging.cursors?.after) break;
      after = body.paging.cursors.after;
    }
    return since ? posts.filter((p) => p.publishedAt >= since) : posts;
  }

  async postMetrics(post: Pick<SourcePost, 'externalId' | 'mediaProductType'>): Promise<PostMetricsResult> {
    const type = (post.mediaProductType ?? 'FEED').toUpperCase();
    const known = this.unsupported.get(type) ?? new Set<string>();
    this.unsupported.set(type, known);
    const wanted = (type === 'REELS' ? REEL_METRICS : FEED_METRICS).filter((m) => !known.has(m));
    const observedAt = new Date().toISOString();
    const unavailable: Array<{ metric: string; reason: string }> = [...known].map((metric) => ({ metric, reason: `not supported for ${type}` }));

    try {
      const body = await this.proxy.get<GraphInsights>(`/${post.externalId}/insights?metric=${wanted.join(',')}`);
      return { metrics: parseInsights(body), unavailable, observedAt };
    } catch (err) {
      if (!(err instanceof SourceError) || err.kind !== 'unsupported') throw err;
    }

    // One metric in the batch was rejected — fall back to one call per metric so
    // a single unsupported metric never blanks the ones that do exist.
    const metrics: Partial<Record<CanonicalMetric, number>> = {};
    for (const metric of wanted) {
      try {
        Object.assign(metrics, parseInsights(await this.proxy.get<GraphInsights>(`/${post.externalId}/insights?metric=${metric}`)));
      } catch (err) {
        if (err instanceof SourceError && err.kind === 'unsupported') {
          unavailable.push({ metric, reason: err.message });
          // Only remember as type-wide unsupported when Meta says so for the product type.
          if (/media product type/i.test(err.message) === false) continue;
          known.add(metric);
        } else {
          throw err;
        }
      }
    }
    return { metrics, unavailable, observedAt };
  }

  async comments(externalId: string, limit: number): Promise<SourceComment[]> {
    const body = await this.proxy.get<{ data?: Array<{ id: string; text?: string; like_count?: number; timestamp?: string }> }>(
      `/${externalId}/comments?fields=id,text,like_count,timestamp&limit=${Math.min(limit, 50)}`
    );
    return (body.data ?? []).map((c) => ({
      externalId: c.id,
      text: c.text ?? null,
      likeCount: typeof c.like_count === 'number' ? c.like_count : null,
      commentedAt: c.timestamp ? graphTimeToIso(c.timestamp) : null,
    }));
  }

  async accountMetrics(sinceIso: string, untilIso: string): Promise<{ points: AccountMetricPoint[]; unavailable: string[] }> {
    const points: AccountMetricPoint[] = [];
    const unavailable: string[] = [];
    // Graph API day-period insights cover at most ~30 days per request.
    const floor = Date.now() - 29 * 86_400_000;
    const since = Math.floor(Math.max(new Date(sinceIso).getTime(), floor) / 1000);
    const until = Math.floor(new Date(untilIso).getTime() / 1000);

    const attempt = async (metric: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (err) {
        if (err instanceof SourceError && err.kind !== 'transient') unavailable.push(`${metric}: ${err.message}`);
        else throw err;
      }
    };

    await attempt('follower_count', async () => {
      const body = await this.proxy.get<{ data?: Array<{ values?: Array<{ value?: number; end_time?: string }> }> }>(
        `/${this.igUserId}/insights?metric=follower_count&period=day&since=${since}&until=${until}`
      );
      for (const v of body.data?.[0]?.values ?? []) {
        if (!v.end_time) continue;
        const end = graphTimeToIso(v.end_time);
        points.push({ metric: 'net_follower_change', value: v.value ?? null, periodStart: new Date(new Date(end).getTime() - 86_400_000).toISOString(), periodEnd: end });
      }
    });

    for (const metric of ['reach', 'views', 'profile_views', 'website_clicks', 'accounts_engaged', 'total_interactions']) {
      await attempt(metric, async () => {
        const body = await this.proxy.get<{ data?: Array<{ total_value?: { value?: number } }> }>(
          `/${this.igUserId}/insights?metric=${metric}&period=day&metric_type=total_value&since=${since}&until=${until}`
        );
        const value = body.data?.[0]?.total_value?.value;
        points.push({ metric: `account_${metric}`, value: typeof value === 'number' ? value : null, periodStart: new Date(since * 1000).toISOString(), periodEnd: new Date(until * 1000).toISOString() });
      });
    }

    await attempt('profile', async () => {
      const body = await this.proxy.get<{ followers_count?: number; media_count?: number }>(`/${this.igUserId}?fields=followers_count,media_count`);
      const at = new Date().toISOString();
      if (typeof body.followers_count === 'number') points.push({ metric: 'followers_count', value: body.followers_count, periodStart: null, periodEnd: at });
      if (typeof body.media_count === 'number') points.push({ metric: 'media_count', value: body.media_count, periodStart: null, periodEnd: at });
    });

    for (const breakdown of ['gender', 'age', 'city', 'country']) {
      await attempt(`follower_demographics.${breakdown}`, async () => {
        const body = await this.proxy.get<{
          data?: Array<{ total_value?: { breakdowns?: Array<{ results?: Array<{ dimension_values: string[]; value: number }> }> } }>;
        }>(`/${this.igUserId}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=${breakdown}`);
        const results = body.data?.[0]?.total_value?.breakdowns?.[0]?.results;
        if (!results?.length) {
          unavailable.push(`follower_demographics.${breakdown}: empty results`);
          return;
        }
        points.push({
          metric: `follower_demographics_${breakdown}`,
          value: null,
          periodStart: null,
          periodEnd: new Date().toISOString(),
          breakdown: Object.fromEntries(results.map((r) => [r.dimension_values[0], r.value])),
        });
      });
    }

    return { points, unavailable };
  }
}

import { all, type Db } from '@/lib/db/client';
import type { ContentFact } from './dataset';

const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
export function weekOf(iso: string): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0, 10);
}
export function previousWeek(iso: string): string {
  const d = new Date(`${weekOf(iso)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}
export function pairedRate(facts: ContentFact[], numerator: string, denominator: string) {
  const pairs = facts.filter(f => valid(f.raw[numerator]) && valid(f.raw[denominator]) && f.raw[denominator] > 0);
  const top = pairs.reduce((n, f) => n + f.raw[numerator], 0);
  const bottom = pairs.reduce((n, f) => n + f.raw[denominator], 0);
  return { value: bottom > 0 ? top / bottom : null, n: pairs.length, numerator: top, denominator: bottom };
}
export function contentQuality(input: ContentFact[], winnerThreshold: number) {
  const facts = input.filter(f => !f.isDemo);
  const videos = facts.filter(f => ['reel', 'video'].includes(f.format ?? ''));
  const viewed = videos.filter(f => valid(f.raw.views));
  const watched = videos.filter(f => valid(f.raw.avg_watch_time_ms));
  const scored = facts.filter(f => f.isMature && typeof f.score === 'number' && Number.isFinite(f.score));
  const hits = scored.filter(f => f.score! >= winnerThreshold).length;
  return {
    posts: facts.length,
    share: pairedRate(facts, 'shares', 'reach'), save: pairedRate(facts, 'saves', 'reach'), comment: pairedRate(facts, 'comments', 'reach'),
    conversionProfile: pairedRate(facts, 'follows', 'profile_visits'), conversionReach: pairedRate(facts, 'follows', 'reach'),
    videoViews: viewed.length ? viewed.reduce((n, f) => n + f.raw.views, 0) : null, viewed: viewed.length, videos: videos.length,
    // Equal weight per video. The API's average-watch denominator is not interchangeable with views.
    averageWatchSeconds: watched.length ? watched.reduce((n, f) => n + f.raw.avg_watch_time_ms, 0) / watched.length / 1000 : null,
    watched: watched.length, hits, scored: scored.length, hitRate: scored.length ? hits / scored.length : null,
  };
}
export type AccountPoint = { metric: string; value: number | null; period_start: string; period_end: string; observed_at: string; source: string };
export function accountAttention(db: Db, platform = 'instagram') {
  const points = all<AccountPoint>(db, `SELECT metric,value,period_start,period_end,observed_at,source FROM account_metrics WHERE platform_id = ? AND value IS NOT NULL ORDER BY observed_at DESC, id DESC`, platform);
  // Read one explicit account interval, never add overlapping windows or daily unique reach.
  const reach = points.find(p => p.metric === 'account_reach' && p.period_start && p.period_end && valid(p.value)) ?? null;
  const snapshots = points.filter(p => p.metric === 'followers_count' && p.period_end && valid(p.value));
  const latest = [...snapshots].sort((a,b) => b.period_end.localeCompare(a.period_end))[0] ?? null;
  const earliest = latest ? [...snapshots].filter(p => p.source === latest.source && p.period_end < latest.period_end).sort((a,b) => a.period_end.localeCompare(b.period_end))[0] ?? null : null;
  return { reach, latest, earliest, followerGrowth: latest && earliest ? latest.value! - earliest.value! : null };
}

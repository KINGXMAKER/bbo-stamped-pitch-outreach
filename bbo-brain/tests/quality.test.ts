import { describe, expect, it } from 'vitest';
import { accountAttention, contentQuality, weekOf } from '@/lib/intel/quality';
import { testDb } from './helpers';
import type { ContentFact } from '@/lib/intel/dataset';
const fact = (raw: Record<string, number>, extra: Partial<ContentFact> = {}) => ({ raw, format: 'reel', isDemo: false, isMature: true, score: 1, ...extra } as ContentFact);
describe('content quality metrics', () => {
  it('weights rates by matched reach and excludes missing, zero-reach and demo inputs', () => {
    const q = contentQuality([fact({ shares: 10, reach: 100 }), fact({ shares: 10, reach: 900 }), fact({ reach: 9000 }), fact({ shares: 900, reach: 0 }), fact({ shares: 900, reach: 1 }, { isDemo: true })], 1.5);
    expect(q.share).toEqual({ value: .02, n: 2, numerator: 20, denominator: 1000 });
    expect(q.save.value).toBeNull();
  });
  it('keeps conversion denominators separate and does not use net growth', () => {
    const q = contentQuality([fact({ follows: 5, profile_visits: 50, reach: 1000 }), fact({ net_follower_change: 10, reach: 1000 }), fact({ follows: 0, reach: 100 })], 1.5);
    expect(q.conversionProfile.value).toBe(.1);
    expect(q.conversionReach.value).toBe(5 / 1100);
    expect(q.conversionReach.n).toBe(2);
  });
  it('counts zero views, averages only videos and excludes immature/unscored hits', () => {
    const q = contentQuality([fact({ views: 0, avg_watch_time_ms: 1000 }, { score: 1.5 }), fact({ views: 100, avg_watch_time_ms: 3000 }, { score: 2, isMature: false }), fact({ views: 500 }, { format: 'image', score: null })], 1.5);
    expect(q.videoViews).toBe(100); expect(q.viewed).toBe(2);
    expect(q.averageWatchSeconds).toBe(2); expect(q.hitRate).toBe(1); expect(q.scored).toBe(1);
    expect(contentQuality([], 1.5).hitRate).toBeNull();
  });
  it('uses Monday in New York, including DST and UTC midnight boundaries', () => {
    expect(weekOf('2026-09-14T01:00:00Z')).toBe('2026-09-07');
    expect(weekOf('2026-09-14T04:00:00Z')).toBe('2026-09-14');
    expect(weekOf('2026-03-09T03:30:00Z')).toBe('2026-03-02');
  });
  it('never sums overlapping account reach and computes growth only from count snapshots', () => {
    const db = testDb();
    const insert = db.prepare('INSERT INTO account_metrics (platform_id,metric,value,period_start,period_end,observed_at,source) VALUES (?,?,?,?,?,?,?)');
    insert.run('instagram','account_reach',100,'2026-09-01','2026-09-10','2026-09-11','test');
    insert.run('instagram','account_reach',150,'2026-09-02','2026-09-12','2026-09-13','test');
    insert.run('instagram','followers_count',1000,'','2026-09-01','2026-09-01','test');
    insert.run('instagram','followers_count',990,'','2026-09-12','2026-09-12','test');
    insert.run('instagram','net_follower_change',900,'2026-09-01','2026-09-12','2026-09-12','test');
    expect(accountAttention(db).reach?.value).toBe(150);
    expect(accountAttention(db).followerGrowth).toBe(-10);
    expect(accountAttention(db,'youtube').reach).toBeNull();
    db.close();
  });
});

import { describe, expect, it } from 'vitest';
import { all, get } from '@/lib/db/client';
import { importArchiveRun } from '@/lib/ingest/archive';
import { applyCaptionHeuristics, setAttribute, upsertPost, writeMetrics } from '@/lib/ingest/ingest';
import type { SourcePost } from '@/lib/adapters/types';
import { testDb } from './helpers';

const post = (over: Partial<SourcePost> = {}): SourcePost => ({
  platform: 'instagram',
  externalId: '18000000000000001',
  url: 'https://www.instagram.com/reel/TEST/',
  mediaType: 'VIDEO',
  mediaProductType: 'REELS',
  caption: 'Can an ex REALLY earn your trust back? 👀\nPodcast Space: @cozy_homies_studio_\nEdited By: @cuenoe.lens\nw/ @essowrld',
  thumbnailUrl: null,
  mediaUrl: null,
  publishedAt: '2026-09-01T14:00:05.000Z',
  raw: {},
  ...over,
});

describe('ingestion deduplication', () => {
  it('never duplicates content on re-sync; updates packaging instead', () => {
    const db = testDb();
    const first = upsertPost(db, post());
    const second = upsertPost(db, post({ caption: 'edited caption' }));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.contentId).toBe(first.contentId);
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM content')!.n).toBe(1);
    expect(get<{ caption: string }>(db, 'SELECT caption FROM platform_posts')!.caption).toBe('edited caption');
  });

  it('treats the same external id on another platform as a different post', () => {
    const db = testDb();
    upsertPost(db, post());
    upsertPost(db, post({ platform: 'tiktok' }));
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM platform_posts')!.n).toBe(2);
  });
});

describe('metric history', () => {
  it('appends snapshots, never overwrites, and exposes the latest', () => {
    const db = testDb();
    const { postId } = upsertPost(db, post());
    expect(writeMetrics(db, postId, { reach: 1000, shares: 10 }, '2026-09-02T00:00:00.000Z', 'composio_instagram')).toBe(2);
    // Same observation again: idempotent.
    expect(writeMetrics(db, postId, { reach: 1000, shares: 10 }, '2026-09-02T00:00:00.000Z', 'composio_instagram')).toBe(0);
    expect(writeMetrics(db, postId, { reach: 4200, shares: 38 }, '2026-09-09T00:00:00.000Z', 'composio_instagram')).toBe(2);
    const history = all<{ value: number }>(db, `SELECT value FROM content_metrics WHERE metric = 'reach' ORDER BY observed_at`);
    expect(history.map((h) => h.value)).toEqual([1000, 4200]);
    expect(get<{ value: number }>(db, `SELECT value FROM content_metric_latest WHERE metric = 'reach'`)!.value).toBe(4200);
  });

  it('never stores a missing metric as zero', () => {
    const db = testDb();
    const { postId } = upsertPost(db, post());
    writeMetrics(db, postId, { reach: 500, follows: null }, '2026-09-02T00:00:00.000Z', 'test');
    expect(get(db, `SELECT 1 FROM content_metrics WHERE metric = 'follows'`)).toBeUndefined();
  });
});

describe('caption heuristics wiring', () => {
  it('codes attributes, links people by role and never turns a venue into a person', () => {
    const db = testDb();
    const { contentId } = upsertPost(db, post());
    applyCaptionHeuristics(db, contentId);
    const attrs = Object.fromEntries(
      all<{ key: string; value_text: string }>(db, 'SELECT key, value_text FROM content_attribute_current WHERE content_id = ?', contentId).map((a) => [a.key, a.value_text])
    );
    expect(attrs.caption_type).toBe('question');
    expect(attrs.has_location_tag).toBe('true');
    expect(attrs.franchise).toBe('podcast');
    const people = all<{ instagram_handle: string; role: string }>(
      db,
      'SELECT p.instagram_handle, cp.role FROM content_people cp JOIN people p ON p.id = cp.person_id WHERE cp.content_id = ? ORDER BY p.instagram_handle',
      contentId
    );
    expect(people).toEqual([
      { instagram_handle: 'cuenoe.lens', role: 'editor' },
      { instagram_handle: 'essowrld', role: 'guest' },
    ]);
    expect(get<{ slug: string }>(db, 'SELECT t.slug FROM content_topics ct JOIN topics t ON t.id = ct.topic_id WHERE ct.content_id = ? AND ct.is_primary = 1', contentId)?.slug).toBeTruthy();
    // Re-running is idempotent.
    const peopleBefore = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM people')!.n;
    applyCaptionHeuristics(db, contentId);
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM people')!.n).toBe(peopleBefore);
  });

  it('lets a human attribute outrank heuristics, and franchise follows it', () => {
    const db = testDb();
    const { contentId } = upsertPost(db, post());
    applyCaptionHeuristics(db, contentId);
    setAttribute(db, contentId, 'franchise', 'bbo-court', 'human', 1);
    const slug = get<{ slug: string }>(db, 'SELECT f.slug FROM content c JOIN franchises f ON f.id = c.franchise_id WHERE c.id = ?', contentId)!.slug;
    expect(slug).toBe('bbo-court');
    applyCaptionHeuristics(db, contentId); // a later re-sync must not undo the human decision
    expect(get<{ slug: string }>(db, 'SELECT f.slug FROM content c JOIN franchises f ON f.id = c.franchise_id WHERE c.id = ?', contentId)!.slug).toBe('bbo-court');
  });
});

describe('audit archive import', () => {
  const run = {
    audit_generated_at: '2026-09-15T13:00:00.000000+00:00',
    posts: [
      {
        id: '17000000000000009',
        caption: 'MEN VS. WOMEN: who is not communicating?',
        media_type: 'VIDEO',
        mpt: 'REELS',
        permalink: 'https://www.instagram.com/reel/X/',
        timestamp: '2026-09-08T16:00:00+0000',
        reach: 1000,
        likes: 50,
        comments: 5,
        saved: 7,
        shares: 9,
        ti: 71,
        awt_ms: 12000,
        skip: 30,
        duration_s: 33.8,
        features: { lane: 'bts_promo', caption_opening_type: 'claim_statement', cta_type: 'none', identity_conflict: true },
        comment_text: ['first comment', 'second comment'],
      },
    ],
    account_level_insights: { window_totals: { reach: 5000, follower_growth_daily: { '2026-09-08': 40 } } },
  };

  it('is idempotent: a second import writes nothing new', () => {
    const db = testDb();
    const first = importArchiveRun(db, run, 'test.json');
    const second = importArchiveRun(db, run, 'test.json');
    expect(first.newContent).toBe(1);
    expect(first.snapshots).toBe(8); // the fixture carries 8 metrics (no views)
    expect(first.comments).toBe(2);
    expect(second.newContent).toBe(0);
    expect(second.snapshots).toBe(0);
    expect(second.comments).toBe(0);
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM account_metrics')!.n).toBe(2);
  });

  it('maps archive field names onto canonical metrics and keeps audit coding as audit_v2', () => {
    const db = testDb();
    importArchiveRun(db, run, 'test.json');
    const metrics = Object.fromEntries(all<{ metric: string; value: number }>(db, 'SELECT metric, value FROM content_metric_latest').map((m) => [m.metric, m.value]));
    expect(metrics).toMatchObject({ saves: 7, total_interactions: 71, avg_watch_time_ms: 12000, skip_rate: 30 });
    const lane = get<{ source: string; value_text: string }>(db, `SELECT source, value_text FROM content_attribute_current WHERE key = 'audit_lane'`)!;
    expect(lane).toEqual({ source: 'audit_v2', value_text: 'bts_promo' });
    expect(get<{ duration_s: number }>(db, 'SELECT duration_s FROM content')!.duration_s).toBe(33.8);
  });
});

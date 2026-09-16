import path from 'node:path';
import { openDb, run, type Db } from '@/lib/db/client';
import { seedReference } from '@/lib/seed';

export const ROOT = path.resolve(__dirname, '..');

/** Fresh in-memory database with reference data. Test fixtures only — never BBO numbers. */
export function testDb(): Db {
  const db = openDb(':memory:');
  seedReference(db, ROOT);
  return db;
}

let externalSeq = 1000;

/** Minimal published Instagram content + post. Returns { contentId, postId }. */
export function makePost(
  db: Db,
  opts: { caption?: string; publishedAt?: string; durationS?: number | null; franchiseSlug?: string; title?: string } = {}
): { contentId: number; postId: number; externalId: string } {
  const externalId = `test-${externalSeq++}`;
  const franchise = opts.franchiseSlug
    ? (db.prepare('SELECT id FROM franchises WHERE slug = ?').get(opts.franchiseSlug) as { id: number }).id
    : null;
  const { lastId: contentId } = run(
    db,
    'INSERT INTO content (title, format, franchise_id, duration_s) VALUES (?, ?, ?, ?)',
    opts.title ?? `Test ${externalId}`,
    'reel',
    franchise,
    opts.durationS ?? 30
  );
  const { lastId: postId } = run(
    db,
    `INSERT INTO platform_posts (content_id, platform_id, external_id, media_type, media_product_type, caption, published_at)
     VALUES (?, 'instagram', ?, 'VIDEO', 'REELS', ?, ?)`,
    contentId,
    externalId,
    opts.caption ?? '',
    opts.publishedAt ?? '2026-06-01T12:00:00.000Z'
  );
  run(db, 'UPDATE content SET primary_post_id = ? WHERE id = ?', postId, contentId);
  return { contentId, postId, externalId };
}

export function addMetrics(db: Db, postId: number, metrics: Record<string, number | null>, observedAt: string, source = 'test'): void {
  for (const [metric, value] of Object.entries(metrics)) {
    run(
      db,
      'INSERT INTO content_metrics (platform_post_id, metric, value, observed_at, source) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
      postId,
      metric,
      value,
      observedAt,
      source
    );
  }
}

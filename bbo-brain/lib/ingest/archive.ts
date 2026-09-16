import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { get, nowIso, run, type Db } from '@/lib/db/client';
import { graphTimeToIso } from '@/lib/adapters/instagram';
import type { AccountMetricPoint, CanonicalMetric } from '@/lib/adapters/types';
import { durationBucket } from '@/lib/scoring/formula';
import { LANE_TO_FRANCHISE } from './heuristics';
import {
  applyCaptionHeuristics,
  archiveCommentId,
  setAttribute,
  upsertPost,
  writeAccountMetrics,
  writeComments,
  writeMetrics,
} from './ingest';

/**
 * Imports the weekly audit JSON runs (.tools/bbo_ig_collect.py output). These
 * are REAL point-in-time Instagram pulls from past audits, so each file becomes
 * a dated metric snapshot — the start of every post's performance curve.
 */

type ArchivePost = Record<string, unknown> & { id: string; timestamp: string };
type ArchiveRun = {
  audit_generated_at: string;
  posts: ArchivePost[];
  account_level_insights?: {
    window_totals?: Record<string, unknown>;
    demographics?: { follower_demographics?: Record<string, Record<string, number>> };
  };
};

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function defaultArchivePaths(repoRoot = path.resolve(process.cwd(), '..')): string[] {
  const out = [path.join(repoRoot, 'instagram_audit_run_2026-08-08.json'), path.join(repoRoot, 'instagram_audit_run.json')];
  const dataDir = path.join(repoRoot, 'audits', 'data');
  if (existsSync(dataDir)) {
    for (const f of readdirSync(dataDir)) if (f.endsWith('.json')) out.push(path.join(dataDir, f));
  }
  return out.filter((p) => existsSync(p));
}

export type ArchiveImportResult = { files: number; posts: number; newContent: number; snapshots: number; attributes: number; comments: number };

export function importArchiveRun(db: Db, data: ArchiveRun, label: string): Omit<ArchiveImportResult, 'files'> {
  const observedAt = new Date(data.audit_generated_at).toISOString();
  const result = { posts: 0, newContent: 0, snapshots: 0, attributes: 0, comments: 0 };

  for (const p of data.posts ?? []) {
    const productType = (p.media_product_type ?? p.mpt ?? null) as string | null;
    const { contentId, postId, created } = upsertPost(db, {
      platform: 'instagram',
      externalId: String(p.id),
      url: (p.permalink as string) ?? null,
      mediaType: (p.media_type as string) ?? null,
      mediaProductType: productType,
      caption: (p.caption as string) ?? '',
      thumbnailUrl: null,
      mediaUrl: null,
      publishedAt: graphTimeToIso(p.timestamp),
      raw: { archive: label },
    });
    result.posts++;
    if (created) result.newContent++;

    const metrics: Partial<Record<CanonicalMetric, number | null>> = {
      reach: n(p.reach),
      views: n(p.views),
      likes: n(p.likes) ?? n(p.like_count),
      comments: n(p.comments) ?? n(p.comments_count),
      saves: n(p.saved),
      shares: n(p.shares),
      total_interactions: n(p.total_interactions) ?? n(p.ti),
      avg_watch_time_ms: n(p.avg_watch_time_ms) ?? n(p.awt_ms),
      skip_rate: n(p.reels_skip_rate) ?? n(p.skip),
    };
    result.snapshots += writeMetrics(db, postId, metrics, observedAt, 'audit_archive');

    const duration = n(p.duration_s);
    if (duration !== null) {
      const current = get<{ duration_s: number | null }>(db, 'SELECT duration_s FROM content WHERE id = ?', contentId);
      if (current?.duration_s == null) run(db, 'UPDATE content SET duration_s = ?, updated_at = ? WHERE id = ?', duration, nowIso(), contentId);
      setAttribute(db, contentId, 'duration_bucket', durationBucket(duration), 'measured', 1);
      result.attributes++;
    }
    const lufs = n(p.integrated_lufs);
    if (lufs !== null) setAttribute(db, contentId, 'integrated_lufs', lufs, 'measured', 1);

    const features = p.features as Record<string, unknown> | undefined;
    if (features) {
      const conf = 0.5;
      const lane = features.lane as string | undefined;
      setAttribute(db, contentId, 'audit_lane', lane, 'audit_v2', conf);
      if (lane && LANE_TO_FRANCHISE[lane]) setAttribute(db, contentId, 'franchise', LANE_TO_FRANCHISE[lane], 'audit_v2', conf);
      setAttribute(db, contentId, 'caption_type', features.caption_opening_type as string | undefined, 'audit_v2', conf);
      setAttribute(db, contentId, 'cta_type', features.cta_type as string | undefined, 'audit_v2', conf);
      for (const key of ['identity_conflict', 'explicit_binary', 'humor_marker', 'shock_marker', 'confession_marker']) {
        if (typeof features[key] === 'boolean') setAttribute(db, contentId, key, features[key] as boolean, 'audit_v2', conf);
      }
      result.attributes += 8;
    }

    const texts = Array.isArray(p.comment_text) ? (p.comment_text as unknown[]).filter((t): t is string => typeof t === 'string') : [];
    if (texts.length) {
      result.comments += writeComments(
        db,
        postId,
        texts.map((text) => ({ externalId: archiveCommentId(text), text, likeCount: null, commentedAt: null }))
      );
    }

    applyCaptionHeuristics(db, contentId);
  }

  const totals = data.account_level_insights?.window_totals;
  if (totals) {
    const points: AccountMetricPoint[] = [];
    const daily = totals.follower_growth_daily as Record<string, number> | undefined;
    for (const [date, value] of Object.entries(daily ?? {})) {
      const end = new Date(`${date}T07:00:00.000Z`).toISOString();
      points.push({ metric: 'net_follower_change', value, periodStart: new Date(new Date(end).getTime() - 86_400_000).toISOString(), periodEnd: end });
    }
    for (const key of ['reach', 'views', 'profile_views', 'website_clicks', 'accounts_engaged', 'total_interactions']) {
      if (n(totals[key]) !== null) points.push({ metric: `account_${key}`, value: n(totals[key]), periodStart: null, periodEnd: observedAt });
    }
    const followers = data.account_level_insights?.demographics?.follower_demographics;
    for (const [breakdown, values] of Object.entries(followers ?? {})) {
      if (values && !('_error' in values)) {
        points.push({ metric: `follower_demographics_${breakdown}`, value: null, periodStart: null, periodEnd: observedAt, breakdown: values });
      }
    }
    writeAccountMetrics(db, 'instagram', points, observedAt, 'audit_archive');
  }

  return result;
}

export function importArchiveFiles(db: Db, files: string[]): ArchiveImportResult {
  const total: ArchiveImportResult = { files: 0, posts: 0, newContent: 0, snapshots: 0, attributes: 0, comments: 0 };
  for (const file of files) {
    const data = JSON.parse(readFileSync(file, 'utf8')) as ArchiveRun;
    if (!Array.isArray(data.posts) || !data.audit_generated_at) continue;
    const r = importArchiveRun(db, data, path.basename(file));
    total.files++;
    total.posts += r.posts;
    total.newContent += r.newContent;
    total.snapshots += r.snapshots;
    total.attributes += r.attributes;
    total.comments += r.comments;
  }
  return total;
}

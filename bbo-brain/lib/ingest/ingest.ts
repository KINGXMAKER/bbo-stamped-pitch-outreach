import { createHash } from 'node:crypto';
import { all, get, json, nowIso, run, tx, type Db } from '@/lib/db/client';
import { createPerson, resolveEntity } from '@/lib/entities/resolve';
import { normalizeName } from '@/lib/entities/normalize';
import { durationBucket } from '@/lib/scoring/formula';
import type {
  AccountMetricPoint,
  CanonicalMetric,
  MediaResult,
  SourceComment,
  SourcePost,
  TranscriptResult,
} from '@/lib/adapters/types';
import * as H from './heuristics';

export type AttributeSource = 'human' | 'measured' | 'ai' | 'audit_v2' | 'heuristic';

export function formatFor(post: Pick<SourcePost, 'mediaType' | 'mediaProductType'>): string {
  const product = (post.mediaProductType ?? '').toUpperCase();
  const media = (post.mediaType ?? '').toUpperCase();
  if (product === 'REELS') return 'reel';
  if (product === 'STORY') return 'story';
  if (media === 'CAROUSEL_ALBUM') return 'carousel';
  if (media === 'VIDEO') return 'video';
  return 'image';
}

/**
 * Idempotent on (platform, external_id): a re-sync updates packaging fields and
 * never creates a second content record.
 */
export function upsertPost(db: Db, post: SourcePost): { contentId: number; postId: number; created: boolean } {
  return tx(db, () => {
    const time = H.postingTime(post.publishedAt);
    const existing = get<{ id: number; content_id: number }>(
      db,
      'SELECT id, content_id FROM platform_posts WHERE platform_id = ? AND external_id = ?',
      post.platform,
      post.externalId
    );
    if (existing) {
      run(
        db,
        `UPDATE platform_posts SET caption = ?, source_url = COALESCE(?, source_url), thumbnail_url = COALESCE(?, thumbnail_url),
           media_type = COALESCE(?, media_type), media_product_type = COALESCE(?, media_product_type), last_synced_at = ?
         WHERE id = ?`,
        post.caption,
        post.url,
        post.thumbnailUrl,
        post.mediaType,
        post.mediaProductType,
        nowIso(),
        existing.id
      );
      return { contentId: existing.content_id, postId: existing.id, created: false };
    }

    const { lastId: contentId } = run(
      db,
      `INSERT INTO content (title, status, format) VALUES (?, 'published', ?)`,
      H.titleFromCaption(post.caption, `${post.platform} post ${post.externalId}`),
      formatFor(post)
    );
    const { lastId: postId } = run(
      db,
      `INSERT INTO platform_posts (content_id, platform_id, external_id, source_url, media_type, media_product_type, caption,
         thumbnail_url, published_at, posting_dow, posting_hour, raw_json, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      contentId,
      post.platform,
      post.externalId,
      post.url,
      post.mediaType,
      post.mediaProductType,
      post.caption,
      post.thumbnailUrl,
      post.publishedAt,
      time?.dow ?? null,
      time?.hour ?? null,
      json(post.raw),
      nowIso()
    );
    run(db, 'UPDATE content SET primary_post_id = ? WHERE id = ?', postId, contentId);
    return { contentId, postId, created: true };
  });
}

/** Append-only. Returns the number of NEW snapshot rows (re-running the same observation writes 0). */
export function writeMetrics(
  db: Db,
  postId: number,
  metrics: Partial<Record<CanonicalMetric, number | null>>,
  observedAt: string,
  source: string
): number {
  let written = 0;
  for (const [metric, value] of Object.entries(metrics)) {
    if (value === undefined || value === null || !Number.isFinite(value)) continue;
    written += run(
      db,
      `INSERT INTO content_metrics (platform_post_id, metric, value, observed_at, source) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
      postId,
      metric,
      value,
      observedAt,
      source
    ).changes;
  }
  return written;
}

export function setAttribute(
  db: Db,
  contentId: number,
  key: string,
  value: string | number | boolean | null | undefined,
  source: AttributeSource,
  confidence: number | null = null,
  aiRunId: number | null = null
): void {
  if (value === undefined || value === null || value === '') return;
  const valueText = typeof value === 'boolean' ? String(value) : String(value);
  const valueNum = typeof value === 'number' ? value : null;
  run(
    db,
    `INSERT INTO content_attributes (content_id, key, value_text, value_num, source, confidence, ai_run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (content_id, key, source) DO UPDATE SET value_text = excluded.value_text, value_num = excluded.value_num,
       confidence = excluded.confidence, ai_run_id = excluded.ai_run_id, created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    contentId,
    key,
    valueText,
    valueNum,
    source,
    confidence,
    aiRunId
  );
  if (key === 'franchise') refreshFranchise(db, contentId);
}

/** content.franchise_id always mirrors the highest-precedence 'franchise' attribute. */
export function refreshFranchise(db: Db, contentId: number): void {
  const current = get<{ value_text: string }>(
    db,
    `SELECT value_text FROM content_attribute_current WHERE content_id = ? AND key = 'franchise'`,
    contentId
  );
  const franchise = current ? get<{ id: number }>(db, 'SELECT id FROM franchises WHERE slug = ?', current.value_text) : undefined;
  run(db, 'UPDATE content SET franchise_id = ?, updated_at = ? WHERE id = ?', franchise?.id ?? null, nowIso(), contentId);
}

export function linkPerson(db: Db, contentId: number, personId: number, role: string, source: string, confidence: number): void {
  run(
    db,
    `INSERT INTO content_people (content_id, person_id, role, source, confidence) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (content_id, person_id, role) DO NOTHING`,
    contentId,
    personId,
    role,
    source,
    confidence
  );
}

/** Keyword topic tags. Skipped once AI or a human has tagged the content. */
export function tagTopicsFromText(db: Db, contentId: number, text: string, source = 'heuristic', confidence = 0.4): number {
  const better = get(db, `SELECT 1 FROM content_topics WHERE content_id = ? AND source IN ('ai','human')`, contentId);
  if (better) return 0;
  const haystack = ` ${normalizeName(text)} `;
  const aliases = all<{ entity_id: string; alias_norm: string }>(db, `SELECT entity_id, alias_norm FROM entity_aliases WHERE entity_type = 'topic'`);
  const hits = new Map<number, number>();
  for (const a of aliases) {
    // Short single words ("ex", "pay") are too ambiguous without context.
    if (!a.alias_norm.includes(' ') && a.alias_norm.length < 4) continue;
    if (haystack.includes(` ${a.alias_norm} `)) {
      const id = Number(a.entity_id);
      hits.set(id, (hits.get(id) ?? 0) + a.alias_norm.length);
    }
  }
  if (!hits.size) return 0;
  run(db, `DELETE FROM content_topics WHERE content_id = ? AND source = ?`, contentId, source);
  const ranked = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  ranked.forEach(([topicId], i) => {
    run(
      db,
      `INSERT INTO content_topics (content_id, topic_id, is_primary, source, confidence) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (content_id, topic_id) DO NOTHING`,
      contentId,
      topicId,
      i === 0 ? 1 : 0,
      source,
      confidence
    );
  });
  return ranked.length;
}

/** Caption-level coding, people from @mentions, keyword topics, franchise guess. */
export function applyCaptionHeuristics(db: Db, contentId: number): void {
  const post = get<{ id: number; caption: string | null; published_at: string | null }>(
    db,
    `SELECT pp.id, pp.caption, pp.published_at FROM content c JOIN platform_posts pp ON pp.id = c.primary_post_id WHERE c.id = ?`,
    contentId
  );
  if (!post) return;
  const caption = post.caption ?? '';
  tx(db, () => {
    const mentions = H.captionMentions(caption);
    setAttribute(db, contentId, 'caption_type', H.captionType(caption), 'heuristic', 0.6);
    setAttribute(db, contentId, 'cta_type', H.ctaType(caption), 'heuristic', 0.5);
    setAttribute(db, contentId, 'hashtag_bucket', H.hashtagBucket(caption), 'measured', 1);
    setAttribute(db, contentId, 'caption_length_bucket', H.captionLengthBucket(caption), 'measured', 1);
    setAttribute(db, contentId, 'has_guest_tag', mentions.some((m) => m.role === 'guest'), 'measured', 1);
    setAttribute(db, contentId, 'has_location_tag', mentions.some((m) => m.role === 'location'), 'measured', 1);
    const content = get<{ format: string | null }>(db, 'SELECT format FROM content WHERE id = ?', contentId);
    setAttribute(db, contentId, 'format', content?.format, 'measured', 1);

    if (post.published_at) {
      const time = H.postingTime(post.published_at);
      if (time) {
        setAttribute(db, contentId, 'posting_day', time.day, 'measured', 1);
        setAttribute(db, contentId, 'posting_daypart', time.daypart, 'measured', 1);
        run(db, 'UPDATE platform_posts SET posting_dow = ?, posting_hour = ? WHERE id = ?', time.dow, time.hour, post.id);
      }
    }

    const franchise = H.franchiseFromCaption(caption, mentions);
    if (franchise) setAttribute(db, contentId, 'franchise', franchise.slug, 'heuristic', franchise.confidence);

    tagTopicsFromText(db, contentId, caption);

    for (const mention of mentions) {
      if (mention.role === 'location') continue; // venues are a caption attribute, not people
      const role = mention.role === 'voiceover' ? 'cast' : mention.role;
      const resolution = resolveEntity(db, 'person', `@${mention.handle}`, { contentId, text: caption });
      if (resolution.kind === 'matched') {
        linkPerson(db, contentId, Number(resolution.entityId), role, 'heuristic', 0.7);
      } else if (resolution.kind === 'unknown') {
        // An exact new handle is a unique identity; near-matches wait for review instead.
        const personId = createPerson(db, `@${mention.handle}`, 'caption_mention', mention.role === 'editor' ? 'editor' : mention.role === 'creator' ? 'creator' : 'guest');
        linkPerson(db, contentId, personId, role, 'heuristic', 0.7);
      }
    }
  });
}

export function applyMedia(db: Db, contentId: number, media: MediaResult, keepMedia: boolean): void {
  tx(db, () => {
    if (media.durationS !== null) {
      run(db, 'UPDATE content SET duration_s = ?, updated_at = ? WHERE id = ?', media.durationS, nowIso(), contentId);
      setAttribute(db, contentId, 'duration_bucket', durationBucket(media.durationS), 'measured', 1);
    }
    if (media.integratedLufs !== null) setAttribute(db, contentId, 'integrated_lufs', media.integratedLufs, 'measured', 1);
    run(
      db,
      'UPDATE content SET thumb_path = COALESCE(?, thumb_path), frames_json = ?, asset_ref = ? WHERE id = ?',
      media.thumbPath,
      json(media.framePaths),
      keepMedia ? media.mediaPath : null,
      contentId
    );
  });
}

export function writeTranscript(db: Db, contentId: number, source: string, t: TranscriptResult): void {
  tx(db, () => {
    run(
      db,
      `INSERT INTO transcripts (content_id, source, model, language, text, segments_json) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (content_id, source) DO UPDATE SET model = excluded.model, language = excluded.language, text = excluded.text,
         segments_json = excluded.segments_json, created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      contentId,
      source,
      t.model,
      t.language,
      t.text,
      json(t.segments)
    );
    const opening = t.segments.filter((s) => s.start < 5).map((s) => s.text).join(' ').trim();
    if (opening) setAttribute(db, contentId, 'opening_transcript', opening.slice(0, 400), 'measured', 1);
  });
}

export function writeComments(db: Db, postId: number, comments: SourceComment[]): number {
  let written = 0;
  for (const c of comments) {
    written += run(
      db,
      `INSERT INTO content_comments (platform_post_id, external_id, text, like_count, commented_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (platform_post_id, external_id) DO NOTHING`,
      postId,
      c.externalId,
      c.text,
      c.likeCount,
      c.commentedAt
    ).changes;
  }
  return written;
}

/** Comments from archives have no platform id; a content hash keeps re-imports idempotent. */
export function archiveCommentId(text: string): string {
  return `archive:${createHash('sha1').update(text).digest('hex').slice(0, 20)}`;
}

export function writeAccountMetrics(db: Db, platformId: string, points: AccountMetricPoint[], observedAt: string, source: string): number {
  let written = 0;
  for (const p of points) {
    written += run(
      db,
      `INSERT INTO account_metrics (platform_id, metric, value, period_start, period_end, breakdown_json, observed_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      platformId,
      p.metric,
      p.value,
      p.periodStart ?? '',
      p.periodEnd ?? '',
      p.breakdown ? json(p.breakdown) : null,
      observedAt,
      source
    ).changes;
  }
  return written;
}

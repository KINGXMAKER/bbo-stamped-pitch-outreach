import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { all, get, nowIso, run } from '@/lib/db/client';
import { brainConfig } from '@/lib/config';
import { ComposioProxy } from '@/lib/adapters/composio';
import { InstagramComposioAdapter } from '@/lib/adapters/instagram';
import { InstagramMediaAdapter } from '@/lib/adapters/media';
import { WhisperCppAdapter } from '@/lib/adapters/whisper';
import { SourceError, type MediaSourceAdapter, type TranscriptSourceAdapter } from '@/lib/adapters/types';
import { applyCaptionHeuristics, applyMedia, upsertPost, writeAccountMetrics, writeComments, writeMetrics, writeTranscript } from '@/lib/ingest/ingest';
import { analysisQueue } from '@/lib/intel/analysis';
import { markIntegration, type JobContext, type JobOutcome } from './jobs';

export function instagramAdapter(): InstagramComposioAdapter | null {
  const cfg = brainConfig();
  if (!cfg.composioApiKey) return null;
  return new InstagramComposioAdapter(new ComposioProxy({ apiKey: cfg.composioApiKey, connectedAccountId: cfg.composioConnectedAccountId }), cfg.igUserId);
}

function requireAdapter(ctx: JobContext): InstagramComposioAdapter {
  const adapter = instagramAdapter();
  if (!adapter) {
    markIntegration(ctx.db, 'composio_instagram', { status: 'not_connected', error: 'COMPOSIO_API_KEY is not set.' });
    throw new SourceError({ kind: 'not-configured', message: 'COMPOSIO_API_KEY is not set — Instagram sync cannot run.' });
  }
  return adapter;
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/** Lists posts and upserts content. Dedupe is (platform, external_id). */
export async function syncInstagramContent(ctx: JobContext, adapter = requireAdapter(ctx)): Promise<JobOutcome> {
  const sinceDays = typeof ctx.params.sinceDays === 'number' ? ctx.params.sinceDays : null;
  const since = sinceDays ? new Date(Date.now() - sinceDays * 86_400_000).toISOString() : undefined;
  try {
    const posts = await adapter.listPosts({ since, maxPages: Number(ctx.params.maxPages ?? 20) });
    let created = 0;
    for (const post of posts) {
      const r = upsertPost(ctx.db, post);
      if (r.created) created++;
      applyCaptionHeuristics(ctx.db, r.contentId);
    }
    ctx.log('content synced', { listed: posts.length, created, apiCalls: adapter.apiCalls });
    markIntegration(ctx.db, 'composio_instagram', { status: 'connected', success: true, records: created });
    return { recordsSeen: posts.length, recordsWritten: created, summary: `${posts.length} posts listed, ${created} new content records` };
  } catch (err) {
    markIntegration(ctx.db, 'composio_instagram', { status: 'needs_attention', error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/** Appends a metric snapshot for every post in the refresh window (or all posts). */
export async function syncInstagramMetrics(ctx: JobContext, adapter = requireAdapter(ctx)): Promise<JobOutcome> {
  const refreshDays = Number(ctx.params.refreshDays ?? 45);
  const everything = ctx.params.all === true;
  const commentsWindowDays = Number(ctx.params.commentsWindowDays ?? 30);
  const posts = all<{ id: number; external_id: string; media_product_type: string | null; published_at: string }>(
    ctx.db,
    `SELECT pp.id, pp.external_id, pp.media_product_type, pp.published_at FROM platform_posts pp
     WHERE pp.platform_id = 'instagram' ${everything ? '' : 'AND pp.published_at >= ?'}
     ORDER BY pp.published_at DESC`,
    ...(everything ? [] : [new Date(Date.now() - refreshDays * 86_400_000).toISOString()])
  );

  let written = 0;
  let failures = 0;
  const unavailable = new Set<string>();
  const commentCutoff = new Date(Date.now() - commentsWindowDays * 86_400_000).toISOString();

  await pool(posts, 4, async (post) => {
    try {
      const result = await adapter.postMetrics({ externalId: post.external_id, mediaProductType: post.media_product_type });
      written += writeMetrics(ctx.db, post.id, result.metrics, result.observedAt, 'composio_instagram');
      for (const u of result.unavailable) unavailable.add(`${post.media_product_type ?? 'FEED'}: ${u.metric}`);
      if (post.published_at >= commentCutoff) {
        const comments = await adapter.comments(post.external_id, 50);
        writeComments(ctx.db, post.id, comments);
      }
      run(ctx.db, 'UPDATE platform_posts SET last_synced_at = ? WHERE id = ?', nowIso(), post.id);
    } catch (err) {
      if (err instanceof SourceError && err.kind === 'transient') throw err;
      failures++;
      ctx.log('post metrics failed', { externalId: post.external_id, message: err instanceof Error ? err.message : String(err) });
    }
  });

  if (unavailable.size) ctx.log('metrics not exposed by Instagram', { metrics: [...unavailable] });
  markIntegration(ctx.db, 'composio_instagram', { status: failures && failures === posts.length ? 'needs_attention' : 'connected', success: failures < posts.length, records: written });
  return {
    recordsSeen: posts.length,
    recordsWritten: written,
    partial: failures > 0 && failures < posts.length,
    summary: `${posts.length} posts refreshed, ${written} metric values appended, ${failures} failed, API calls ${adapter.apiCalls}`,
  };
}

export async function syncInstagramAccount(ctx: JobContext, adapter = requireAdapter(ctx)): Promise<JobOutcome> {
  const days = Number(ctx.params.days ?? 30);
  const until = nowIso();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { points, unavailable } = await adapter.accountMetrics(since, until);
  const written = writeAccountMetrics(ctx.db, 'instagram', points, until, 'composio_instagram');
  if (unavailable.length) ctx.log('account metrics unavailable', { unavailable });
  markIntegration(ctx.db, 'composio_instagram', { status: 'connected', success: true, records: written });
  return { recordsSeen: points.length, recordsWritten: written, summary: `${points.length} account data points, ${unavailable.length} unavailable` };
}

/**
 * Downloads media for posts missing measurements or transcripts, newest first.
 * Media URLs expire, so a fresh URL is requested per post. Videos are deleted
 * after measurement unless keepMedia is set — only frames, thumbs and the
 * transcript are kept.
 */
export async function syncMediaAndTranscripts(
  ctx: JobContext,
  deps: { adapter?: InstagramComposioAdapter; media?: MediaSourceAdapter; transcriber?: TranscriptSourceAdapter } = {}
): Promise<JobOutcome> {
  const cfg = brainConfig();
  const adapter = deps.adapter ?? requireAdapter(ctx);
  const media = deps.media ?? new InstagramMediaAdapter();
  const transcriber = deps.transcriber ?? new WhisperCppAdapter(cfg.whisperCli, cfg.whisperModel);
  const canTranscribe = transcriber.isAvailable();
  const limit = Number(ctx.params.limit ?? 15);
  const keepMedia = ctx.params.keepMedia === true;

  markIntegration(ctx.db, 'whisper_local', canTranscribe ? { status: 'connected' } : { status: 'not_connected', error: `whisper-cli or model not found (${cfg.whisperCli})` });

  const onlyContentId = Number(ctx.params.contentId) || null;
  // Winners and losers waiting for analysis get media first, then the newest posts.
  const priority = onlyContentId ? [] : analysisQueue(ctx.db).waitingForMedia.slice(0, Math.ceil(limit / 2)).map((h) => h.fact.contentId);
  const pick = (ids: number[] | null, n: number) =>
    all<{ content_id: number; external_id: string; format: string | null; thumb_path: string | null }>(
      ctx.db,
      `SELECT c.id AS content_id, pp.external_id, c.format, c.thumb_path FROM content c
       JOIN platform_posts pp ON pp.id = c.primary_post_id
       WHERE pp.platform_id = 'instagram' AND c.status = 'published'
         AND ${ids ? `c.id IN (${ids.map(Number).join(',') || 0})` : `(c.thumb_path IS NULL OR (c.format IN ('reel','video') AND NOT EXISTS (SELECT 1 FROM transcripts t WHERE t.content_id = c.id)))`}
       ORDER BY pp.published_at DESC LIMIT ?`,
      n
    );
  const first = onlyContentId ? pick([onlyContentId], 1) : pick(priority, priority.length || 1).filter(() => priority.length > 0);
  const queue = [...first, ...pick(null, limit).filter((r) => !first.some((f) => f.content_id === r.content_id))].slice(0, limit);

  mkdirSync(cfg.mediaDir, { recursive: true });
  let transcribed = 0;
  let measured = 0;
  let failures = 0;

  for (const item of queue) {
    try {
      const fresh = await adapter.proxyMedia(item.external_id);
      const result = await media.fetchMedia({ externalId: item.external_id, mediaUrl: fresh.mediaUrl, mediaType: fresh.mediaType }, cfg.mediaDir);
      if (!result) {
        ctx.log('no downloadable media', { externalId: item.external_id, mediaType: fresh.mediaType });
        continue;
      }
      applyMedia(ctx.db, item.content_id, result, keepMedia);
      measured++;
      if (result.isVideo && canTranscribe && result.mediaPath) {
        const t = await transcriber.transcribe(result.mediaPath);
        writeTranscript(ctx.db, item.content_id, 'whisper_cpp', t);
        transcribed++;
      }
      if (!keepMedia && result.mediaPath && existsSync(result.mediaPath)) rmSync(result.mediaPath, { force: true });
    } catch (err) {
      if (err instanceof SourceError && err.kind === 'transient') throw err;
      failures++;
      ctx.log('media/transcript failed', { externalId: item.external_id, message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (transcribed) markIntegration(ctx.db, 'whisper_local', { status: 'connected', success: true, records: transcribed });
  return {
    recordsSeen: queue.length,
    recordsWritten: measured + transcribed,
    partial: failures > 0 && failures < queue.length,
    summary: `${measured} measured, ${transcribed} transcribed, ${failures} failed${canTranscribe ? '' : ' (transcription unavailable)'}`,
  };
}

/** Live check used by the Integrations page. Makes one lightweight Graph call. */
export async function checkInstagramConnection(ctx: JobContext): Promise<JobOutcome> {
  const adapter = instagramAdapter();
  if (!adapter) {
    markIntegration(ctx.db, 'composio_instagram', { status: 'not_connected', error: 'COMPOSIO_API_KEY is not set.' });
    return { recordsSeen: 0, recordsWritten: 0, summary: 'not configured' };
  }
  try {
    const profile = await adapter.profile();
    markIntegration(ctx.db, 'composio_instagram', { status: 'connected', success: true, accountRef: `@${profile.username} · ${brainConfig().composioConnectedAccountId}` });
    return { recordsSeen: 1, recordsWritten: 0, summary: `connected as @${profile.username}` };
  } catch (err) {
    markIntegration(ctx.db, 'composio_instagram', { status: 'needs_attention', error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

export function integrationStatusForAi(): { configured: boolean } {
  return { configured: Boolean(brainConfig().geminiApiKey) };
}

export function lastJob(kind: string) {
  return (db: Parameters<typeof get>[0]) =>
    get<{ id: number; status: string; finished_at: string | null; error: string | null }>(
      db,
      'SELECT id, status, finished_at, error FROM sync_jobs WHERE kind = ? ORDER BY id DESC LIMIT 1',
      kind
    );
}

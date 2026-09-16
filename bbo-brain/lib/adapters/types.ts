/**
 * Provider-neutral ingestion interfaces. The core product only ever talks to
 * these; Composio, whisper.cpp and ffmpeg are implementations behind them, so a
 * provider change is a new adapter, not a rewrite.
 */

export const CANONICAL_METRICS = [
  'reach',
  'views',
  'likes',
  'comments',
  'saves',
  'shares',
  'total_interactions',
  'avg_watch_time_ms',
  'total_watch_time_ms',
  'skip_rate',
  'follows',
  'profile_visits',
] as const;
export type CanonicalMetric = (typeof CANONICAL_METRICS)[number];

export type SourcePost = {
  platform: string;
  externalId: string;
  url: string | null;
  mediaType: string | null;
  mediaProductType: string | null;
  caption: string;
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  publishedAt: string;
  raw: Record<string, unknown>;
};

export type PostMetricsResult = {
  metrics: Partial<Record<CanonicalMetric, number>>;
  unavailable: Array<{ metric: string; reason: string }>;
  observedAt: string;
};

export type SourceComment = {
  externalId: string;
  text: string | null;
  likeCount: number | null;
  commentedAt: string | null;
};

export type AccountMetricPoint = {
  metric: string;
  value: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  breakdown?: Record<string, number>;
};

export interface ContentSourceAdapter {
  readonly id: string;
  readonly platform: string;
  /** Newest first. Stops paging once posts are older than `since`. */
  listPosts(opts: { since?: string; maxPages?: number }): Promise<SourcePost[]>;
}

export interface AnalyticsSourceAdapter {
  readonly id: string;
  readonly platform: string;
  postMetrics(post: Pick<SourcePost, 'externalId' | 'mediaProductType'>): Promise<PostMetricsResult>;
  comments(externalId: string, limit: number): Promise<SourceComment[]>;
  accountMetrics(sinceIso: string, untilIso: string): Promise<{ points: AccountMetricPoint[]; unavailable: string[] }>;
}

export type MediaResult = {
  mediaPath: string | null;
  isVideo: boolean;
  durationS: number | null;
  integratedLufs: number | null;
  framePaths: Array<{ atS: number; path: string }>;
  thumbPath: string | null;
};

export interface MediaSourceAdapter {
  readonly id: string;
  fetchMedia(post: Pick<SourcePost, 'externalId' | 'mediaUrl' | 'mediaType'>, workDir: string): Promise<MediaResult | null>;
}

export type TranscriptSegment = { start: number; end: number; text: string };
export type TranscriptResult = { text: string; segments: TranscriptSegment[]; model: string; language: string | null };

export interface TranscriptSourceAdapter {
  readonly id: string;
  isAvailable(): boolean;
  transcribe(mediaPath: string): Promise<TranscriptResult>;
}

/** Raw-footage storage (Drive, S3…). Interface only: no storage provider is connected yet. */
export interface StorageSourceAdapter {
  readonly id: string;
  listFiles(folder: string): Promise<Array<{ id: string; name: string; mimeType: string; modifiedAt: string }>>;
  download(fileId: string, destPath: string): Promise<string>;
}

export type SourceErrorKind = 'transient' | 'hard' | 'unsupported' | 'not-configured';

export class SourceError extends Error {
  readonly kind: SourceErrorKind;
  readonly status?: number;
  readonly code?: number;

  constructor(args: { kind: SourceErrorKind; message: string; status?: number; code?: number }) {
    super(args.message);
    this.name = 'SourceError';
    this.kind = args.kind;
    this.status = args.status;
    this.code = args.code;
  }
}

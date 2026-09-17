import { all, get, type Db } from '@/lib/db/client';
import { bucketOf, bucketRank, isIgnoredBucket } from '@/lib/intel/buckets';
import { loadFacts, type ContentFact } from '@/lib/intel/dataset';

/**
 * Intelligence-priority queue for media analysis and structured coding.
 *
 * Posts are not processed in the order the database happens to return them.
 * The point of the first corpus is CONTRAST — why winners won versus why
 * losers lost — so the queue front-loads decided outcomes, keeps a control
 * group of average posts, and spreads across franchises, guests and eras.
 */

export type Tier = 1 | 2 | 3 | 4 | 5 | 6;

export const TIER_LABELS: Record<Tier, string> = {
  1: 'Recent decided outcome (90d breakout/winner/loser)',
  2: 'Historical breakout / winner',
  3: 'Historical loser',
  4: 'Unusual share / comment / save / retention',
  5: 'Average control sample',
  6: 'Everything else',
};

export type CorpusClass = 'winner' | 'loser' | 'average' | 'unusual' | 'other';

/** First-corpus targets: a balanced comparison set, not a wall of winners. */
export const CORPUS_TARGETS: Record<CorpusClass, number> = { winner: 40, loser: 40, average: 30, unusual: 20, other: 0 };

const RECENT_DAYS = 90;
const DAY = 86_400_000;

const isUnusual = (f: ContentFact) => {
  const r = f.rates;
  return (
    (r.share_rel ?? 0) >= 2 ||
    (r.comment_rel ?? 0) >= 2 ||
    (r.save_rel ?? 0) >= 2 ||
    (r.retention_rel ?? 0) >= 1.6 ||
    (r.retention_rel !== undefined && r.retention_rel <= 0.5)
  );
};

export function corpusClass(f: ContentFact): CorpusClass {
  if (f.label === 'BREAKOUT' || f.label === 'WINNER') return 'winner';
  if (f.label === 'LOSER' || f.label === 'BELOW_AVERAGE') return 'loser';
  if (isUnusual(f)) return 'unusual';
  if (f.label === 'AVERAGE') return 'average';
  return 'other';
}

export function tierFor(f: ContentFact, now: Date): { tier: Tier; reason: string } {
  const recent = new Date(f.publishedAt).getTime() >= now.getTime() - RECENT_DAYS * DAY;
  const decided = f.label === 'BREAKOUT' || f.label === 'WINNER' || f.label === 'LOSER';
  if (recent && decided) return { tier: 1, reason: `${f.label?.toLowerCase()} in the last ${RECENT_DAYS} days` };
  if (f.label === 'BREAKOUT' || f.label === 'WINNER') return { tier: 2, reason: `historical ${f.label.toLowerCase()} (${f.score?.toFixed(2)})` };
  if (f.label === 'LOSER') return { tier: 3, reason: `historical loser (${f.score?.toFixed(2)})` };
  if (isUnusual(f)) {
    const parts = [
      (f.rates.share_rel ?? 0) >= 2 ? `shares ${f.rates.share_rel!.toFixed(1)}x` : null,
      (f.rates.comment_rel ?? 0) >= 2 ? `comments ${f.rates.comment_rel!.toFixed(1)}x` : null,
      (f.rates.save_rel ?? 0) >= 2 ? `saves ${f.rates.save_rel!.toFixed(1)}x` : null,
      (f.rates.retention_rel ?? 0) >= 1.6 ? `retention ${f.rates.retention_rel!.toFixed(1)}x` : null,
      f.rates.retention_rel !== undefined && f.rates.retention_rel <= 0.5 ? `retention ${f.rates.retention_rel.toFixed(2)}x` : null,
    ].filter(Boolean);
    return { tier: 4, reason: `unusual: ${parts.join(', ')}` };
  }
  if (f.label === 'AVERAGE') return { tier: 5, reason: 'average control sample' };
  return { tier: 6, reason: f.label ? f.label.toLowerCase().replace(/_/g, ' ') : 'unscored' };
}

export type QueueItem = {
  contentId: number;
  externalId: string;
  title: string;
  tier: Tier;
  reason: string;
  corpusClass: CorpusClass;
  label: string | null;
  score: number | null;
  publishedAt: string;
  franchise: string | null;
  needsMedia: boolean;
  needsCoding: boolean;
};

type State = { hasMedia: boolean; hasTranscript: boolean; hasFrames: boolean; coded: boolean; externalId: string };

function loadState(db: Db): Map<number, State> {
  const rows = all<{ id: number; external_id: string; thumb_path: string | null; coded_at: string | null; has_transcript: number; frames_json: string | null }>(
    db,
    `SELECT c.id, pp.external_id, c.thumb_path, c.coded_at, c.frames_json,
            EXISTS (SELECT 1 FROM transcripts t WHERE t.content_id = c.id) AS has_transcript
     FROM content c JOIN platform_posts pp ON pp.id = c.primary_post_id`
  );
  return new Map(
    rows.map((r) => [
      r.id,
      {
        hasMedia: Boolean(r.thumb_path),
        hasTranscript: r.has_transcript === 1,
        hasFrames: Boolean(r.frames_json && r.frames_json !== '[]'),
        coded: Boolean(r.coded_at),
        externalId: r.external_id,
      },
    ])
  );
}

const isVideo = (f: ContentFact) => f.format === 'reel' || f.format === 'video' || f.format === 'short';

/** What the first intelligence corpus looks like right now, per class. */
export function corpusStatus(db: Db, now = new Date()) {
  // Baddie of the Month and ignored posts are not part of the intelligence corpus.
  const facts = loadFacts(db).filter((f) => !isIgnoredBucket(bucketOf(f)));
  const state = loadState(db);
  const classes: CorpusClass[] = ['winner', 'loser', 'average', 'unusual'];
  const counts = Object.fromEntries(classes.map((c) => [c, { coded: 0, withMedia: 0, total: 0, target: CORPUS_TARGETS[c], remaining: CORPUS_TARGETS[c] }])) as Record<
    CorpusClass,
    { coded: number; withMedia: number; total: number; target: number; remaining: number }
  >;
  for (const f of facts) {
    const cls = corpusClass(f);
    if (!classes.includes(cls)) continue;
    const s = state.get(f.contentId);
    counts[cls].total++;
    if (s?.hasMedia) counts[cls].withMedia++;
    if (s?.coded) counts[cls].coded++;
  }
  for (const c of classes) counts[c].remaining = Math.max(0, counts[c].target - counts[c].coded);
  const codedTotal = facts.filter((f) => state.get(f.contentId)?.coded).length;
  return {
    classes: counts,
    coded: codedTotal,
    target: Object.values(CORPUS_TARGETS).reduce((a, b) => a + b, 0),
    withMedia: facts.filter((f) => state.get(f.contentId)?.hasMedia).length,
    transcripts: facts.filter((f) => state.get(f.contentId)?.hasTranscript).length,
    total: facts.length,
    now: now.toISOString(),
  };
}

type QueueOptions = {
  limit: number;
  now?: Date;
  /** 'media' = needs download/transcript · 'coding' = has media but no AI coding yet. */
  stage: 'media' | 'coding';
  /** Ignore per-class corpus targets (used once the balanced corpus is complete). */
  ignoreTargets?: boolean;
};

/**
 * Ordered by tier, then recency, with three balance constraints:
 * per-class corpus targets, a per-franchise cap, and a per-guest cap — so one
 * franchise or one guest cannot fill the corpus and skew every later comparison.
 */
export function buildQueue(db: Db, opts: QueueOptions): QueueItem[] {
  const now = opts.now ?? new Date();
  const facts = loadFacts(db);
  const state = loadState(db);
  const status = corpusStatus(db, now);

  const candidates = facts
    .map((f) => {
      const s = state.get(f.contentId);
      if (!s) return null;
      // No media work, coding or analysis is spent on ignored buckets.
      if (isIgnoredBucket(bucketOf(f))) return null;
      const needsMedia = !s.hasMedia || (isVideo(f) && !s.hasTranscript);
      // Coding reads a transcript or hook frames; a thumbnail alone gives the model nothing to code.
      const needsCoding = !s.coded && (s.hasTranscript || s.hasFrames);
      const wanted = opts.stage === 'media' ? needsMedia : needsCoding;
      if (!wanted) return null;
      const { tier, reason } = tierFor(f, now);
      return {
        fact: f,
        item: {
          contentId: f.contentId,
          externalId: s.externalId,
          title: f.title,
          tier,
          reason,
          corpusClass: corpusClass(f),
          label: f.label,
          score: f.score,
          publishedAt: f.publishedAt,
          franchise: f.franchiseName,
          needsMedia,
          needsCoding,
        } satisfies QueueItem,
      };
    })
    .filter((x): x is { fact: ContentFact; item: QueueItem } => x !== null)
    // Core interview content first, then posts not yet bucketed, then BBO Stamped; tier and recency within that.
    .sort((a, b) => bucketRank(bucketOf(a.fact)) - bucketRank(bucketOf(b.fact)) || a.item.tier - b.item.tier || (a.item.publishedAt < b.item.publishedAt ? 1 : -1));

  const franchiseCap = Math.max(4, Math.ceil(opts.limit * 0.35));
  const guestCap = 3;
  const perClass = { ...Object.fromEntries(Object.entries(status.classes).map(([k, v]) => [k, v.remaining])), other: Number.POSITIVE_INFINITY } as Record<CorpusClass, number>;
  const franchiseCount = new Map<string, number>();
  const guestCount = new Map<number, number>();
  const picked: QueueItem[] = [];
  const pickedIds = new Set<number>();

  const accept = (entry: { fact: ContentFact; item: QueueItem }, relaxed: boolean) => {
    if (pickedIds.has(entry.item.contentId)) return false;
    const guests = entry.fact.people.filter((p) => p.role === 'guest');
    if (!relaxed) {
      if (!opts.ignoreTargets && perClass[entry.item.corpusClass] <= 0) return false;
      if (entry.item.franchise && (franchiseCount.get(entry.item.franchise) ?? 0) >= franchiseCap) return false;
      if (guests.some((g) => (guestCount.get(g.id) ?? 0) >= guestCap)) return false;
    }
    picked.push(entry.item);
    pickedIds.add(entry.item.contentId);
    perClass[entry.item.corpusClass] = (perClass[entry.item.corpusClass] ?? 0) - 1;
    if (entry.item.franchise) franchiseCount.set(entry.item.franchise, (franchiseCount.get(entry.item.franchise) ?? 0) + 1);
    for (const g of guests) guestCount.set(g.id, (guestCount.get(g.id) ?? 0) + 1);
    return true;
  };

  // Bucket priority dominates: core interview content fills the run first, then
  // posts not yet bucketed, then BBO Stamped. Inside each bucket the outcome
  // classes are interleaved, so a run that stops early (daily cap, API quota,
  // an interrupted job) still leaves a corpus that can contrast winners against
  // losers — not 40 winners and nothing to compare them with.
  const balanced: CorpusClass[] = ['winner', 'loser', 'average', 'unusual'];
  const takenOf = new Map<CorpusClass, number>(balanced.map((c) => [c, 0]));
  const ranks = [...new Set(candidates.map((c) => bucketRank(bucketOf(c.fact))))].sort((a, b) => a - b);

  for (const rank of ranks) {
    const group = candidates.filter((c) => bucketRank(bucketOf(c.fact)) === rank);
    const byClass = new Map<CorpusClass, Array<{ fact: ContentFact; item: QueueItem }>>(balanced.map((c) => [c, []]));
    for (const entry of group) byClass.get(entry.item.corpusClass)?.push(entry);
    const cursor = new Map<CorpusClass, number>(balanced.map((c) => [c, 0]));
    while (picked.length < opts.limit) {
      let best: CorpusClass | null = null;
      let bestShare = Number.POSITIVE_INFINITY;
      for (const cls of balanced) {
        const weight = opts.ignoreTargets ? 1 : status.classes[cls].remaining;
        if (weight <= 0 || (cursor.get(cls) ?? 0) >= (byClass.get(cls)?.length ?? 0)) continue;
        const share = (takenOf.get(cls) ?? 0) / weight;
        if (share < bestShare) {
          bestShare = share;
          best = cls;
        }
      }
      if (!best) break;
      const list = byClass.get(best)!;
      let i = cursor.get(best)!;
      let took = false;
      while (i < list.length && !took) {
        took = accept(list[i], false);
        i++;
      }
      cursor.set(best, i);
      if (took) takenOf.set(best, (takenOf.get(best) ?? 0) + 1);
    }
  }

  // Targets met, caps hit, or nothing left in a class: fill the rest in plain
  // priority order rather than under-using the run.
  for (const entry of candidates) {
    if (picked.length >= opts.limit) break;
    accept(entry, true);
  }
  return picked;
}

/** Posts processed today, for the daily throughput caps. */
export function processedToday(db: Db, column: 'media_fetched_at' | 'coded_at', now = new Date()): number {
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  return get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM content WHERE ${column} >= ?`, midnight)?.n ?? 0;
}

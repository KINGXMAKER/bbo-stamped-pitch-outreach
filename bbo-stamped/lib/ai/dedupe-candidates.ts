import type { Shot } from '@/types';

/**
 * Finding duplicate camera setups used to be one open question to the model:
 * "here are 28 shots, which are the same?". It reliably answered "none" — the
 * task is a quadratic comparison dressed up as a reading exercise, and the safe
 * answer is always to merge nothing.
 *
 * So the search is done here instead. This narrows the field to the handful of
 * pairs that could plausibly be one setup, and the model is then asked a much
 * easier question about each one: same setup, yes or no. Recall is deterministic;
 * only the judgement call is delegated.
 */

export type CandidatePair = { a: Shot; b: Shot; score: number };

/** Words that say nothing about whether two setups are the same. */
const NOISE = new Set([
  'the', 'a', 'an', 'of', 'and', 'at', 'in', 'on', 'to', 'for', 'with', 'from',
  'shot', 'close', 'closeup', 'up', 'wide', 'macro', 'clip', 'footage', 'bbo',
]);

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((word) => word.replace(/(ing|ed|s)$/, ''))
      .filter((word) => word.length > 2 && !NOISE.has(word))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Everything about a shot that hints at what the camera is actually doing. */
function fingerprint(shot: Shot): Set<string> {
  return tokens(
    [shot.title, shot.subject, shot.description, shot.camera?.framing, shot.onCamera]
      .filter(Boolean)
      .join(' ')
  );
}

const SAME_SETUP_FLOOR = 0.2;

/**
 * Pairs worth asking about. Two shots only qualify when they sit in the same
 * zone — a crew cannot film one setup in two places — and share enough
 * vocabulary to be describing the same moment.
 *
 * Shots already serving the same Reel are skipped: the per-Reel pass merged
 * those itself, and re-merging them would collapse deliberate coverage.
 */
export function findCandidatePairs(shots: Shot[], limit = 24): CandidatePair[] {
  const pairs: CandidatePair[] = [];

  for (let i = 0; i < shots.length; i++) {
    for (let j = i + 1; j < shots.length; j++) {
      const a = shots[i];
      const b = shots[j];

      if ((a.zoneId || '') !== (b.zoneId || '')) continue;

      const reelsA = new Set(a.reelUsages.map((usage) => usage.reelId));
      const sharesAReel = b.reelUsages.some((usage) => reelsA.has(usage.reelId));
      if (sharesAReel) continue;

      const score = jaccard(fingerprint(a), fingerprint(b));
      if (score < SAME_SETUP_FLOOR) continue;

      pairs.push({ a, b, score });
    }
  }

  return pairs.sort((x, y) => y.score - x.score).slice(0, limit);
}

/**
 * Turns confirmed pairs into merge groups. Transitive: if A matches B and B
 * matches C, all three become one setup, so the crew is never told to shoot a
 * chain of the same moment.
 */
export function pairsToGroups(
  confirmed: Array<{ aId: string; bId: string }>
): Array<{ keepId: string; duplicateIds: string[] }> {
  const parent = new Map<string, string>();

  const find = (id: string): string => {
    const seen = parent.get(id);
    if (seen === undefined || seen === id) return id;
    const root = find(seen);
    parent.set(id, root);
    return root;
  };

  for (const { aId, bId } of confirmed) {
    if (!parent.has(aId)) parent.set(aId, aId);
    if (!parent.has(bId)) parent.set(bId, bId);
    const rootA = find(aId);
    const rootB = find(bId);
    if (rootA !== rootB) parent.set(rootB, rootA);
  }

  const groups = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    const bucket = groups.get(root);
    if (bucket) bucket.push(id);
    else groups.set(root, [id]);
  }

  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([root, members]) => ({
      keepId: root,
      duplicateIds: members.filter((id) => id !== root),
    }));
}

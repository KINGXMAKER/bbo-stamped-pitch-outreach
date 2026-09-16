/**
 * Name normalisation for alias lookup. Two forms:
 *  - norm:    lowercase, accents/punctuation stripped, words kept ("bbo court")
 *  - squash:  norm without spaces ("bbocourt"), so "BBOCourt" and "BBO Court" meet
 */
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[._\-/]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function squash(norm: string): string {
  return norm.replace(/ /g, '');
}

export function slugify(raw: string): string {
  return normalizeName(raw).replace(/ /g, '-') || 'unnamed';
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0..1. Max of edit-distance ratio on squashed forms and word-set overlap. */
export function similarity(aNorm: string, bNorm: string): number {
  const a = squash(aNorm);
  const b = squash(bNorm);
  if (!a || !b) return 0;
  const editRatio = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  const aw = new Set(aNorm.split(' ').filter(Boolean));
  const bw = new Set(bNorm.split(' ').filter(Boolean));
  const inter = [...aw].filter((w) => bw.has(w)).length;
  const union = new Set([...aw, ...bw]).size;
  const jaccard = union ? inter / union : 0;
  return Math.max(editRatio, jaccard);
}

/** At or above this, a non-identical name is "probably the same" — a human must confirm. */
export const REVIEW_SIMILARITY = 0.8;

import type { ContentFact } from './dataset';

const WINNING = new Set(['BREAKOUT', 'WINNER', 'ABOVE_AVERAGE']);
const LOSING = new Set(['BELOW_AVERAGE', 'LOSER']);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/https?:\/\/\S+|@\S+|#\S+/g, ' ')
      .split(/[^a-z0-9']+/)
      .filter((w) => w.length > 3)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export type SimilarItem = { fact: ContentFact; similarity: number; shared: string[] };

/**
 * Transparent similarity: weighted overlap of franchise, guests, topics, hook
 * type, duration bucket, editing style, caption type and caption wording. Every
 * match lists what it shares, so "similar" is never a black box.
 */
export function similarity(a: ContentFact, b: ContentFact): { score: number; shared: string[] } {
  const shared: string[] = [];
  let score = 0;
  if (a.franchise && a.franchise === b.franchise) {
    score += 3;
    shared.push(`franchise: ${a.franchiseName ?? a.franchise}`);
  }
  const guestsA = new Set(a.people.filter((p) => p.role === 'guest').map((p) => p.id));
  for (const p of b.people) {
    if (p.role === 'guest' && guestsA.has(p.id)) {
      score += 3;
      shared.push(`guest: ${p.name}`);
    }
  }
  const topicsA = new Set(a.topics.map((t) => t.slug));
  for (const t of b.topics) {
    if (topicsA.has(t.slug)) {
      score += 2;
      shared.push(`topic: ${t.name}`);
    }
  }
  const attrWeights: Array<[string, number]> = [
    ['hook_type', 2],
    ['duration_bucket', 1],
    ['editing_style', 1],
    ['caption_type', 1],
    ['opening_speaker_role', 1],
    ['audit_lane', 1],
  ];
  for (const [key, weight] of attrWeights) {
    if (a.attrs[key] && a.attrs[key] === b.attrs[key]) {
      score += weight;
      shared.push(`${key.replace(/_/g, ' ')}: ${a.attrs[key].replace(/_/g, ' ')}`);
    }
  }
  const wording = jaccard(tokens(a.caption), tokens(b.caption));
  if (wording > 0.08) {
    score += Math.min(wording * 10, 3);
    shared.push('similar caption wording');
  }
  return { score, shared };
}

export function similarContent(facts: ContentFact[], target: ContentFact, k = 4): { winners: SimilarItem[]; losers: SimilarItem[] } {
  const ranked = facts
    .filter((f) => f.contentId !== target.contentId && f.isMature && f.score !== null)
    .map((fact) => {
      const s = similarity(target, fact);
      return { fact, similarity: s.score, shared: s.shared };
    })
    .filter((x) => x.similarity >= 2)
    .sort((a, b) => b.similarity - a.similarity);
  return {
    winners: ranked.filter((x) => WINNING.has(x.fact.label ?? '')).slice(0, k),
    losers: ranked.filter((x) => LOSING.has(x.fact.label ?? '')).slice(0, k),
  };
}

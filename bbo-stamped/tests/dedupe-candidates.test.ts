import { describe, expect, test } from 'vitest';
import { findCandidatePairs, pairsToGroups } from '@/lib/ai/dedupe-candidates';
import { makeShot } from './fixtures';

const shot = (over: Parameters<typeof makeShot>[0]) => makeShot(over);

describe('findCandidatePairs', () => {
  test('surfaces the same setup wearing two different titles', () => {
    const pairs = findCandidatePairs([
      shot({
        id: 'a',
        title: 'Bartender Cocktail Shake',
        zoneId: 'zone-bar',
        subject: 'bartender',
        description: 'bartender shakes the cocktail',
        reelUsages: [{ reelId: 'reel-1', beatId: 'b1' }],
      }),
      shot({
        id: 'b',
        title: 'Bartender Cocktail Slide',
        zoneId: 'zone-bar',
        subject: 'bartender',
        description: 'bartender slides the cocktail over',
        reelUsages: [{ reelId: 'reel-2', beatId: 'b1' }],
      }),
    ]);
    expect(pairs).toHaveLength(1);
    expect([pairs[0].a.id, pairs[0].b.id].sort()).toEqual(['a', 'b']);
  });

  test('never pairs shots in different zones — a crew cannot be in two places', () => {
    const pairs = findCandidatePairs([
      shot({
        id: 'a',
        title: 'Group toast',
        zoneId: 'zone-bar',
        subject: 'the group',
        reelUsages: [{ reelId: 'reel-1', beatId: 'b1' }],
      }),
      shot({
        id: 'b',
        title: 'Group toast',
        zoneId: 'zone-patio',
        subject: 'the group',
        reelUsages: [{ reelId: 'reel-2', beatId: 'b1' }],
      }),
    ]);
    expect(pairs).toHaveLength(0);
  });

  test('leaves shots already serving the same Reel alone', () => {
    // The per-Reel pass merged those itself; re-merging would collapse
    // coverage it deliberately kept separate.
    const pairs = findCandidatePairs([
      shot({
        id: 'a',
        title: 'Cocktail pour',
        zoneId: 'zone-bar',
        subject: 'bartender',
        reelUsages: [{ reelId: 'reel-1', beatId: 'b1' }],
      }),
      shot({
        id: 'b',
        title: 'Cocktail pour macro',
        zoneId: 'zone-bar',
        subject: 'bartender',
        reelUsages: [{ reelId: 'reel-1', beatId: 'b2' }],
      }),
    ]);
    expect(pairs).toHaveLength(0);
  });

  test('ignores shots that merely share a zone', () => {
    const pairs = findCandidatePairs([
      shot({
        id: 'a',
        title: 'Exterior signage',
        zoneId: 'zone-bar',
        subject: 'sign',
        description: 'neon sign outside',
        reelUsages: [{ reelId: 'reel-1', beatId: 'b1' }],
      }),
      shot({
        id: 'b',
        title: 'First bite reaction',
        zoneId: 'zone-bar',
        subject: 'creator',
        description: 'creator tastes the burger',
        reelUsages: [{ reelId: 'reel-2', beatId: 'b1' }],
      }),
    ]);
    expect(pairs).toHaveLength(0);
  });
});

describe('pairsToGroups', () => {
  test('chains transitive matches into one setup', () => {
    const groups = pairsToGroups([
      { aId: 'a', bId: 'b' },
      { aId: 'b', bId: 'c' },
    ]);
    expect(groups).toHaveLength(1);
    expect([groups[0].keepId, ...groups[0].duplicateIds].sort()).toEqual(['a', 'b', 'c']);
  });

  test('keeps unrelated matches in separate groups', () => {
    expect(pairsToGroups([{ aId: 'a', bId: 'b' }, { aId: 'c', bId: 'd' }])).toHaveLength(2);
  });

  test('returns nothing when nothing was confirmed', () => {
    expect(pairsToGroups([])).toEqual([]);
  });
});

describe('shot ids across Reels', () => {
  test('two shots that happen to share an id are never treated as a pair', () => {
    // Each per-Reel pass numbers from "shot-1", so ids collide before the
    // pipeline namespaces them. A pair of one shot with itself is meaningless.
    const pairs = findCandidatePairs([
      shot({
        id: 'reel-1--shot-1',
        title: 'Outdoor patio wide',
        zoneId: 'zone-patio',
        subject: 'patio',
        description: 'wide of the patio seating',
        reelUsages: [{ reelId: 'reel-1', beatId: 'b1' }],
      }),
      shot({
        id: 'reel-2--shot-1',
        title: 'Outdoor patio vibe',
        zoneId: 'zone-patio',
        subject: 'patio',
        description: 'patio seating and ambience',
        reelUsages: [{ reelId: 'reel-2', beatId: 'b1' }],
      }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].a.id).not.toBe(pairs[0].b.id);
  });
});

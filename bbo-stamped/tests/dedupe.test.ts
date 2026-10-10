import { describe, expect, test } from 'vitest';
import { applyDedupe } from '@/lib/ai/shot-pipeline';
import { ShotDedupeSchema } from '@/lib/ai/schemas';
import { makeShot } from './fixtures';

describe('ShotDedupeSchema', () => {
  test('an empty groups list is valid — nothing overlapped', () => {
    expect(ShotDedupeSchema.parse({}).groups).toEqual([]);
  });

  test('rejects a group with no duplicates to merge', () => {
    expect(
      ShotDedupeSchema.safeParse({ groups: [{ keepId: 'a', duplicateIds: [] }] }).success
    ).toBe(false);
  });
});

describe('applyDedupe', () => {
  test('merges Reel usages onto the surviving shot', () => {
    const shots = [
      makeShot({
        id: 'reel-1-shot-1',
        title: 'Bar wide',
        reelUsages: [{ reelId: 'reel-1', beatId: 'reel-1-beat-1' }],
      }),
      makeShot({
        id: 'reel-2-shot-4',
        title: 'Wide of the bar',
        reelUsages: [{ reelId: 'reel-2', beatId: 'reel-2-beat-2' }],
      }),
    ];

    const merged = applyDedupe(shots, [
      { keepId: 'reel-1-shot-1', duplicateIds: ['reel-2-shot-4'] },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('reel-1-shot-1');
    expect(merged[0].reelUsages).toEqual([
      { reelId: 'reel-1', beatId: 'reel-1-beat-1' },
      { reelId: 'reel-2', beatId: 'reel-2-beat-2' },
    ]);
  });

  test('the survivor inherits the strictest requirements of the group', () => {
    const shots = [
      makeShot({
        id: 'keep',
        priority: 'strong',
        clientRequired: false,
        recommendedTakeCount: 2,
        minimumUsefulDuration: 5,
        onCamera: 'creator',
        sourcePhotoIds: ['photo-1'],
      }),
      makeShot({
        id: 'drop',
        priority: 'must',
        clientRequired: true,
        recommendedTakeCount: 4,
        minimumUsefulDuration: 9,
        onCamera: 'the group',
        sourcePhotoIds: ['photo-2'],
        reelUsages: [{ reelId: 'reel-2', beatId: 'reel-2-beat-1' }],
      }),
    ];

    const merged = applyDedupe(shots, [{ keepId: 'keep', duplicateIds: ['drop'] }]);
    const survivor = merged[0];

    expect(survivor.priority).toBe('must');
    expect(survivor.clientRequired).toBe(true);
    expect(survivor.recommendedTakeCount).toBe(4);
    expect(survivor.minimumUsefulDuration).toBe(9);
    expect(survivor.onCamera).toBe('the group');
    expect(survivor.sourcePhotoIds).toEqual(['photo-1', 'photo-2']);
  });

  test('ignores ids the model invented', () => {
    const shots = [makeShot({ id: 'a' }), makeShot({ id: 'b' })];
    const merged = applyDedupe(shots, [
      { keepId: 'ghost', duplicateIds: ['a'] },
      { keepId: 'a', duplicateIds: ['also-not-real'] },
    ]);
    expect(merged.map((shot) => shot.id)).toEqual(['a', 'b']);
  });

  test('never drops a shot twice across overlapping groups', () => {
    const shots = [makeShot({ id: 'a' }), makeShot({ id: 'b' }), makeShot({ id: 'c' })];
    const merged = applyDedupe(shots, [
      { keepId: 'a', duplicateIds: ['b'] },
      { keepId: 'b', duplicateIds: ['c'] },
    ]);
    // b is already gone, so its group is skipped and c survives.
    expect(merged.map((shot) => shot.id)).toEqual(['a', 'c']);
  });

  test('a shot may not be merged into itself', () => {
    const shots = [makeShot({ id: 'a' })];
    expect(applyDedupe(shots, [{ keepId: 'a', duplicateIds: ['a'] }])).toHaveLength(1);
  });

  test('no groups means nothing is lost', () => {
    const shots = [makeShot({ id: 'a' }), makeShot({ id: 'b' })];
    expect(applyDedupe(shots, [])).toHaveLength(2);
  });
});

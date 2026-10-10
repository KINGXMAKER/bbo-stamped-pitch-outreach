import { describe, expect, test } from 'vitest';
import { mergeReels, mergeShots, mergeSkits, skitToShots } from '@/lib/storage/activation';
import { makeReel, makeShot, makeSkit } from './fixtures';

describe('mergeReels', () => {
  test('a locked Reel survives regeneration untouched', () => {
    const existing = [
      makeReel({ id: 'reel-1', title: 'Locked hero', locked: true }),
      makeReel({ id: 'reel-2', title: 'Old lifestyle' }),
    ];
    const incoming = [
      makeReel({ id: 'reel-1', title: 'Rewritten hero' }),
      makeReel({ id: 'reel-2', title: 'New lifestyle' }),
    ];

    const merged = mergeReels(existing, incoming);
    expect(merged.find((reel) => reel.id === 'reel-1')?.title).toBe('Locked hero');
    expect(merged.find((reel) => reel.id === 'reel-2')?.title).toBe('New lifestyle');
  });

  test('a rewritten Reel keeps the selection the operator already made', () => {
    const existing = [makeReel({ id: 'reel-2', selected: true })];
    const incoming = [makeReel({ id: 'reel-2', title: 'Fresh', selected: false })];
    expect(mergeReels(existing, incoming)[0].selected).toBe(true);
  });
});

describe('mergeShots', () => {
  test('captured, locked and client shots all survive regeneration', () => {
    const existing = [
      makeShot({ id: 'shot-done', title: 'Captured', completed: true }),
      makeShot({ id: 'shot-locked', title: 'Locked', locked: true }),
      makeShot({ id: 'shot-client', title: 'Client wings', clientRequired: true }),
      makeShot({ id: 'shot-free', title: 'Old filler' }),
    ];
    const incoming = [
      makeShot({ id: 'shot-done', title: 'Overwritten' }),
      makeShot({ id: 'shot-locked', title: 'Overwritten' }),
      makeShot({ id: 'shot-client', title: 'Overwritten' }),
      makeShot({ id: 'shot-free', title: 'New filler' }),
    ];

    const merged = mergeShots(existing, incoming);
    const byId = new Map(merged.map((shot) => [shot.id, shot]));

    expect(byId.get('shot-done')?.title).toBe('Captured');
    expect(byId.get('shot-done')?.completed).toBe(true);
    expect(byId.get('shot-locked')?.title).toBe('Locked');
    expect(byId.get('shot-client')?.title).toBe('Client wings');
    expect(byId.get('shot-free')?.title).toBe('New filler');
    expect(merged).toHaveLength(4);
  });

  test('brand new shots from a regeneration are added', () => {
    const merged = mergeShots([makeShot({ id: 'a', completed: true })], [makeShot({ id: 'b' })]);
    expect(merged.map((shot) => shot.id).sort()).toEqual(['a', 'b']);
  });
});

describe('mergeSkits', () => {
  test('locked skits and skits already added to the shoot are preserved', () => {
    const existing = [
      makeSkit({ id: 'skit-1', title: 'Locked', locked: true }),
      makeSkit({ id: 'skit-2', title: 'In the list', addedToShoot: true }),
      makeSkit({ id: 'skit-3', title: 'Disposable' }),
    ];
    const incoming = [
      makeSkit({ id: 'skit-1', title: 'Rewritten' }),
      makeSkit({ id: 'skit-2', title: 'Rewritten' }),
      makeSkit({ id: 'skit-4', title: 'Brand new' }),
    ];

    const merged = mergeSkits(existing, incoming);
    const titles = merged.map((skit) => skit.title);
    expect(titles).toContain('Locked');
    expect(titles).toContain('In the list');
    expect(titles).toContain('Brand new');
    expect(titles).not.toContain('Disposable');
  });
});

describe('skitToShots', () => {
  test('turns each beat into a shot and never duplicates on a second add', () => {
    const skit = makeSkit({
      beats: [
        { order: 1, action: 'She walks up', shotDirection: 'Wide' },
        { order: 2, action: 'Someone is in her seat', shotDirection: 'Reverse' },
      ],
    });

    const first = skitToShots(skit, []);
    expect(first).toHaveLength(2);
    expect(first[0].category).toBe('skit');
    expect(first[0].priority).toBe('must');
    expect(first[1].priority).toBe('strong');

    expect(skitToShots(skit, first)).toHaveLength(0);
  });
});

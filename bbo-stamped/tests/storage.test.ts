import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  deleteActivation,
  duplicateActivation,
  listActivations,
  loadActivation,
  saveActivation,
} from '@/lib/storage/db';
import { createActivation, migrateActivation } from '@/lib/storage/activation';
import { makeActivation, makeShot } from './fixtures';

describe('createActivation', () => {
  test('trims input and leaves blank optionals undefined', () => {
    const activation = createActivation({
      name: '  The Patio  ',
      city: '  ',
      instagram: '@thepatio',
      clientRequirements: ['Wings'],
    });

    expect(activation.business.name).toBe('The Patio');
    expect(activation.business.city).toBeUndefined();
    expect(activation.business.instagram).toBe('@thepatio');
    expect(activation.reels).toEqual([]);
  });
});

describe('saved activation persistence', () => {
  beforeEach(async () => {
    for (const item of await listActivations()) await deleteActivation(item.id);
  });

  test('round-trips a full activation including coverage state', async () => {
    const activation = makeActivation({
      id: 'act-persist',
      shots: [makeShot({ id: 'a', completed: true, note: 'second take' })],
      verdict: { value: 'stamped', notes: 'Worth it' },
    });

    await saveActivation(activation);
    const loaded = await loadActivation('act-persist');

    expect(loaded).not.toBeNull();
    expect(loaded?.business.name).toBe('The Patio');
    expect(loaded?.shots[0].completed).toBe(true);
    expect(loaded?.shots[0].note).toBe('second take');
    expect(loaded?.verdict?.value).toBe('stamped');
    expect(loaded?.reels[0].sequence).toHaveLength(2);
  });

  test('saving stamps updatedAt so the list sorts newest first', async () => {
    const older = makeActivation({ id: 'act-old', updatedAt: '2020-01-01T00:00:00.000Z' });
    await saveActivation(older);
    await saveActivation(makeActivation({ id: 'act-new' }));

    const list = await listActivations();
    expect(list[0].id).toBe('act-new');
    expect(list.map((item) => item.id)).toContain('act-old');
    expect(new Date(list[0].updatedAt).getTime()).toBeGreaterThan(0);
  });

  test('a duplicate is a fresh, uncaptured copy', async () => {
    await saveActivation(
      makeActivation({
        id: 'act-src',
        shots: [makeShot({ id: 'a', completed: true })],
        verdict: { value: 'clipped' },
      })
    );

    const copy = await duplicateActivation('act-src', 'act-copy');
    expect(copy?.id).toBe('act-copy');
    expect(copy?.business.name).toBe('The Patio (copy)');
    expect(copy?.shots[0].completed).toBe(false);
    expect(copy?.verdict).toBeUndefined();

    // The source is untouched.
    const source = await loadActivation('act-src');
    expect(source?.shots[0].completed).toBe(true);
  });

  test('deleting removes it from the list', async () => {
    await saveActivation(makeActivation({ id: 'act-gone' }));
    await deleteActivation('act-gone');
    expect(await loadActivation('act-gone')).toBeNull();
  });

  test('loading an unknown id returns null rather than throwing', async () => {
    expect(await loadActivation('nope')).toBeNull();
  });
});

describe('migrateActivation — older saved projects', () => {
  // A project saved before casting became a shoot-day decision. It must open
  // without crashing, and must not drag the old roster back into the app.
  const legacy = {
    id: 'act-legacy',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    business: { name: 'The Patio' },
    clientRequirements: [],
    photos: [],
    talent: [
      { id: 'talent-1', name: 'Talent 1', role: 'BBO Talent' },
      { id: 'talent-2', name: 'Talent 2', role: 'BBO Talent' },
    ],
    releaseCapture: { signed: ['talent-1'] },
    reels: [],
    shots: [
      { id: 's1', title: 'Solo piece to camera', talentIds: ['talent-1'], reelUsages: [] },
      { id: 's2', title: 'Group toast', talentIds: ['talent-1', 'talent-2'], reelUsages: [] },
    ],
    photoPlan: [{ id: 'p1', title: 'Group hero', talentIds: ['talent-1', 'talent-2'] }],
    skits: [],
    editBlueprints: [],
    generationMeta: {},
  };

  test('drops the roster and the release-capture data', () => {
    const migrated = migrateActivation(legacy) as unknown as Record<string, unknown>;
    expect(migrated).not.toHaveProperty('talent');
    expect(migrated).not.toHaveProperty('releaseCapture');
  });

  test('folds numbered talent ids into plain on-camera direction', () => {
    const migrated = migrateActivation(legacy)!;
    expect(migrated.shots[0].onCamera).toBe('creator');
    expect(migrated.shots[1].onCamera).toBe('the group');
    expect(migrated.photoPlan[0].onCamera).toBe('the group');
    expect(migrated.shots[0]).not.toHaveProperty('talentIds');
  });

  test('backfills fields added after the project was saved', () => {
    const migrated = migrateActivation(legacy)!;
    expect(migrated.kitchenAccess).toBe('unknown');
    expect(migrated.editBlueprints).toEqual([]);
  });

  test('refuses junk rather than handing back a broken activation', () => {
    expect(migrateActivation(null)).toBeNull();
    expect(migrateActivation({ nope: true })).toBeNull();
  });
});

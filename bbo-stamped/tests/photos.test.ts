import { describe, expect, test } from 'vitest';
import {
  computeActivationCoverage,
  computePhotoCoverage,
  isPerishable,
  pickNextBestCapture,
  requiredPhotos,
  runLeaveCheck,
} from '@/lib/coverage';
import { mergePhotos } from '@/lib/storage/activation';
import { PhotoPlanSchema } from '@/lib/ai/schemas';
import { makeActivation, makeBeat, makePhoto, makeReel, makeShot } from './fixtures';

describe('PhotoPlanSchema', () => {
  test('defaults the app-managed flags and timing', () => {
    const parsed = PhotoPlanSchema.parse({
      photos: [{ id: 'photo-shot-1', title: 'Hero plate' }],
    });
    const photo = parsed.photos[0];
    expect(photo.completed).toBe(false);
    expect(photo.locked).toBe(false);
    expect(photo.clientRequired).toBe(false);
    expect(photo.timing).toBe('anytime');
    expect(photo.camera.orientation).toBe('vertical');
  });

  test('rejects an unknown timing value rather than guessing', () => {
    const bad = { photos: [{ id: 'p', title: 't', timing: 'whenever' }] };
    expect(PhotoPlanSchema.safeParse(bad).success).toBe(false);
  });

  test('rejects an empty photo plan', () => {
    expect(PhotoPlanSchema.safeParse({ photos: [] }).success).toBe(false);
  });
});

describe('photo coverage', () => {
  test('optional photos do not count unless the client asked for them', () => {
    const photos = [
      makePhoto({ id: 'a', priority: 'must' }),
      makePhoto({ id: 'b', priority: 'strong' }),
      makePhoto({ id: 'c', priority: 'optional' }),
      makePhoto({ id: 'd', priority: 'optional', clientRequired: true }),
    ];
    expect(requiredPhotos(photos).map((photo) => photo.id)).toEqual(['a', 'b', 'd']);
  });

  test('completes only when every required frame is shot', () => {
    const photos = [
      makePhoto({ id: 'a', completed: true }),
      makePhoto({ id: 'b', priority: 'strong' }),
      makePhoto({ id: 'c', priority: 'optional' }),
    ];

    const coverage = computePhotoCoverage(photos);
    expect(coverage.percent).toBe(50);
    expect(coverage.complete).toBe(false);
    expect(coverage.missingRequired.map((photo) => photo.id)).toEqual(['b']);

    const done = computePhotoCoverage(
      photos.map((photo) => (photo.priority === 'optional' ? photo : { ...photo, completed: true }))
    );
    expect(done.complete).toBe(true);
    expect(done.percent).toBe(100);
  });

  test('flags the frames that stop existing if you wait', () => {
    const photos = [
      makePhoto({ id: 'hero', timing: 'food-untouched' }),
      makePhoto({ id: 'empty-room', timing: 'before-service' }),
      makePhoto({ id: 'later', timing: 'anytime' }),
      makePhoto({ id: 'shot-already', timing: 'food-untouched', completed: true }),
    ];
    expect(isPerishable(photos[0])).toBe(true);
    expect(isPerishable(photos[2])).toBe(false);
    expect(computePhotoCoverage(photos).perishableRemaining.map((photo) => photo.id)).toEqual([
      'hero',
      'empty-room',
    ]);
  });

  test('activation coverage counts photos alongside video', () => {
    const activation = makeActivation({
      shots: [makeShot({ id: 's1', completed: true })],
      photoPlan: [
        makePhoto({ id: 'p1', completed: true }),
        makePhoto({ id: 'p2', priority: 'must' }),
        makePhoto({ id: 'p3', priority: 'optional', clientRequired: true }),
      ],
    });

    const coverage = computeActivationCoverage(activation);
    expect(coverage.percent).toBe(50); // 2 of 4 captures
    expect(coverage.mustRemaining).toBe(1);
    expect(coverage.clientRemaining).toBe(1);
    expect(coverage.photos.requiredTotal).toBe(3);
  });
});

describe('next best capture — food shoot', () => {
  const foodActivation = (overrides = {}) =>
    makeActivation({
      kitchenAccess: 'approved',
      shots: [
        makeShot({
          id: 'optional-broll',
          title: 'Room B-roll',
          priority: 'optional',
          zoneId: 'zone-bar',
          reelUsages: [],
        }),
      ],
      photoPlan: [
        makePhoto({
          id: 'hero-food',
          title: 'Hero dish before bites',
          category: 'hero-food',
          timing: 'food-untouched',
          zoneId: 'zone-table',
        }),
      ],
      ...overrides,
    });

  test('once food is out, the untouched frame beats optional B-roll', () => {
    const pick = pickNextBestCapture(foodActivation(), {
      serviceStarted: true,
      currentZoneId: 'zone-bar',
    });

    expect(pick?.kind).toBe('photo');
    expect(pick?.id).toBe('hero-food');
    expect(pick?.reasons.join(' ')).toContain('before bites');
  });

  test('a client must-have still outranks the perishable food frame', () => {
    const activation = foodActivation({
      shots: [
        makeShot({
          id: 'client-shot',
          title: 'Signature wings on camera',
          priority: 'must',
          clientRequired: true,
          zoneId: 'zone-table',
        }),
      ],
    });

    const pick = pickNextBestCapture(activation, { serviceStarted: true });
    expect(pick?.id).toBe('client-shot');
    expect(pick?.reasons).toContain('Client must-have');
  });

  test('reel-critical footage outranks an ordinary strong photo', () => {
    const activation = makeActivation({
      shots: [makeShot({ id: 'must-shot', priority: 'must' })],
      photoPlan: [makePhoto({ id: 'nice-photo', priority: 'strong', timing: 'anytime' })],
    });

    const pick = pickNextBestCapture(activation, {});
    expect(pick?.id).toBe('must-shot');
    expect(pick?.reasons.join(' ')).toContain('Reel-critical');
  });

  test('the group hero is urgent only while everyone is present', () => {
    const activation = makeActivation({
      shots: [],
      photoPlan: [
        makePhoto({ id: 'group', category: 'group-hero', priority: 'strong', timing: 'anytime' }),
        makePhoto({ id: 'detail', category: 'detail', priority: 'strong', timing: 'anytime' }),
      ],
    });

    expect(pickNextBestCapture(activation, { groupPresent: true })?.id).toBe('group');
    expect(
      pickNextBestCapture(activation, { groupPresent: true })?.reasons.join(' ')
    ).toContain('Whole group is present');
  });

  test('a process window is only urgent when kitchen access was approved', () => {
    const withAccess = makeActivation({
      kitchenAccess: 'approved',
      shots: [],
      photoPlan: [
        makePhoto({ id: 'plating', category: 'process', priority: 'strong', timing: 'anytime' }),
        makePhoto({ id: 'venue', category: 'venue', priority: 'strong', timing: 'anytime' }),
      ],
    });
    expect(pickNextBestCapture(withAccess, {})?.id).toBe('plating');

    const withoutAccess = makeActivation({
      ...withAccess,
      kitchenAccess: 'denied',
    });
    // With no access the process frame loses its bonus and no longer wins.
    expect(pickNextBestCapture(withoutAccess, {})?.reasons.join(' ')).not.toContain(
      'Process window'
    );
  });

  test('returns null when every capture is done', () => {
    const activation = makeActivation({
      shots: [makeShot({ completed: true })],
      photoPlan: [makePhoto({ completed: true })],
    });
    expect(pickNextBestCapture(activation, {})).toBeNull();
  });
});

describe('leave check with photos', () => {
  const reel = makeReel({ sequence: [makeBeat('reel-1-beat-1', 0, 'Hook')] });

  test('a missing group hero photo blocks leaving', () => {
    const activation = makeActivation({
      reels: [reel],
      shots: [makeShot({ id: 'a', completed: true })],
      photoPlan: [makePhoto({ id: 'group', title: 'Group hero', category: 'group-hero' })],
      verdict: { value: 'stamped' },
    });

    const result = runLeaveCheck(activation);
    expect(result.clear).toBe(false);
    expect(result.blockers.some((b) => b.kind === 'photo' && b.title === 'Group hero')).toBe(true);
  });

  test('a client-required photo is reported as a client request', () => {
    const activation = makeActivation({
      reels: [reel],
      shots: [makeShot({ id: 'a', completed: true })],
      photoPlan: [
        makePhoto({ id: 'wings', title: 'Signature wings', priority: 'optional', clientRequired: true }),
      ],
      verdict: { value: 'stamped' },
    });

    const result = runLeaveCheck(activation);
    expect(result.blockers.some((b) => b.kind === 'client' && b.title === 'Signature wings')).toBe(
      true
    );
  });

  test('optional photos never block leaving', () => {
    const activation = makeActivation({
      reels: [reel],
      shots: [makeShot({ id: 'a', completed: true })],
      photoPlan: [
        makePhoto({ id: 'required', priority: 'must', completed: true }),
        makePhoto({ id: 'nice-to-have', priority: 'optional' }),
      ],
      verdict: { value: 'stamped' },
    });

    const result = runLeaveCheck(activation);
    expect(result.clear).toBe(true);
  });
});

describe('mergePhotos', () => {
  test('shot, locked and client photos survive regeneration', () => {
    const existing = [
      makePhoto({ id: 'done', title: 'Already shot', completed: true }),
      makePhoto({ id: 'locked', title: 'Locked frame', locked: true }),
      makePhoto({ id: 'client', title: 'Client wings', clientRequired: true }),
      makePhoto({ id: 'free', title: 'Old idea' }),
    ];
    const incoming = [
      makePhoto({ id: 'done', title: 'Overwritten' }),
      makePhoto({ id: 'locked', title: 'Overwritten' }),
      makePhoto({ id: 'client', title: 'Overwritten' }),
      makePhoto({ id: 'free', title: 'New idea' }),
      makePhoto({ id: 'brand-new', title: 'Brand new' }),
    ];

    const merged = mergePhotos(existing, incoming);
    const byId = new Map(merged.map((photo) => [photo.id, photo]));

    expect(byId.get('done')?.title).toBe('Already shot');
    expect(byId.get('done')?.completed).toBe(true);
    expect(byId.get('locked')?.title).toBe('Locked frame');
    expect(byId.get('client')?.title).toBe('Client wings');
    expect(byId.get('free')?.title).toBe('New idea');
    expect(byId.get('brand-new')?.title).toBe('Brand new');
  });
});

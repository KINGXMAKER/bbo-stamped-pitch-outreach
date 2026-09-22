import { describe, expect, test } from 'vitest';
import {
  computeActivationCoverage,
  computeReelCoverage,
  coverageMultiplier,
  groupShotsByZone,
  pickNextBestShot,
  requiredShotsForReel,
  runLeaveCheck,
} from '@/lib/coverage';
import { makeActivation, makeBeat, makeReel, makeShot } from './fixtures';

describe('required shots', () => {
  test('optional shots are not required unless the client asked for them', () => {
    const shots = [
      makeShot({ id: 'a', priority: 'must' }),
      makeShot({ id: 'b', priority: 'strong' }),
      makeShot({ id: 'c', priority: 'optional' }),
      makeShot({ id: 'd', priority: 'optional', clientRequired: true }),
    ];

    const required = requiredShotsForReel('reel-1', shots).map((shot) => shot.id);
    expect(required).toEqual(['a', 'b', 'd']);
  });

  test('a shot linked to another Reel does not count', () => {
    const shots = [
      makeShot({ id: 'a' }),
      makeShot({ id: 'b', reelUsages: [{ reelId: 'reel-2', beatId: 'reel-2-beat-1' }] }),
    ];
    expect(requiredShotsForReel('reel-1', shots).map((shot) => shot.id)).toEqual(['a']);
  });
});

describe('reel coverage', () => {
  test('percentage tracks completed required shots', () => {
    const reel = makeReel();
    const shots = [
      makeShot({ id: 'a', completed: true }),
      makeShot({ id: 'b', reelUsages: [{ reelId: 'reel-1', beatId: 'reel-1-beat-2' }] }),
    ];

    const coverage = computeReelCoverage(reel, shots);
    expect(coverage.percent).toBe(50);
    expect(coverage.readyToEdit).toBe(false);
    expect(coverage.missingRequired.map((shot) => shot.id)).toEqual(['b']);
  });

  test('a Reel with no linked shots reads 0 percent, never 100', () => {
    expect(computeReelCoverage(makeReel(), []).percent).toBe(0);
  });

  test('ready to edit needs every required shot AND every beat covered', () => {
    const reel = makeReel();

    // Both required shots done, but both are pinned to beat 1 — beat 2 is bare.
    const beatOneOnly = [
      makeShot({ id: 'a', completed: true }),
      makeShot({ id: 'b', completed: true }),
    ];
    const partial = computeReelCoverage(reel, beatOneOnly);
    expect(partial.percent).toBe(100);
    expect(partial.readyToEdit).toBe(false);
    expect(partial.uncoveredBeats.map((beat) => beat.beatId)).toEqual(['reel-1-beat-2']);

    const complete = [
      makeShot({ id: 'a', completed: true }),
      makeShot({
        id: 'b',
        completed: true,
        reelUsages: [{ reelId: 'reel-1', beatId: 'reel-1-beat-2' }],
      }),
    ];
    expect(computeReelCoverage(reel, complete).readyToEdit).toBe(true);
  });

  test('an uncompleted optional shot never blocks readiness', () => {
    const reel = makeReel();
    const shots = [
      makeShot({ id: 'a', completed: true }),
      makeShot({
        id: 'b',
        completed: true,
        reelUsages: [{ reelId: 'reel-1', beatId: 'reel-1-beat-2' }],
      }),
      makeShot({ id: 'extra', priority: 'optional', completed: false }),
    ];
    expect(computeReelCoverage(reel, shots).readyToEdit).toBe(true);
  });
});

describe('shared shots', () => {
  test('one setup serving three selected Reels reports a 3x multiplier', () => {
    const shot = makeShot({
      reelUsages: [
        { reelId: 'reel-1', beatId: 'reel-1-beat-1' },
        { reelId: 'reel-2', beatId: 'reel-2-beat-1' },
        { reelId: 'reel-3', beatId: 'reel-3-beat-1' },
      ],
    });
    expect(coverageMultiplier(shot, new Set(['reel-1', 'reel-2', 'reel-3']))).toBe(3);
  });

  test('usages on Reels we are not shooting do not inflate the multiplier', () => {
    const shot = makeShot({
      reelUsages: [
        { reelId: 'reel-1', beatId: 'reel-1-beat-1' },
        { reelId: 'reel-9', beatId: 'reel-9-beat-1' },
      ],
    });
    expect(coverageMultiplier(shot, new Set(['reel-1']))).toBe(1);
  });

  test('two beats of the same Reel are one Reel, not two', () => {
    const shot = makeShot({
      reelUsages: [
        { reelId: 'reel-1', beatId: 'reel-1-beat-1' },
        { reelId: 'reel-1', beatId: 'reel-1-beat-2' },
      ],
    });
    expect(coverageMultiplier(shot, new Set(['reel-1']))).toBe(1);
  });
});

describe('activation coverage', () => {
  test('counts outstanding must and client shots', () => {
    const activation = makeActivation({
      shots: [
        makeShot({ id: 'a', priority: 'must', completed: true }),
        makeShot({ id: 'b', priority: 'must' }),
        makeShot({ id: 'c', priority: 'optional', clientRequired: true }),
      ],
    });

    const coverage = computeActivationCoverage(activation);
    expect(coverage.mustRemaining).toBe(1);
    expect(coverage.clientRemaining).toBe(1);
    expect(coverage.percent).toBe(33);
  });
});

describe('next best shot', () => {
  test('a missing must shot outranks a convenient one in the current zone', () => {
    const activation = makeActivation({
      shots: [
        makeShot({ id: 'convenient', priority: 'strong', zoneId: 'zone-bar' }),
        makeShot({ id: 'critical', priority: 'must', zoneId: 'zone-patio' }),
      ],
    });

    expect(pickNextBestShot(activation, 'zone-bar')?.id).toBe('critical');
  });

  test('standing in the zone breaks a tie between equals', () => {
    const activation = makeActivation({
      shots: [
        makeShot({ id: 'far', priority: 'strong', zoneId: 'zone-patio', category: 'broll' }),
        makeShot({ id: 'here', priority: 'strong', zoneId: 'zone-bar', category: 'broll' }),
      ],
    });

    const pick = pickNextBestShot(activation, 'zone-bar');
    expect(pick?.id).toBe('here');
    expect(pick?.reasons).toContain('You are already standing here');
  });

  test('returns null once everything is captured', () => {
    const activation = makeActivation({ shots: [makeShot({ completed: true })] });
    expect(pickNextBestShot(activation)).toBeNull();
  });
});

describe('leave check', () => {
  test('blocks on outstanding must shots and names the Reel', () => {
    const activation = makeActivation({
      shots: [makeShot({ id: 'a', title: 'Group toast', priority: 'must' })],
    });

    const result = runLeaveCheck(activation);
    expect(result.clear).toBe(false);
    expect(result.blockers.some((b) => b.kind === 'must' && b.title === 'Group toast')).toBe(true);
    expect(result.blockers.find((b) => b.kind === 'must')?.detail).toContain('Hero Reel');
  });

  test('flags an uncaptured client request even when it is optional', () => {
    const reel = makeReel({
      sequence: [makeBeat('reel-1-beat-1', 0, 'Hook')],
    });
    const activation = makeActivation({
      reels: [reel],
      shots: [
        makeShot({ id: 'a', completed: true }),
        makeShot({
          id: 'patio',
          title: 'Patio wide',
          priority: 'optional',
          clientRequired: true,
          reelUsages: [],
        }),
      ],
    });

    const result = runLeaveCheck(activation);
    expect(result.clear).toBe(false);
    expect(result.blockers.some((b) => b.kind === 'client' && b.title === 'Patio wide')).toBe(true);
  });

  test('blocks on a missing verdict even when every capture is done', () => {
    const reel = makeReel({ sequence: [makeBeat('reel-1-beat-1', 0, 'Hook')] });
    const activation = makeActivation({
      reels: [reel],
      shots: [makeShot({ id: 'a', completed: true })],
    });

    const result = runLeaveCheck(activation);
    expect(result.clear).toBe(false);
    expect(result.blockers.map((blocker) => blocker.kind)).toEqual(['verdict']);
  });

  test('clears once every required capture, beat and the verdict are done', () => {
    const reel = makeReel({ sequence: [makeBeat('reel-1-beat-1', 0, 'Hook')] });
    const activation = makeActivation({
      reels: [reel],
      shots: [makeShot({ id: 'a', completed: true })],
      verdict: { value: 'stamped' },
    });

    const result = runLeaveCheck(activation);
    expect(result.clear).toBe(true);
    expect(result.readyReels).toEqual(['Hero Reel']);
  });

  test('an empty shot list is never "clear to leave"', () => {
    expect(runLeaveCheck(makeActivation({ reels: [] })).clear).toBe(false);
  });
});

describe('zone grouping', () => {
  test('groups by zone and falls back to a readable label', () => {
    const activation = makeActivation({
      venueAnalysis: {
        business: { inferredCategory: 'Lounge', subcategories: [], confidence: 90, reasoning: '' },
        summary: '',
        visualProfile: {
          atmosphere: [],
          visualIdentity: '',
          dominantColors: [],
          premiumLevel: '',
          spatialFeel: '',
          crowdEnergyPotential: '',
          lighting: { overall: '', strongestAreas: [], problemAreas: [], recommendations: [] },
        },
        zones: [
          {
            id: 'zone-entrance',
            name: 'Entrance',
            description: '',
            bestFor: [],
            sourcePhotoIds: [],
            priority: 'hero',
          },
        ],
        standoutFeatures: [],
        usableProps: [],
        visibleProductsOrServices: [],
        filmingChallenges: [],
        bestHeroLocation: { description: '', sourcePhotoIds: [], why: '' },
        observationsByPhoto: [],
      },
      shots: [makeShot({ id: 'a' }), makeShot({ id: 'b', zoneId: '' })],
    });

    const groups = groupShotsByZone(activation);
    expect(groups.find((group) => group.zoneId === 'zone-entrance')?.name).toBe('Entrance');
    expect(groups.find((group) => group.zoneId === 'unassigned')?.name).toBe('Anywhere');
  });
});

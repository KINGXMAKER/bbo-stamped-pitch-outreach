import { describe, expect, test } from 'vitest';
import {
  PitchIntelSchema,
  RecoverableVenueAnalysisSchema,
  ReelSetSchema,
  ShotListSchema,
  SkitSetSchema,
  VenueAnalysisSchema,
} from '@/lib/ai/schemas';

describe('VenueAnalysisSchema', () => {
  const minimal = {
    business: { inferredCategory: 'Restaurant + Lounge' },
    zones: [{ id: 'zone-bar', name: 'Main bar' }],
    visualProfile: { lighting: {} },
    bestHeroLocation: {},
  };

  test('fills app-managed gaps rather than rejecting a thin but valid answer', () => {
    const parsed = VenueAnalysisSchema.parse(minimal);
    expect(parsed.business.subcategories).toEqual([]);
    expect(parsed.business.confidence).toBe(70);
    expect(parsed.zones[0].priority).toBe('secondary');
    expect(parsed.visualProfile.lighting.problemAreas).toEqual([]);
  });

  test('rejects an analysis with no zones — there would be nowhere to shoot', () => {
    expect(VenueAnalysisSchema.safeParse({ ...minimal, zones: [] }).success).toBe(false);
  });

  test('recovers an otherwise valid provider answer with an empty zones array', () => {
    const parsed = RecoverableVenueAnalysisSchema.parse({
      ...minimal,
      zones: [],
      bestHeroLocation: {
        description: 'The main room beside the bar',
        sourcePhotoIds: ['photo-1'],
        why: 'It shows the venue identity clearly.',
      },
    });

    expect(parsed.zones).toEqual([
      expect.objectContaining({
        id: 'zone-primary',
        name: 'Primary visible area',
        description: 'The main room beside the bar',
        sourcePhotoIds: ['photo-1'],
        priority: 'hero',
      }),
    ]);
  });

  test('rejects a blank category', () => {
    expect(
      VenueAnalysisSchema.safeParse({ ...minimal, business: { inferredCategory: '   ' } }).success
    ).toBe(false);
  });

  test('rejects an out-of-range confidence', () => {
    const bad = { ...minimal, business: { inferredCategory: 'Lounge', confidence: 420 } };
    expect(VenueAnalysisSchema.safeParse(bad).success).toBe(false);
  });

  test('a 0-1 confidence is read as a fraction, not as 1%', () => {
    const scaled = VenueAnalysisSchema.parse({
      ...minimal,
      business: { inferredCategory: 'Lounge', confidence: 0.9 },
    });
    expect(scaled.business.confidence).toBe(90);

    const plain = VenueAnalysisSchema.parse({
      ...minimal,
      business: { inferredCategory: 'Lounge', confidence: 95 },
    });
    expect(plain.business.confidence).toBe(95);

    // Exactly 1 stays 1 — that is a genuine "almost no idea".
    const one = VenueAnalysisSchema.parse({
      ...minimal,
      business: { inferredCategory: 'Lounge', confidence: 1 },
    });
    expect(one.business.confidence).toBe(1);
  });
});

describe('ReelSetSchema', () => {
  const reel = {
    id: 'reel-1',
    title: 'Hero',
    sequence: [
      { id: 'b1', order: 0, label: 'Hook', startSecond: 0, endSecond: 2 },
      { id: 'b2', order: 1, label: 'Verdict', startSecond: 2, endSecond: 8 },
    ],
  };

  test('defaults selection and lock state to false', () => {
    const parsed = ReelSetSchema.parse({ reels: [reel] });
    expect(parsed.reels[0].selected).toBe(false);
    expect(parsed.reels[0].locked).toBe(false);
    expect(parsed.reels[0].audioDirection.type).toBe('music-bed');
  });

  test('rejects a single-beat Reel — that is an idea, not a timeline', () => {
    const thin = { ...reel, sequence: [reel.sequence[0]] };
    expect(ReelSetSchema.safeParse({ reels: [thin] }).success).toBe(false);
  });

  // Behaviour deliberately changed: this used to reject, and rejecting cost a
  // whole batch of good Reels over one invented label. The format is a filter
  // hint, so an unknown value is absorbed rather than allowed to fail the set.
  test('absorbs an unknown format rather than failing the whole set', () => {
    const parsed = ReelSetSchema.safeParse({ reels: [{ ...reel, format: 'tiktok-dance' }] });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.reels[0].format).toBe('other');
  });
});

describe('ShotListSchema', () => {
  test('defaults completion, lock and client flags off', () => {
    const parsed = ShotListSchema.parse({ shots: [{ id: 'shot-1', title: 'Walk in' }] });
    const shot = parsed.shots[0];
    expect(shot.completed).toBe(false);
    expect(shot.locked).toBe(false);
    expect(shot.clientRequired).toBe(false);
    expect(shot.camera.orientation).toBe('vertical');
    expect(shot.reelUsages).toEqual([]);
  });

  test('keeps reel usages that carry both ids', () => {
    const parsed = ShotListSchema.parse({
      shots: [
        {
          id: 'shot-1',
          title: 'Toast',
          reelUsages: [
            { reelId: 'reel-1', beatId: 'reel-1-beat-3' },
            { reelId: 'reel-2', beatId: 'reel-2-beat-1' },
          ],
        },
      ],
    });
    expect(parsed.shots[0].reelUsages).toHaveLength(2);
  });

  test('rejects a usage missing its beat', () => {
    const bad = { shots: [{ id: 's', title: 't', reelUsages: [{ reelId: 'reel-1' }] }] };
    expect(ShotListSchema.safeParse(bad).success).toBe(false);
  });

  test('rejects an empty shot list', () => {
    expect(ShotListSchema.safeParse({ shots: [] }).success).toBe(false);
  });
});

describe('SkitSetSchema', () => {
  test('defaults the shoot-list flag off', () => {
    const parsed = SkitSetSchema.parse({
      skits: [{ id: 'skit-1', title: 'Throne', beats: [{ order: 1, action: 'Walks up' }] }],
    });
    expect(parsed.skits[0].addedToShoot).toBe(false);
    expect(parsed.skits[0].difficulty).toBe('medium');
  });

  test('rejects a beatless skit', () => {
    expect(
      SkitSetSchema.safeParse({ skits: [{ id: 's', title: 't', beats: [] }] }).success
    ).toBe(false);
  });
});

describe('PitchIntelSchema', () => {
  test('an unknown fit verdict is rejected, not coerced into a number', () => {
    expect(PitchIntelSchema.safeParse({ fit: '87/100' }).success).toBe(false);
  });

  test('defaults to INSUFFICIENT DATA when the model says nothing', () => {
    expect(PitchIntelSchema.parse({}).fit).toBe('INSUFFICIENT DATA');
  });
});

describe('optional fields tolerate null', () => {
  // Gemini sends `null` for an optional field it has no content for, while
  // other providers omit the key. Both mean "nothing here", so a fallback
  // provider must not be rejected for choosing the other convention.
  const beat = (over: Record<string, unknown>) => ({
    id: 'reel-1-beat-1',
    order: 0,
    label: 'Hook',
    startSecond: 0,
    endSecond: 3,
    purpose: 'stop the scroll',
    description: 'walk in',
    shotsNeeded: ['entrance'],
    editingDirection: 'hard cut',
    ...over,
  });
  const wrap = (b: Record<string, unknown>) => ({
    reels: [{
      id: 'reel-1', title: 'Hero', concept: 'c', goal: 'g',
      recommendedDuration: 30, format: 'experience', hook: 'h',
      audienceReactionGoal: 'r', sourcePhotoIds: ['photo-1'],
      sequence: [b, beat({ id: 'reel-1-beat-2', order: 1 })],
      captionIdeas: [],
    }],
  });

  test('null optional text becomes undefined', () => {
    const parsed = ReelSetSchema.parse(
      wrap(beat({ voiceover: null, dialogue: null, onScreenText: null }))
    );
    const first = parsed.reels[0].sequence[0];
    expect(first.voiceover).toBeUndefined();
    expect(first.dialogue).toBeUndefined();
    expect(first.onScreenText).toBeUndefined();
  });

  test('a null array field becomes an empty array', () => {
    const parsed = ReelSetSchema.parse(wrap(beat({ shotsNeeded: null })));
    expect(parsed.reels[0].sequence[0].shotsNeeded).toEqual([]);
  });
});

describe('PitchIntelSchema confidence', () => {
  const base = {
    inferredCategory: 'Bar',
    categoryReasoning: 'from the name',
    fit: 'POTENTIAL FIT',
    fitReasoning: 'plausible',
  };

  // The prompt asks for a phrase because a number would imply research nobody
  // did. The schema has to accept what the prompt asks for, or every call pays
  // for a repair round trip.
  test('accepts the phrase the prompt asks for', () => {
    const parsed = PitchIntelSchema.parse({ ...base, categoryConfidence: 'fairly confident' });
    expect(parsed.categoryConfidence).toBe('fairly confident');
  });

  test('defaults rather than inventing certainty when the field is absent', () => {
    expect(PitchIntelSchema.parse(base).categoryConfidence).toBe('not stated');
  });
});

describe('ReelConceptSchema format', () => {
  const reel = (format: unknown) => ({
    reels: [{
      id: 'reel-1', title: 'Hero', concept: 'c', goal: 'g', recommendedDuration: 30,
      format, hook: 'h', audienceReactionGoal: 'r', sourcePhotoIds: [],
      sequence: [
        { id: 'b1', order: 0, label: 'Hook', startSecond: 0, endSecond: 3, purpose: 'p', description: 'd', shotsNeeded: [], editingDirection: 'cut' },
        { id: 'b2', order: 1, label: 'Pay', startSecond: 3, endSecond: 6, purpose: 'p', description: 'd', shotsNeeded: [], editingDirection: 'cut' },
      ],
      captionIdeas: [],
    }],
  });

  test('keeps a known format', () => {
    expect(ReelSetSchema.parse(reel('lifestyle')).reels[0].format).toBe('lifestyle');
  });

  // One invented label used to fail the entire batch, and the repair pass then
  // returned two Reels where six had been asked for.
  test('an invented format falls back to "other" instead of failing the batch', () => {
    expect(ReelSetSchema.parse(reel('challenge')).reels[0].format).toBe('other');
    expect(ReelSetSchema.parse(reel(null)).reels[0].format).toBe('other');
  });
});

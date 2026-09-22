import { describe, expect, test } from 'vitest';
import { LOCATION_SCOUT_SYSTEM, buildLocationScoutPrompt } from '@/lib/ai/prompts/location-scout';
import { REEL_SYSTEM, buildReelPrompt } from '@/lib/ai/prompts/reel-generator';
import { DEDUPE_SYSTEM, SHOT_SYSTEM, buildDedupePrompt } from '@/lib/ai/prompts/shot-builder';
import { PHOTO_SYSTEM } from '@/lib/ai/prompts/photo-plan';
import { SKIT_SYSTEM } from '@/lib/ai/prompts/skit-generator';
import { BLUEPRINT_SYSTEM } from '@/lib/ai/prompts/edit-blueprint';
import { PITCH_SYSTEM, buildPitchPrompt } from '@/lib/ai/prompts/pitch-intel';
import { RELEASE_REMINDER, budgetLine } from '@/lib/ai/prompts/shared';
import { buildShootPlanText } from '@/lib/export/text';
import { makeActivation, makeVenueAnalysis } from './fixtures';

const ALL_SYSTEMS = {
  scout: LOCATION_SCOUT_SYSTEM,
  reels: REEL_SYSTEM,
  shots: SHOT_SYSTEM,
  dedupe: DEDUPE_SYSTEM,
  photos: PHOTO_SYSTEM,
  skits: SKIT_SYSTEM,
  blueprint: BLUEPRINT_SYSTEM,
  pitch: PITCH_SYSTEM,
};

const promptContext = () => {
  const activation = makeActivation({});
  return {
    business: activation.business,
    clientRequirements: activation.clientRequirements,
    notes: activation.notes,
    photos: activation.photos,
    kitchenAccess: activation.kitchenAccess,
  };
};

describe('every role prompt', () => {
  // Casting is assigned by hand on the day. A numbered slot leaking into any
  // prompt would put "Talent 2" back into a generated plan. The only place the
  // phrase may appear is inside the sentence that forbids it, so that line is
  // removed before asserting rather than the whole check being weakened.
  const withoutTheProhibition = (system: string) =>
    system
      .split('\n')
      .filter((line) => !/never number or name people|no "talent 1"/i.test(line))
      .join('\n');

  test.each(Object.entries(ALL_SYSTEMS))('%s carries no numbered talent slot', (_name, system) => {
    expect(withoutTheProhibition(system)).not.toMatch(/talent\s*\d/i);
    expect(withoutTheProhibition(system)).not.toMatch(/\bcreator\s+[ABC]\b/);
  });

  test.each(Object.entries(ALL_SYSTEMS))('%s still bans numbered slots somewhere', (name, system) => {
    // The people-facing roles must carry the ban explicitly; the two that never
    // describe a person (dedupe, pitch) are exempt.
    if (name === 'dedupe' || name === 'pitch' || name === 'scout' || name === 'blueprint') return;
    expect(system).toMatch(/never number or name people/i);
  });

  test.each(Object.entries(ALL_SYSTEMS))('%s demands JSON with no markdown', (_name, system) => {
    expect(system).toMatch(/no markdown/i);
    expect(system).toMatch(/starts with \{ and ends with \}/i);
  });

  test.each(
    Object.entries(ALL_SYSTEMS).filter(([name]) => name !== 'dedupe' && name !== 'pitch')
  )('%s carries the evidence rules', (_name, system) => {
    expect(system).toContain('SEEN');
    expect(system).toContain('TOLD');
    expect(system).toContain('INFERRED');
  });
});

describe('release reminder', () => {
  test('reaches the shoot plan exactly once, as a reminder', () => {
    const text = buildShootPlanText(makeActivation({}));
    const occurrences = text.split(RELEASE_REMINDER).length - 1;
    expect(occurrences).toBe(1);
  });

  test('is the only release handling anywhere — no capture, upload or tracking', () => {
    const text = buildShootPlanText(makeActivation({}));
    expect(text).not.toMatch(/upload .*release|release status|release form s?igned\?/i);
  });

  test('stays out of the creative brief', () => {
    expect(buildReelPrompt(promptContext(), makeVenueAnalysis(), 2)).not.toMatch(/release form/i);
  });
});

describe('budget guard', () => {
  test('refuses a budget concept when no amount is set', () => {
    expect(budgetLine({ ...promptContext() })).toMatch(/no amount set/i);
  });

  test('forbids inventing an order when prices were not supplied', () => {
    const line = budgetLine({ ...promptContext(), budgetAmount: 50 });
    expect(line).toMatch(/NO verified menu prices/);
    expect(line).toMatch(/must not invent an order/i);
  });

  test('allows a real order only once prices exist', () => {
    const line = budgetLine({ ...promptContext(), budgetAmount: 50, menuPricesSupplied: true });
    expect(line).toMatch(/Verified menu prices WERE supplied/);
  });
});

describe('pitch intel honesty', () => {
  test('marks a handle as text that was never visited', () => {
    const prompt = buildPitchPrompt({ name: 'The Patio', instagram: '@patio', ask: 'feature' });
    expect(prompt).toMatch(/NOT visited, not evidence/);
  });

  test('bans every numeric score', () => {
    expect(PITCH_SYSTEM).toMatch(/Never produce a numeric score/i);
  });
});

describe('scout grounding', () => {
  test('asks for unverified zones to be flagged rather than dropped', () => {
    const prompt = buildLocationScoutPrompt(promptContext());
    expect(prompt).toContain('unverifiedZoneIds');
    expect(prompt).toMatch(/Do not describe rooms you were not shown/);
  });
});

describe('dedupe pass', () => {
  const shots = [
    {
      id: 'a',
      title: 'Bartender Cocktail Shake',
      category: 'product' as const,
      zoneId: 'zone-bar',
      subject: 'bartender',
      description: 'shake at the bar',
      onCamera: 'staff member',
    },
    {
      id: 'b',
      title: 'Bartender Cocktail Slide',
      category: 'product' as const,
      zoneId: 'zone-bar',
      subject: 'bartender',
      description: 'slides the drink over',
      onCamera: 'staff member',
    },
  ];

  test('shows the model what a real merge looks like, not only what is not one', () => {
    const prompt = buildDedupePrompt(shots);
    expect(prompt).toMatch(/MERGE these/);
    expect(prompt).toMatch(/DO NOT merge these/);
  });

  test('keeps separate performances apart', () => {
    expect(buildDedupePrompt(shots)).toMatch(/Separate posts need separate takes/);
  });

  test('sends on-camera direction so identical setups are recognisable', () => {
    expect(buildDedupePrompt(shots)).toContain('on camera: staff member');
  });
});

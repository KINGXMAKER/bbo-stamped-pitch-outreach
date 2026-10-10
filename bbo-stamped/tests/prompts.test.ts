import { describe, expect, test } from 'vitest';
import { LOCATION_SCOUT_SYSTEM, buildLocationScoutPrompt } from '@/lib/ai/prompts/location-scout';
import { REEL_SYSTEM, buildReelPrompt } from '@/lib/ai/prompts/reel-generator';
import { splitCount } from '@/lib/ai/reel-pipeline';
import {
  DEDUPE_SYSTEM,
  SHOT_SYSTEM,
  buildDedupeAdjudicationPrompt,
} from '@/lib/ai/prompts/shot-builder';
import { PHOTO_SYSTEM } from '@/lib/ai/prompts/photo-plan';
import { SKIT_SYSTEM } from '@/lib/ai/prompts/skit-generator';
import { BLUEPRINT_SYSTEM } from '@/lib/ai/prompts/edit-blueprint';
import { PITCH_SYSTEM, buildPitchPrompt } from '@/lib/ai/prompts/pitch-intel';
import { RELEASE_REMINDER, budgetLine } from '@/lib/ai/prompts/shared';
import { buildShootPlanText } from '@/lib/export/text';
import { makeActivation, makeShot, makeVenueAnalysis } from './fixtures';

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
  const pair = {
    a: makeShot({
      id: 'a',
      title: 'Bartender Cocktail Shake',
      zoneId: 'zone-bar',
      subject: 'bartender',
      description: 'shake at the bar',
      onCamera: 'staff member',
    }),
    b: makeShot({
      id: 'b',
      title: 'Bartender Cocktail Slide',
      zoneId: 'zone-bar',
      subject: 'bartender',
      description: 'slides the drink over',
      onCamera: 'staff member',
    }),
  };

  test('asks one yes/no per pair rather than to search a list', () => {
    const prompt = buildDedupeAdjudicationPrompt([pair]);
    expect(prompt).toMatch(/would a crew film this ONCE, or TWICE/i);
    expect(prompt).toContain('PAIR 1');
  });

  test('keeps separate performances apart', () => {
    expect(buildDedupeAdjudicationPrompt([pair])).toMatch(/Separate posts need separate takes/);
  });

  test('sends framing and on-camera direction so setups are comparable', () => {
    const prompt = buildDedupeAdjudicationPrompt([pair]);
    expect(prompt).toContain('on camera: staff member');
    expect(prompt).toContain('framing:');
  });
});

describe('house formats and voice modes', () => {
  // "hidden gem" is a BBO house angle. It was previously caught by the
  // anti-hype rule, which banned the brand's own format.
  test('"hidden gem" is no longer banned language', () => {
    for (const [, system] of Object.entries(ALL_SYSTEMS)) {
      expect(system).not.toMatch(/"a hidden gem"/);
    }
  });

  test('the anti-hype rule still bans the genuinely unsupportable claims', () => {
    expect(REEL_SYSTEM).toMatch(/"safe"/);
    expect(REEL_SYSTEM).toMatch(/"the best"/);
    expect(REEL_SYSTEM).toMatch(/"viral"/);
    expect(REEL_SYSTEM).toMatch(/"worth it"/);
  });

  test('Reels reaches for the house formats by name', () => {
    expect(REEL_SYSTEM).toMatch(/hidden gem/);
    expect(REEL_SYSTEM).toMatch(/can a baddie eat good for\s+\$X/);
    expect(REEL_SYSTEM).toMatch(/not banned language and not overused/);
  });

  test('BBO-owned is "we", creator-owned is "I"', () => {
    expect(REEL_SYSTEM).toMatch(/BBO-OWNED: first-person-plural \("we", "us"\)/);
    expect(REEL_SYSTEM).toMatch(/CREATOR-OWNED: first-person singular \("I"\)/);
    expect(REEL_SYSTEM).toMatch(/The "I" organic angle is the\s+forward default/);
  });

  test('the organic illusion is protected in both the system and the task prompt', () => {
    expect(REEL_SYSTEM).toMatch(/no mention of BBO, no crew, no gifted or\s+sponsored language/);
    const prompt = buildReelPrompt(promptContext(), makeVenueAnalysis(), 2);
    expect(prompt).toMatch(/Creator-owned concepts are written in "I"/);
    expect(prompt).toMatch(/breaks the organic read/);
  });
});

describe('group and solo balance', () => {
  // The balance used to be an instruction a single call could ignore, and one
  // invented word in a six-Reel batch cost four good concepts. It is structural
  // now: two parallel passes, each asked for one voice only.
  test('always produces both voices, never rounding one away', () => {
    for (const total of [2, 3, 4, 5, 6, 7, 8]) {
      const { groupCount, soloCount } = splitCount(total);
      expect(groupCount).toBeGreaterThanOrEqual(1);
      expect(soloCount).toBeGreaterThanOrEqual(1);
      expect(groupCount + soloCount).toBe(Math.max(2, total));
    }
  });

  test('gives each voice at least two once there is room', () => {
    for (const total of [4, 6, 8]) {
      const { groupCount, soloCount } = splitCount(total);
      expect(groupCount).toBeGreaterThanOrEqual(2);
      expect(soloCount).toBeGreaterThanOrEqual(2);
    }
  });

  test('a group pass asks for group concepts only', () => {
    const prompt = buildReelPrompt(promptContext(), makeVenueAnalysis(), 3, 'GROUP');
    expect(prompt).toMatch(/GROUP concepts only, all written in "we"/);
    expect(prompt).toMatch(/Do not write a solo concept in this pass/);
  });

  test('a solo pass asks for solo concepts only', () => {
    const prompt = buildReelPrompt(promptContext(), makeVenueAnalysis(), 3, 'SOLO');
    expect(prompt).toMatch(/SOLO concepts only, all written in "I"/);
    expect(prompt).toMatch(/went there on her own/);
  });

  test('gives group concepts their own angles, not just the hero recap', () => {
    const prompt = buildReelPrompt(promptContext(), makeVenueAnalysis(), 6, 'GROUP');
    for (const angle of ['Stamped or Scam?', 'First Bite Round-Table', 'The Table Tour']) {
      expect(prompt).toContain(angle);
    }
  });

  test('requires the group mechanism to suit the actual room', () => {
    const prompt = buildReelPrompt(promptContext(), makeVenueAnalysis(), 6, 'GROUP');
    expect(prompt).toMatch(/a long table needs seating the report shows/);
  });
});

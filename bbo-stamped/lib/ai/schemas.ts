import { z } from 'zod';

// Every AI stage returns JSON that is parsed, then validated here. App-managed
// state (selected / locked / completed) is defaulted so a model that omits it
// never fails the whole generation.

const nonEmpty = z.string().trim().min(1);

// Models disagree about how to express "nothing here": some omit the key, some
// send null. Both mean the same thing, so both are accepted and normalised to
// undefined. Being strict here made a healthy fallback provider look broken.
const optionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);

const strArray = z
  .array(z.string().trim())
  .nullish()
  .transform((value) => value ?? []);
const idArray = strArray;

/** Evidence provenance, accepted case-insensitively and defaulted honestly. */
const evidenceLabel = z
  .enum(['SEEN', 'TOLD', 'INFERRED'])
  .nullish()
  .transform((value) => value ?? undefined);

const evidenceNotes = z
  .array(z.object({ claim: z.string().default(''), label: z.enum(['SEEN', 'TOLD', 'INFERRED']).default('INFERRED') }))
  .nullish()
  .transform((value) => value ?? []);

/**
 * Confidence is asked for as 0-100, but models routinely answer on a 0-1 scale.
 * A raw 0.9 rendered as "1% confidence", so anything below 1 is read as a
 * fraction and scaled. Exactly 1 is left alone — that is a real 1%.
 */
const confidence = z
  .number()
  .min(0)
  .max(100)
  .transform((value) => Math.round(value < 1 ? value * 100 : value));

// ── STAGE 1 — VENUE ANALYSIS ─────────────────────────────────────────────────

export const VenueZoneSchema = z.object({
  id: nonEmpty,
  name: nonEmpty,
  description: z.string().default(''),
  bestFor: strArray,
  sourcePhotoIds: idArray,
  priority: z.enum(['hero', 'strong', 'secondary']).default('secondary'),
});

export const VenueAnalysisSchema = z.object({
  business: z.object({
    inferredCategory: nonEmpty,
    subcategories: strArray,
    confidence: confidence.default(70),
    reasoning: z.string().default(''),
  }),
  summary: z.string().default(''),
  visualProfile: z.object({
    atmosphere: strArray,
    visualIdentity: z.string().default(''),
    dominantColors: strArray,
    premiumLevel: z.string().default(''),
    spatialFeel: z.string().default(''),
    crowdEnergyPotential: z.string().default(''),
    lighting: z.object({
      overall: z.string().default(''),
      strongestAreas: strArray,
      problemAreas: strArray,
      recommendations: strArray,
    }),
  }),
  zones: z.array(VenueZoneSchema).min(1),
  standoutFeatures: z
    .array(
      z.object({
        feature: nonEmpty,
        opportunity: z.string().default(''),
        sourcePhotoIds: idArray,
      })
    )
    .default([]),
  usableProps: strArray,
  visibleProductsOrServices: strArray,
  filmingChallenges: strArray,
  bestHeroLocation: z.object({
    description: z.string().default(''),
    sourcePhotoIds: idArray,
    why: z.string().default(''),
  }),
  unverifiedZoneIds: idArray,
  openQuestions: strArray,
  observationsByPhoto: z
    .array(
      z.object({
        photoId: nonEmpty,
        observations: strArray,
        shotOpportunities: strArray,
      })
    )
    .default([]),
});

/**
 * Vision providers occasionally return a complete, grounded scout report but
 * leave `zones` empty. The rest of the app requires one zone, so preserve the
 * provider's hero-location evidence as a minimal structural zone instead of
 * discarding the whole analysis and exhausting every fallback provider.
 *
 * Keep VenueAnalysisSchema strict for every other caller. This recovery schema
 * is deliberately used only by the location-scout route.
 */
export const RecoverableVenueAnalysisSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

  const analysis = value as Record<string, unknown>;
  if (!Array.isArray(analysis.zones) || analysis.zones.length > 0) return value;

  const hero =
    analysis.bestHeroLocation &&
    typeof analysis.bestHeroLocation === 'object' &&
    !Array.isArray(analysis.bestHeroLocation)
      ? (analysis.bestHeroLocation as Record<string, unknown>)
      : {};
  const description = typeof hero.description === 'string' ? hero.description : '';
  const sourcePhotoIds = Array.isArray(hero.sourcePhotoIds)
    ? hero.sourcePhotoIds.filter((id): id is string => typeof id === 'string')
    : [];

  return {
    ...analysis,
    zones: [
      {
        id: 'zone-primary',
        name: 'Primary visible area',
        description,
        bestFor: [],
        sourcePhotoIds,
        priority: 'hero',
      },
    ],
  };
}, VenueAnalysisSchema);

// ── STAGE 2 — REELS ──────────────────────────────────────────────────────────

export const ReelBeatSchema = z.object({
  id: nonEmpty,
  order: z.number().int().nonnegative(),
  label: nonEmpty,
  startSecond: z.number().nonnegative(),
  endSecond: z.number().nonnegative(),
  purpose: z.string().default(''),
  description: z.string().default(''),
  shotsNeeded: strArray,
  voiceover: optionalText,
  dialogue: optionalText,
  onScreenText: optionalText,
  editingDirection: z.string().default(''),
});

export const ReelConceptSchema = z.object({
  id: nonEmpty,
  title: nonEmpty,
  concept: z.string().default(''),
  goal: z.string().default(''),
  recommendedDuration: z.number().positive().default(38),
  format: z
    .enum(['experience', 'lifestyle', 'opinion', 'skit', 'review', 'voiceover', 'other'])
    .default('experience'),
  hook: z.string().default(''),
  audienceReactionGoal: z.string().default(''),
  sourcePhotoIds: idArray,
  /** BBO posts it, or a creator claims it for their own page. */
  contentOwner: z.enum(['BBO', 'CREATOR']).nullish().transform((v) => v ?? 'BBO'),
  /** Creator-owned concepts are named by their angle, never by a person. */
  angle: optionalText,
  series: optionalText,
  targetViewer: optionalText,
  onScreenHeadline: optionalText,
  interviewQuestion: optionalText,
  reactionMoment: optionalText,
  cta: optionalText,
  voiceoverFramework: optionalText,
  whyThisVenue: optionalText,
  sharedFootage: strArray,
  uniqueFootage: strArray,
  evidenceNotes,
  missingInformation: strArray,
  preShootConfirmations: strArray,
  sequence: z.array(ReelBeatSchema).min(2),
  audioDirection: z
    .object({
      type: z
        .enum(['dialogue', 'trending-audio', 'music-bed', 'voiceover', 'ambient'])
        .default('music-bed'),
      direction: z.string().default(''),
      searchTerms: strArray.optional(),
    })
    .default({ type: 'music-bed', direction: '' }),
  captionIdeas: strArray,
  selected: z.boolean().default(false),
  locked: z.boolean().default(false),
});

export const ReelSetSchema = z.object({
  reels: z.array(ReelConceptSchema).min(1),
});

// ── STAGE 3 — SHOTS ──────────────────────────────────────────────────────────

export const ShotSchema = z.object({
  id: nonEmpty,
  title: nonEmpty,
  category: z
    .enum([
      'hook',
      'establishing',
      'venue',
      'talent',
      'product',
      'service',
      'reaction',
      'interview',
      'broll',
      'transition',
      'skit',
      'verdict',
    ])
    .default('broll'),
  priority: z.enum(['must', 'strong', 'optional']).default('strong'),
  description: z.string().default(''),
  purpose: z.string().default(''),
  zoneId: z.string().default(''),
  location: z.string().default(''),
  sourcePhotoIds: idArray,
  subject: z.string().default(''),
  onCamera: optionalText,
  camera: z
    .object({
      framing: z.string().default(''),
      zoomOrLens: z.string().default(''),
      movement: z.string().default(''),
      orientation: z.enum(['vertical', 'horizontal', 'either']).default('vertical'),
    })
    .default({ framing: '', zoomOrLens: '', movement: '', orientation: 'vertical' }),
  audioNotes: optionalText,
  timeSensitive: z.boolean().nullish().transform((v) => v ?? false),
  continuityNote: optionalText,
  evidence: evidenceLabel,
  talentDirection: z.string().default(''),
  dialogue: optionalText,
  props: strArray.optional(),
  minimumUsefulDuration: z.number().positive().default(5),
  recommendedTakeCount: z.number().int().positive().default(2),
  reelUsages: z
    .array(z.object({ reelId: nonEmpty, beatId: nonEmpty }))
    .default([]),
  editingNote: z.string().default(''),
  completed: z.boolean().default(false),
  locked: z.boolean().default(false),
  clientRequired: z.boolean().default(false),
});

export const ShotListSchema = z.object({
  shots: z.array(ShotSchema).min(1),
});

/** Cross-Reel merge instructions. Applied deterministically, never trusted blindly. */
export const ShotDedupeDecisionSchema = z.object({
  decisions: z
    .array(
      z.object({
        aId: nonEmpty,
        bId: nonEmpty,
        sameSetup: z.boolean().nullish().transform((value) => value ?? false),
        reason: z.string().default(''),
      })
    )
    .nullish()
    .transform((value) => value ?? []),
});

export const ShotDedupeSchema = z.object({
  groups: z
    .array(
      z.object({
        keepId: nonEmpty,
        duplicateIds: z.array(nonEmpty).min(1),
        reason: z.string().default(''),
      })
    )
    .default([]),
});

// ── PHOTO PLAN ───────────────────────────────────────────────────────────────

export const PhotoShotSchema = z.object({
  id: nonEmpty,
  title: nonEmpty,
  category: z
    .enum([
      'hero-food',
      'full-spread',
      'product',
      'group-hero',
      'individual-portrait',
      'venue',
      'detail',
      'process',
      'candid',
    ])
    .default('venue'),
  priority: z.enum(['must', 'strong', 'optional']).default('strong'),
  description: z.string().default(''),
  zoneId: z.string().default(''),
  location: z.string().default(''),
  sourcePhotoIds: idArray,
  subject: z.string().default(''),
  onCamera: optionalText,
  camera: z
    .object({
      framing: z.string().default(''),
      angle: z.string().default(''),
      orientation: z.enum(['vertical', 'horizontal', 'both']).default('vertical'),
    })
    .default({ framing: '', angle: '', orientation: 'vertical' }),
  intendedUsage: optionalText,
  evidence: evidenceLabel,
  styling: z.string().default(''),
  timing: z
    .enum(['before-service', 'food-untouched', 'during-service', 'anytime', 'end-of-visit'])
    .default('anytime'),
  clientRequired: z.boolean().default(false),
  completed: z.boolean().default(false),
  locked: z.boolean().default(false),
});

export const PhotoPlanSchema = z.object({
  photos: z.array(PhotoShotSchema).min(1),
});

// ── SKITS ────────────────────────────────────────────────────────────────────

export const SkitConceptSchema = z.object({
  id: nonEmpty,
  title: nonEmpty,
  hook: z.string().default(''),
  premise: z.string().default(''),
  whyThisLocationWorks: z.string().default(''),
  venueTrigger: optionalText,
  stagingDisclaimer: optionalText,
  zoneId: z.string().default(''),
  sourcePhotoIds: idArray,
  castSize: z.number().int().positive().default(2),
  characters: z
    .array(z.object({ name: z.string().default(''), role: z.string().default('') }))
    .default([]),
  props: strArray,
  estimatedDuration: z.number().positive().default(25),
  difficulty: z.enum(['easy', 'medium', 'involved']).default('medium'),
  viralMechanic: z.string().default(''),
  beats: z
    .array(
      z.object({
        order: z.number().int().nonnegative(),
        action: z.string().default(''),
        dialogue: optionalText,
        shotDirection: z.string().default(''),
      })
    )
    .min(1),
  ending: z.string().default(''),
  onScreenText: z.string().default(''),
  captionAngle: z.string().default(''),
  editingDirection: z.string().default(''),
  selected: z.boolean().default(false),
  locked: z.boolean().default(false),
  addedToShoot: z.boolean().default(false),
});

export const SkitSetSchema = z.object({
  skits: z.array(SkitConceptSchema).min(1),
});

// ── EDIT BLUEPRINT ───────────────────────────────────────────────────────────

export const EditBlueprintSchema = z.object({
  reelTitle: z.string().default(''),
  targetDuration: z.string().default(''),
  clips: z
    .array(
      z.object({
        order: z.number().int().nonnegative(),
        shotId: optionalText,
        shotTitle: nonEmpty,
        startSecond: z.number().nonnegative(),
        endSecond: z.number().nonnegative(),
        direction: z.string().default(''),
      })
    )
    .min(1),
  pacing: z.string().default(''),
  hookTreatment: z.string().default(''),
  dialoguePlacement: z.string().default(''),
  brollCoverage: z.string().default(''),
  transitions: z.string().default(''),
  slowMotionMoments: strArray,
  audioTreatment: z.string().default(''),
  onScreenText: strArray,
  ending: z.string().default(''),
  missingCoverage: strArray,
  workarounds: strArray,
});

// ── PITCH INTEL ──────────────────────────────────────────────────────────────

export const PitchIntelSchema = z.object({
  inferredCategory: z.string().default('Unclear'),
  // Words, never a number: a numeric confidence here would imply research
  // nobody performed. The prompt asks for a phrase, so the schema must accept
  // one — a number schema made every call fail validation and pay for a repair.
  categoryConfidence: z.string().default('not stated'),
  categoryReasoning: z.string().default(''),
  fit: z
    .enum(['STRONG FIT', 'POTENTIAL FIT', 'WEAK FIT', 'INSUFFICIENT DATA'])
    .default('INSUFFICIENT DATA'),
  fitReasoning: z.string().default(''),
  dataUsed: strArray,
  dataMissing: strArray,
  contentGapHypothesis: strArray,
  pitchAngle: z.string().default(''),
  whatBBOProvides: strArray,
  objectionHandlers: z
    .array(z.object({ objection: z.string().default(''), response: z.string().default('') }))
    .default([]),
  dmScript: z.string().default(''),
  followUp: z.string().default(''),
  contactStrategy: z.string().default(''),
});

export type VenueAnalysisOut = z.infer<typeof VenueAnalysisSchema>;
export type ReelSetOut = z.infer<typeof ReelSetSchema>;
export type ShotListOut = z.infer<typeof ShotListSchema>;
export type PhotoPlanOut = z.infer<typeof PhotoPlanSchema>;
export type SkitSetOut = z.infer<typeof SkitSetSchema>;
export type EditBlueprintOut = z.infer<typeof EditBlueprintSchema>;
export type PitchIntelOut = z.infer<typeof PitchIntelSchema>;

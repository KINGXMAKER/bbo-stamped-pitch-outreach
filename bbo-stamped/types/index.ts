// ── BBO STAMPED — central data model ─────────────────────────────────────────
// One activation object holds everything: the business, its photos, the venue
// intelligence the AI derived from them, the Reels we chose to shoot, the
// deduplicated master shot list, skits and the edit blueprints.

export type VenuePhoto = {
  id: string;
  fileName: string;
  /** Object URL (session) or data URL (rehydrated from IndexedDB). */
  previewUrl: string;
  /** Compressed JPEG base64 payload, no data: prefix. Sent to vision once. */
  base64?: string;
  mediaType: string;
  note?: string;
  sortOrder: number;
};

export type KitchenAccess = 'approved' | 'denied' | 'unknown';

/**
 * Where a piece of information came from. An INFERRED item is a production
 * interpretation and must never be presented to a crew as a verified fact.
 */
export type EvidenceLabel = 'SEEN' | 'TOLD' | 'INFERRED';

export type EvidenceNote = { claim: string; label: EvidenceLabel };

/** BBO posts it, or an individual creator claims it for their own page. */
export type ContentOwner = 'BBO' | 'CREATOR';

// ── VENUE INTELLIGENCE (Stage 1 — location scout) ────────────────────────────

export type ZonePriority = 'hero' | 'strong' | 'secondary';

export type VenueZone = {
  id: string;
  name: string;
  description: string;
  bestFor: string[];
  sourcePhotoIds: string[];
  priority: ZonePriority;
};

export type VenueAnalysis = {
  business: {
    inferredCategory: string;
    subcategories: string[];
    confidence: number;
    reasoning: string;
  };
  summary: string;
  visualProfile: {
    atmosphere: string[];
    visualIdentity: string;
    dominantColors: string[];
    premiumLevel: string;
    spatialFeel: string;
    crowdEnergyPotential: string;
    lighting: {
      overall: string;
      strongestAreas: string[];
      problemAreas: string[];
      recommendations: string[];
    };
  };
  zones: VenueZone[];
  standoutFeatures: Array<{
    feature: string;
    opportunity: string;
    sourcePhotoIds: string[];
  }>;
  usableProps: string[];
  visibleProductsOrServices: string[];
  filmingChallenges: string[];
  bestHeroLocation: {
    description: string;
    sourcePhotoIds: string[];
    why: string;
  };
  /** Zone ids the scout proposed without a photo to support them. */
  unverifiedZoneIds?: string[];
  openQuestions?: string[];
  observationsByPhoto: Array<{
    photoId: string;
    observations: string[];
    shotOpportunities: string[];
  }>;
};

// ── REELS (Stage 2) ──────────────────────────────────────────────────────────

export type ReelFormat =
  | 'experience'
  | 'lifestyle'
  | 'opinion'
  | 'skit'
  | 'review'
  | 'voiceover'
  | 'other';

export type AudioDirection = {
  type: 'dialogue' | 'trending-audio' | 'music-bed' | 'voiceover' | 'ambient';
  direction: string;
  searchTerms?: string[];
};

export type ReelBeat = {
  id: string;
  order: number;
  label: string;
  startSecond: number;
  endSecond: number;
  purpose: string;
  description: string;
  shotsNeeded: string[];
  voiceover?: string;
  dialogue?: string;
  onScreenText?: string;
  editingDirection: string;
};

export type ReelConcept = {
  id: string;
  title: string;
  concept: string;
  goal: string;
  recommendedDuration: number;
  format: ReelFormat;
  hook: string;
  audienceReactionGoal: string;
  sourcePhotoIds: string[];
  /** BBO posts it, or a creator claims it for their own page. */
  contentOwner: ContentOwner;
  /** Creator-owned concepts are named by angle, never by a person. */
  angle?: string;
  series?: string;
  targetViewer?: string;
  onScreenHeadline?: string;
  interviewQuestion?: string;
  reactionMoment?: string;
  cta?: string;
  voiceoverFramework?: string;
  whyThisVenue?: string;
  /** What this concept reuses from the BBO shoot vs. what only it needs. */
  sharedFootage: string[];
  uniqueFootage: string[];
  evidenceNotes: EvidenceNote[];
  missingInformation: string[];
  preShootConfirmations: string[];
  sequence: ReelBeat[];
  audioDirection: AudioDirection;
  captionIdeas: string[];
  selected: boolean;
  locked: boolean;
};

// ── SHOTS (Stage 3 — master shot list) ───────────────────────────────────────

export type ShotCategory =
  | 'hook'
  | 'establishing'
  | 'venue'
  | 'talent'
  | 'product'
  | 'service'
  | 'reaction'
  | 'interview'
  | 'broll'
  | 'transition'
  | 'skit'
  | 'verdict';

export type ShotPriority = 'must' | 'strong' | 'optional';

export type ReelUsage = { reelId: string; beatId: string };

export type Shot = {
  id: string;
  title: string;
  category: ShotCategory;
  priority: ShotPriority;
  description: string;
  purpose: string;
  zoneId: string;
  location: string;
  sourcePhotoIds: string[];
  subject: string;
  /**
   * Generic production direction only — "creator", "hands only", "the group".
   * Deliberately a free string and never an id: casting is assigned by hand on
   * the day, so the plan must not encode a roster.
   */
  onCamera?: string;
  camera: {
    framing: string;
    zoomOrLens: string;
    movement: string;
    orientation: 'vertical' | 'horizontal' | 'either';
  };
  audioNotes?: string;
  /** True when waiting destroys the shot — untouched plates, first bites. */
  timeSensitive?: boolean;
  continuityNote?: string;
  evidence?: EvidenceLabel;
  talentDirection: string;
  dialogue?: string;
  props?: string[];
  minimumUsefulDuration: number;
  recommendedTakeCount: number;
  reelUsages: ReelUsage[];
  editingNote: string;
  note?: string;
  completed: boolean;
  locked: boolean;
  clientRequired: boolean;
};

// ── SKITS ────────────────────────────────────────────────────────────────────

export type SkitConcept = {
  id: string;
  title: string;
  hook: string;
  premise: string;
  whyThisLocationWorks: string;
  /** The specific venue detail the joke depends on. */
  venueTrigger?: string;
  /** How to signal this is staged comedy, not a real complaint. */
  stagingDisclaimer?: string;
  zoneId: string;
  sourcePhotoIds: string[];
  castSize: number;
  characters: Array<{ name: string; role: string }>;
  props: string[];
  estimatedDuration: number;
  difficulty: 'easy' | 'medium' | 'involved';
  viralMechanic: string;
  beats: Array<{
    order: number;
    action: string;
    dialogue?: string;
    shotDirection: string;
  }>;
  ending: string;
  onScreenText: string;
  captionAngle: string;
  editingDirection: string;
  selected: boolean;
  locked: boolean;
  /** Set once ADD TO SHOOT has converted this skit's setups into Shot objects. */
  addedToShoot: boolean;
};

// ── PHOTO PLAN ───────────────────────────────────────────────────────────────
// Stills are tracked separately from video: they compete for the same minutes
// on the day, but they have their own coverage rules and their own deadlines
// (hero food is gone the moment somebody takes a bite).

export type PhotoCategory =
  | 'hero-food'
  | 'full-spread'
  | 'product'
  | 'group-hero'
  | 'individual-portrait'
  | 'venue'
  | 'detail'
  | 'process'
  | 'candid';

export type PhotoShot = {
  id: string;
  title: string;
  category: PhotoCategory;
  priority: ShotPriority;
  description: string;
  zoneId: string;
  location: string;
  sourcePhotoIds: string[];
  subject: string;
  onCamera?: string;
  camera: {
    framing: string;
    angle: string;
    orientation: 'vertical' | 'horizontal' | 'both';
  };
  intendedUsage?: string;
  evidence?: EvidenceLabel;
  styling: string;
  /** Drives NEXT BEST CAPTURE: some frames stop existing if you wait. */
  timing: 'before-service' | 'food-untouched' | 'during-service' | 'anytime' | 'end-of-visit';
  clientRequired: boolean;
  completed: boolean;
  locked: boolean;
  note?: string;
};

// ── EDIT BLUEPRINT ───────────────────────────────────────────────────────────

export type EditBlueprint = {
  id: string;
  reelId: string;
  reelTitle: string;
  targetDuration: string;
  clips: Array<{
    order: number;
    shotId?: string;
    shotTitle: string;
    startSecond: number;
    endSecond: number;
    direction: string;
  }>;
  pacing: string;
  hookTreatment: string;
  dialoguePlacement: string;
  brollCoverage: string;
  transitions: string;
  slowMotionMoments: string[];
  audioTreatment: string;
  onScreenText: string[];
  ending: string;
  /** Planned beats that had no footage, and what was done instead. */
  missingCoverage: string[];
  workarounds: string[];
  createdAt: string;
};

// ── PITCH INTEL (secondary tool) ─────────────────────────────────────────────

export type PitchFit = 'STRONG FIT' | 'POTENTIAL FIT' | 'WEAK FIT' | 'INSUFFICIENT DATA';

export type PitchIntel = {
  inferredCategory: string;
  categoryConfidence: string;
  categoryReasoning: string;
  fit: PitchFit;
  fitReasoning: string;
  dataUsed: string[];
  dataMissing: string[];
  contentGapHypothesis: string[];
  pitchAngle: string;
  whatBBOProvides: string[];
  objectionHandlers: Array<{ objection: string; response: string }>;
  dmScript: string;
  followUp: string;
  contactStrategy: string;
};

// ── GENERATION META ──────────────────────────────────────────────────────────

export type TokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** Only ever what the provider reported. Never estimated locally. */
  reportedCostUsd?: number;
};

/** One provider call. Failed attempts are kept so failover is inspectable. */
export type GenerationAttempt = {
  provider: string;
  model: string | null;
  status: 'ok' | 'error';
  latencyMs: number;
  errorType?: string;
  httpStatus?: number;
};

export type GenerationInfo = {
  stage: string;
  providerUsed: string;
  modelUsed: string;
  latencyMs: number;
  fallbackOccurred: boolean;
  attemptCount: number;
  /** True when the payload passed Zod on the model's first answer. */
  validatedFirstTry: boolean;
  attempts: GenerationAttempt[];
  usage?: TokenUsage;
  generatedAt: string;
};

// ── ACTIVATION ───────────────────────────────────────────────────────────────

export type BBOActivation = {
  id: string;
  createdAt: string;
  updatedAt: string;
  business: {
    name: string;
    city?: string;
    instagram?: string;
    website?: string;
  };
  clientRequirements: string[];
  notes?: string;
  /**
   * Whether the crew may film behind the pass. Gates every process shot —
   * chef hands, plating, dish handoff — so they are never planned for a venue
   * that has not agreed to it.
   */
  kitchenAccess: KitchenAccess;
  /** Drives the "What $X gets you here" format. Unset means do not plan it. */
  budgetAmount?: number;
  /** Only with real prices can a budget order be built rather than invented. */
  menuPricesSupplied?: boolean;
  photos: VenuePhoto[];
  venueAnalysis?: VenueAnalysis;
  /** Founder override of the AI's inferred classification. */
  categoryOverride?: string;
  reels: ReelConcept[];
  shots: Shot[];
  photoPlan: PhotoShot[];
  skits: SkitConcept[];
  editBlueprints: EditBlueprint[];
  verdict?: { value: 'stamped' | 'clipped'; notes?: string };
  generationMeta: {
    venueAnalysis?: GenerationInfo;
    reels?: GenerationInfo;
    shots?: GenerationInfo;
    photoPlan?: GenerationInfo;
    skits?: GenerationInfo;
    blueprint?: GenerationInfo;
  };
};

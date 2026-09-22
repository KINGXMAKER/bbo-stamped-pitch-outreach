import type {
  VenueAnalysis,
  BBOActivation,
  PhotoShot,
  ReelConcept,
  Shot,
  SkitConcept,
} from "@/types";

export function makeBeat(id: string, order: number, label: string) {
  return {
    id,
    order,
    label,
    startSecond: order * 5,
    endSecond: order * 5 + 5,
    purpose: "",
    description: `${label} description`,
    shotsNeeded: [],
    editingDirection: "",
  };
}

export function makeReel(overrides: Partial<ReelConcept> = {}): ReelConcept {
  return {
    id: "reel-1",
    title: "Hero Reel",
    concept: "",
    goal: "",
    recommendedDuration: 40,
    format: "experience",
    hook: "",
    audienceReactionGoal: "",
    sourcePhotoIds: [],
    contentOwner: "BBO",
    sharedFootage: [],
    uniqueFootage: [],
    evidenceNotes: [],
    missingInformation: [],
    preShootConfirmations: [],
    sequence: [
      makeBeat("reel-1-beat-1", 0, "Hook"),
      makeBeat("reel-1-beat-2", 1, "Verdict"),
    ],
    audioDirection: { type: "music-bed", direction: "" },
    captionIdeas: [],
    selected: true,
    locked: false,
    ...overrides,
  };
}

export function makeShot(overrides: Partial<Shot> = {}): Shot {
  return {
    id: "shot-1",
    title: "Walk in",
    category: "hook",
    priority: "must",
    description: "",
    purpose: "",
    zoneId: "zone-entrance",
    location: "Entrance",
    sourcePhotoIds: [],
    subject: "",
    camera: {
      framing: "",
      zoomOrLens: "",
      movement: "",
      orientation: "vertical",
    },
    talentDirection: "",
    minimumUsefulDuration: 5,
    recommendedTakeCount: 2,
    reelUsages: [{ reelId: "reel-1", beatId: "reel-1-beat-1" }],
    editingNote: "",
    completed: false,
    locked: false,
    clientRequired: false,
    ...overrides,
  };
}

export function makeSkit(overrides: Partial<SkitConcept> = {}): SkitConcept {
  return {
    id: "skit-1",
    title: "The throne",
    hook: "",
    premise: "",
    whyThisLocationWorks: "",
    zoneId: "zone-entrance",
    sourcePhotoIds: [],
    castSize: 2,
    characters: [],
    props: [],
    estimatedDuration: 20,
    difficulty: "easy",
    viralMechanic: "",
    beats: [{ order: 1, action: "She walks up", shotDirection: "Wide" }],
    ending: "",
    onScreenText: "",
    captionAngle: "",
    editingDirection: "",
    selected: false,
    locked: false,
    addedToShoot: false,
    ...overrides,
  };
}

export function makePhoto(overrides: Partial<PhotoShot> = {}): PhotoShot {
  return {
    id: "photo-shot-1",
    title: "Hero dish",
    category: "hero-food",
    priority: "must",
    description: "",
    zoneId: "zone-entrance",
    location: "Main table",
    sourcePhotoIds: [],
    subject: "Signature plate",
    camera: {
      framing: "Overhead",
      angle: "90 degrees",
      orientation: "vertical",
    },
    styling: "",
    timing: "food-untouched",
    clientRequired: false,
    completed: false,
    locked: false,
    ...overrides,
  };
}

export function makeActivation(
  overrides: Partial<BBOActivation> = {},
): BBOActivation {
  const now = new Date().toISOString();
  return {
    id: "act-1",
    createdAt: now,
    updatedAt: now,
    business: { name: "The Patio", city: "Newark, NJ" },
    kitchenAccess: "unknown",
    clientRequirements: [],
    photos: [],
    reels: [makeReel()],
    shots: [],
    photoPlan: [],
    skits: [],
    editBlueprints: [],
    generationMeta: {},
    ...overrides,
  };
}

/** A minimal but complete scouting report, for prompts that consume one. */
export function makeVenueAnalysis(
  overrides: Partial<VenueAnalysis> = {},
): VenueAnalysis {
  return {
    business: {
      inferredCategory: "Bar & Restaurant",
      subcategories: ["Lounge"],
      confidence: 90,
      reasoning: "neon bar visible in photo-1",
    },
    summary: "Neon-lit bar and lounge.",
    visualProfile: {
      atmosphere: ["moody"],
      visualIdentity: "neon on dark wood",
      dominantColors: ["magenta"],
      premiumLevel: "mid",
      spatialFeel: "intimate",
      crowdEnergyPotential: "high on weekends",
      lighting: {
        overall: "low and coloured",
        strongestAreas: ["zone-main-bar"],
        problemAreas: [],
        recommendations: ["shoot wide open"],
      },
    },
    zones: [
      {
        id: "zone-main-bar",
        name: "Main bar",
        description: "neon backbar",
        bestFor: ["pours"],
        sourcePhotoIds: ["photo-1"],
        priority: "hero",
      },
    ],
    standoutFeatures: [],
    usableProps: [],
    visibleProductsOrServices: ["cocktails"],
    filmingChallenges: [],
    bestHeroLocation: {
      description: "the backbar",
      sourcePhotoIds: ["photo-1"],
      why: "brightest",
    },
    observationsByPhoto: [],
    ...overrides,
  };
}

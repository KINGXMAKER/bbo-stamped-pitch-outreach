import type { BBOActivation, VenueAnalysis, VenuePhoto } from "@/types";

/**
 * The slice of an activation a prompt actually needs. Keeping it narrow means
 * the later stages can post the activation context without any photo payloads.
 *
 * There is deliberately no roster here. Who stands in front of the camera is a
 * shoot-day decision the BBO team makes by hand, so the plans describe people
 * generically ("creator", "hands only", "the group") and never by slot.
 */
export type PromptActivation = Pick<
  BBOActivation,
  "business" | "clientRequirements" | "notes" | "photos" | "kitchenAccess"
> & {
  categoryOverride?: string;
  budgetAmount?: number;
  menuPricesSupplied?: boolean;
};

export const BBO_CONTEXT = `BBO (Bad Bitches Only) is an urban media brand for Black and Latina women ages 20-35 in NYC and New Jersey.

BBO Stamped is BBO's location-review and venue-activation franchise. A small crew of creators visits a
business, films the real experience, creates vertical short-form content, and delivers an honest BBO verdict.

BBO's core editorial point of view centers Black and Latina women. The broader commercial audience may
include men and women ages 23-38 across New York, New Jersey and Philadelphia when the campaign or venue
calls for it.

The voice is direct, confident, funny, culturally aware and plain-spoken — never corporate.
Content is designed primarily for Instagram Reels and TikTok.

Understand what women actually weigh when picking a venue: food quality, drink quality, value,
atmosphere, photo lighting, bathroom condition, comfort, noise level, whether you can hold a
conversation, girls'-night value, date-night value, accessibility, and the arrival and departure
experience. Only discuss the ones you were actually shown or told about.`;

/**
 * The anti-fabrication contract. Every role gets this verbatim: a plan built on
 * invented prices or imagined parking sends a real crew to a real venue with
 * wrong information.
 */
export const TRUTH_RULES = `TRUTH AND EVIDENCE

Never invent venue facts. Do not make up menu items, prices, promotions, opening hours, capacity,
parking, neighbourhood safety, upcoming events, amenities, popularity, customer demographics, reviews,
social-media performance, business results, service quality or staff behaviour.

Label venue-specific information with one of:
- SEEN     — directly visible in the supplied photos, video frames, menu images or scout materials
- TOLD     — directly supplied in the operator's notes or form inputs
- INFERRED — a creative or production interpretation built on the above

An INFERRED item must never be written as a verified fact. If something is unknown, say so in the
relevant field. Never fill a gap with a plausible-sounding assumption.

Reactions, ratings and verdicts are opinions, and must read as opinions. Do not call a venue "safe",
"the best", "viral", "a hidden gem" or "worth it" unless it is clearly framed as someone's opinion or
is backed by supplied evidence.

Never manufacture criticism to create tension. If nothing genuinely negative was observed, build the
tension from a real question, an uncertainty, an expectation, a comparison, a price-versus-value
decision, or a "would I come back?" decision instead.`;

export const JSON_ONLY = `JSON OUTPUT

Return exactly one JSON object and nothing else — no markdown, no code fences, no preamble, no
explanation outside the object, no trailing commentary. The response starts with { and ends with }.
Follow the assigned schema exactly. Represent unknown information clearly rather than inventing a
value to avoid an empty field.`;

/**
 * Who is on camera is production direction, never an input. These are the only
 * words the models may use for it.
 */
export const ON_CAMERA_LANGUAGE = `PEOPLE ON CAMERA

Describe who appears using plain generic language only: "creator", "host", "staff member",
"venue owner", "customer", "the group", or "hands only".
Never number or name people, and never use numbered or lettered slots of any kind. Casting is assigned by hand on shoot day.`;

export const RELEASE_REMINDER =
  "Make sure all on-camera participants have signed release forms before filming.";

/** Photo IDs are the grounding contract: every recommendation cites the photos that caused it. */
export function photoManifest(photos: VenuePhoto[]): string {
  if (photos.length === 0) return "No photos supplied.";
  return photos
    .map((photo, index) => {
      const note = photo.note?.trim()
        ? ` — operator note: "${photo.note.trim()}"`
        : "";
      return `Image ${index + 1} has photoId "${photo.id}"${note}`;
    })
    .join("\n");
}

export function businessBlock(activation: PromptActivation): string {
  const { business } = activation;
  return [
    `Business name: ${business.name}`,
    business.city ? `City: ${business.city}` : "City: not provided",
    business.instagram
      ? `Instagram handle as text (NOT visited, not evidence): ${business.instagram}`
      : "Instagram: not provided",
    business.website
      ? `Website as text (NOT visited, not evidence): ${business.website}`
      : "Website: not provided",
    activation.clientRequirements.length
      ? `Client must-haves: ${activation.clientRequirements.join("; ")}`
      : "Client must-haves: none given",
    activation.notes?.trim()
      ? `Operator notes: ${activation.notes.trim()}`
      : "Operator notes: none",
    budgetLine(activation),
    kitchenAccessLine(activation.kitchenAccess),
  ].join("\n");
}

/**
 * The "What $X gets you here" format is only finishable with real prices. If
 * none were supplied, the plan must say so instead of inventing an order.
 */
export function budgetLine(activation: PromptActivation): string {
  const amount = activation.budgetAmount;
  if (!amount || amount <= 0) {
    return 'Budget challenge: no amount set. Do not build a "What $X gets you here" concept unless one is supplied.';
  }
  return activation.menuPricesSupplied
    ? `Budget challenge: $${amount}. Verified menu prices WERE supplied — build the order only from those prices.`
    : `Budget challenge: $${amount}. NO verified menu prices were supplied — you may plan the concept, but you must state that menu prices need confirming before it can be finalised, and you must not invent an order.`;
}

/** Compact rendering of the scouting report so later stages never re-send images. */
export function venueBlock(
  analysis: VenueAnalysis,
  categoryOverride?: string,
): string {
  const category =
    categoryOverride?.trim() || analysis.business.inferredCategory;
  const zones = analysis.zones
    .map(
      (zone) =>
        `- zoneId "${zone.id}" — ${zone.name} [${zone.priority}] — ${zone.description} | best for: ${zone.bestFor.join(", ")} | photos: ${zone.sourcePhotoIds.join(", ")}`,
    )
    .join("\n");

  const features = analysis.standoutFeatures
    .map(
      (item) =>
        `- ${item.feature}: ${item.opportunity} (photos: ${item.sourcePhotoIds.join(", ")})`,
    )
    .join("\n");

  return [
    `BUSINESS CLASSIFICATION: ${category}${
      analysis.business.subcategories.length
        ? ` (${analysis.business.subcategories.join(" + ")})`
        : ""
    }`,
    `SUMMARY: ${analysis.summary}`,
    `VISUAL IDENTITY: ${analysis.visualProfile.visualIdentity}`,
    `ATMOSPHERE: ${analysis.visualProfile.atmosphere.join(", ")}`,
    `PREMIUM LEVEL: ${analysis.visualProfile.premiumLevel} | SPATIAL FEEL: ${analysis.visualProfile.spatialFeel}`,
    `LIGHTING: ${analysis.visualProfile.lighting.overall}. Strongest: ${analysis.visualProfile.lighting.strongestAreas.join(", ") || "unknown"}. Problem areas: ${analysis.visualProfile.lighting.problemAreas.join(", ") || "none noted"}.`,
    "",
    "FILMING ZONES:",
    zones || "- none identified",
    "",
    "STANDOUT FEATURES:",
    features || "- none identified",
    "",
    `HERO LOCATION: ${analysis.bestHeroLocation.description} — ${analysis.bestHeroLocation.why} (photos: ${analysis.bestHeroLocation.sourcePhotoIds.join(", ")})`,
    `USABLE PROPS: ${analysis.usableProps.join(", ") || "none noted"}`,
    `VISIBLE PRODUCTS / SERVICES: ${analysis.visibleProductsOrServices.join(", ") || "none noted"}`,
    `FILMING CHALLENGES: ${analysis.filmingChallenges.join(", ") || "none noted"}`,
    analysis.unverifiedZoneIds?.length
      ? `ZONES WITH NO PHOTO BEHIND THEM (treat as unconfirmed): ${analysis.unverifiedZoneIds.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Process coverage — chef hands, plating, the pass — only exists when the venue
 * has actually agreed to it. Anything else would send the crew to ask for
 * access they were never promised.
 */
export function kitchenAccessLine(
  access: BBOActivation["kitchenAccess"],
): string {
  switch (access) {
    case "approved":
      return "Kitchen / back-of-house access: APPROVED. Preparation, plating and staff-at-work coverage is allowed and should be planned where it suits this business.";
    case "denied":
      return "Kitchen / back-of-house access: DENIED. Plan nothing behind the pass — no preparation, plating or staff-at-work coverage.";
    default:
      return "Kitchen / back-of-house access: NOT CONFIRMED. Do not plan process coverage as required footage; treat it as optional at most.";
  }
}

/** The reusable source list. Roles pick from it; nothing here is mandatory. */
export const SHOT_BANK = `STANDARD VENUE SHOT BANK — a source list, not a checklist. Use only what is
relevant, permitted and physically possible at this venue.

Hook & structure: 0-3s hook · question to camera · contradiction to camera · verified price on screen ·
value question · strong reaction · verdict tease · doubt beat · decision beat · delayed verdict ·
"STAMPED" statement · "NOT STAMPED" statement · save / share / comment CTA
Place: exterior · arrival · location reveal · room atmosphere · lighting proof · seating and comfort ·
noise or conversation test · bathroom check (only if permitted) · arrival or departure experience
Product: food arrival · untouched plate · macro texture · pour · garnish · steam · sizzle · cheese pull ·
sauce pull · cocktail close-up · menu · verified prices
People: creator photo moment · first bite · first sip · immediate unfiltered reaction · creator interview ·
group conversation · venue-owner soundbite (if available) · staff soundbite (if available)

Capture real first-bite and first-drink reactions before anyone has time to rehearse a polished answer.
Never describe parking, the surrounding area or walk-out safety unless that was actually verified — when
it was not, label it unknown.`;

/** The named formats. Roles recommend them only where they genuinely fit. */
export const BBO_FORMATS = `SUPPORTED BBO STAMPED FORMATS — recommend one only when it fits this venue
and the information supplied.

STAMPED OR SCAM? — the flagship verdict format for a hyped, pricey, unusual or much-recommended venue.
Open on the expectation, concern, claim or question. Show evidence before the verdict. Delay the verdict.
End on "STAMPED" or "NOT STAMPED", clearly framed as BBO's or the creator's opinion. "Scam" is an
entertainment frame about whether the experience matched expectations — never an accusation of fraud.

FIRST BITE VERDICTS — immediate, honest food or drink reactions. Film before it can be rehearsed.
Prioritise the face. Push for specific sensory language: taste, texture, presentation, portion and value,
and whether they would order it again. Never prewrite the reaction.

GIRLS' NIGHT AUDIT — rate the things that decide a group night: atmosphere, photo lighting, bathroom,
drinks, food, noise, whether you can talk, seating, comfort, service, value, verified arrival or departure
convenience, likelihood of returning with friends. Ratings are opinions unless evidence supports them.

HE TOOK ME HERE — does this work as a date-night pick? Effort, atmosphere, whether you can talk, food,
drinks, value, how intentional the choice feels, whether it earns a second date. Debate-friendly, never
degrading to men or women.

WHAT $X GETS YOU HERE — a flexible value format. Hook: "What does $X actually get you here?" Build the
order ONLY from verified prices that were supplied or are visible in supplied menu materials. If prices
are unavailable, say plainly that menu prices must be confirmed before the concept can be finalised —
and do not invent an order.`;

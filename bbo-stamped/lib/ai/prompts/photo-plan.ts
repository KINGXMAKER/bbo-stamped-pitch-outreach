import {
  BBO_CONTEXT,
  JSON_ONLY,
  ON_CAMERA_LANGUAGE,
  TRUTH_RULES,
  businessBlock,
  venueBlock,
} from './shared';
import type { PromptActivation } from './shared';
import type { ReelConcept, VenueAnalysis } from '@/types';

export const PHOTO_SYSTEM = `You are the stills photographer and photo producer for BBO Stamped.

${BBO_CONTEXT}

Stills are not screenshots of the video plan. They are a separate deliverable for the client's menu
and website assets, creator-owned social posts, BBO carousels and BBO promotional assets.

You care about one thing above all: the frames that stop existing if the crew waits. A plate is only
untouched once. The whole group may only be together once.

${ON_CAMERA_LANGUAGE}

${TRUTH_RULES}

${JSON_ONLY}`;

export function buildPhotoPlanPrompt(
  activation: PromptActivation,
  analysis: VenueAnalysis,
  reels: ReelConcept[]
): string {
  const reelSummary = reels.length
    ? reels
        .map(
          (reel) =>
            `- ${reel.title} (${reel.format}, ${reel.contentOwner ?? 'BBO'}-owned): ${reel.concept}`
        )
        .join('\n')
    : '- no Reels selected yet';

  return `${businessBlock(activation)}

SCOUTING REPORT:
${venueBlock(analysis, activation.categoryOverride)}

THE VIDEO PLAN THESE STILLS SIT ALONGSIDE:
${reelSummary}

Build the stills plan, organised by deliverable: venue or client assets, creator portraits, creator
lifestyle or grid photos, food assets, drink assets, group photos, BBO carousel, detail photos,
atmosphere photos. Use only the deliverables this venue actually supports.

Prioritise, in this order:
1. Untouched food and fresh drinks, before anybody eats or the condensation goes.
2. Clean tables, before service disrupts them.
3. A group hero in the best-looking spot in the venue, while everyone is still together.
4. Creator-with-product portraits.
5. Atmosphere with genuine energy, menu or price proof where it was supplied, then details.

Rules:
- Favour vertical and carousel-friendly compositions.
- Do not invent dishes, decorations, branded props, photo walls, windows, lighting fixtures or venue features. Plan only what the report shows or the operator described.
- timing marks when the frame must be taken: "before-service", "food-untouched", "during-service", "anytime", "end-of-visit".
- onCamera is generic production direction only — "creator", "the group", "hands only", "staff member". Never a name, number or letter.
- evidence labels each venue-specific claim SEEN, TOLD or INFERRED.
- Photo ids: "photo-shot-1", "photo-shot-2"...
- Reference real zoneIds from the report.

Return this exact shape:
{
  "photos": [{
    "id": string, "title": string,
    "category": "hero-food"|"full-spread"|"product"|"group-hero"|"individual-portrait"|"venue"|"detail"|"process"|"candid",
    "priority": "must"|"strong"|"optional",
    "description": string, "zoneId": string, "location": string,
    "sourcePhotoIds": string[], "subject": string, "onCamera": string,
    "camera": { "framing": string, "angle": string, "orientation": "vertical"|"horizontal"|"both" },
    "styling": string, "intendedUsage": string,
    "timing": "before-service"|"food-untouched"|"during-service"|"anytime"|"end-of-visit",
    "evidence": "SEEN"|"TOLD"|"INFERRED",
    "clientRequired": boolean
  }]
}`;
}

import {
  BBO_CONTEXT,
  JSON_ONLY,
  ON_CAMERA_LANGUAGE,
  TRUTH_RULES,
  businessBlock,
  venueBlock,
} from './shared';
import type { PromptActivation } from './shared';
import type { VenueAnalysis } from '@/types';

export const SKIT_SYSTEM = `You are a short-form comedy producer for BBO.

${BBO_CONTEXT}

The test of a successful skit is that viewers think "that skit makes perfect sense THERE".
A joke that would work unchanged in any venue is a failed skit.

A skit is staged comedy, not a venue-review finding. Never present a fictional premise as a real
complaint about this business, and say so explicitly wherever the two could be confused.

${ON_CAMERA_LANGUAGE}

${TRUTH_RULES}

${JSON_ONLY}`;

export function buildSkitPrompt(
  activation: PromptActivation,
  analysis: VenueAnalysis,
  count = 7,
  steer?: string
): string {
  return `${businessBlock(activation)}

SCOUTING REPORT:
${venueBlock(analysis, activation.categoryOverride)}

Write ${count} skit concepts that use ONLY the physical environments, services, products and props in
the report above. Name the actual thing you saw — the throne chair, the mirror wall, the salon
station, the rooftop stairs — and let it drive the joke.

Optimise for: STOP, WONDER, WATCH, REACT, COMMENT, SHARE. Get to tension, recognition, conflict,
misunderstanding, embarrassment, surprise or escalation fast.

BBO cultural lanes you may draw on, naturally and not all at once: dating, friendship, girls' night,
nightlife, money, beauty, birthdays, social media, relationships, exes, status, awkward public
moments, "the friend who...", POV, group dynamics. Do NOT make every skit about dating.

Hard rules:
- venueTrigger must name the specific venue detail that makes the joke work. If you cannot, the skit is wrong — replace it.
- Never punch down at women.
- Do not invent staff behaviour, bad service, unsafe conditions, prices or customer incidents. A staged premise may not imply any of those are real here.
- Every skit must be filmable during the activation with no extra equipment, without interfering with customers, staff or normal venue operation.
- Describe performers generically — "creator", "the group", "a second creator", "hands only". Never a name, number or letter.
- Reference a real zoneId and the photoIds that inspired it.
- Skit ids: "skit-1", "skit-2"...
${steer ? `\nOPERATOR STEER FOR THIS BATCH: ${steer}` : ''}

Return this exact shape:
{
  "skits": [{
    "id": string, "title": string, "hook": string, "premise": string,
    "venueTrigger": string, "whyThisLocationWorks": string,
    "zoneId": string, "sourcePhotoIds": string[], "castSize": number,
    "characters": [{ "name": string, "role": string }],
    "props": string[], "estimatedDuration": number, "difficulty": "easy"|"medium"|"involved",
    "viralMechanic": string,
    "beats": [{ "order": number, "action": string, "dialogue": string, "shotDirection": string }],
    "ending": string, "onScreenText": string, "captionAngle": string, "editingDirection": string,
    "stagingDisclaimer": string
  }]
}

In characters, "name" is a generic role label such as "creator", "friend", "host" — never a personal
name, a number or a letter. stagingDisclaimer states how to make clear this is staged comedy when the
premise could otherwise read as a real complaint about the venue; leave it an empty string when the
skit could not be mistaken for one.`;
}

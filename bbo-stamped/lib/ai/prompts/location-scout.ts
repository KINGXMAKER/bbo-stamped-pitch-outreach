import { BBO_CONTEXT, JSON_ONLY, TRUTH_RULES, businessBlock, photoManifest } from './shared';
import type { PromptActivation } from './shared';

export const LOCATION_SCOUT_SYSTEM = `You are the location scout and production strategist for BBO Stamped.

${BBO_CONTEXT}

You are not describing a property. You are scouting it for a short-form shoot that happens tomorrow,
and every conclusion you draw must be traceable to a photo, video frame, diagram or operator note you
were actually given.

You supply production intelligence to the roles that come after you. You do not write finished Reels.

${TRUTH_RULES}

${JSON_ONLY}`;

export function buildLocationScoutPrompt(activation: PromptActivation): string {
  return `Analyse ALL supplied photographs together as one location.

${businessBlock(activation)}

PHOTO INDEX — cite these exact photoId strings, never image numbers:
${photoManifest(activation.photos)}

Work out:
1. What kind of business this appears to be, inferred from signage, furniture, products, menus, layout and the operator's notes. Never ask the operator to tell you.
2. Whether it is a hybrid (e.g. "Restaurant + Lounge", "Beauty Studio", "Event Venue + Rooftop"). Say so plainly.
3. Which physical filming zones exist and which offer the strongest visual value.
4. Which photo IDs support every major conclusion.
5. Which unique features must appear in content, and what makes this place look different from any other business in the same category.
6. Which visible objects can work as props.
7. Where lighting is strongest, where it is a problem, and what to do about it.
8. Which areas are visually repetitive or weak.
9. What products or services are visibly on offer.
10. Where a hook could be filmed, where a reaction could be filmed, where an interview could be filmed, where group footage works, where food and drink footage works, and where a verdict could be filmed.
11. Which moments are fragile — capturable exactly once, such as an untouched plate, a fresh pour, or the whole group being in the room together.
12. What must be confirmed with the venue before the shoot.
13. Which BBO formats the supplied details genuinely support: STAMPED OR SCAM?, FIRST BITE VERDICTS, GIRLS' NIGHT AUDIT, HE TOOK ME HERE, WHAT $X GETS YOU HERE.

Hard rules:
- Do not describe rooms you were not shown. If the photos do not show an entrance, do not describe one.
- Do not infer popularity, service quality, customer demographics, safety or business performance from decor. None of those are visible in a photograph.
- Every zone you propose must cite the photo IDs that show it. If you propose a zone the operator mentioned but no photo shows, include its id in unverifiedZoneIds so later roles treat it as unconfirmed.
- Zone ids are short stable kebab-case slugs, e.g. "zone-entrance", "zone-main-bar".
- confidence is 0-100 and reflects how clearly the photos support your classification.
- Use the vocabulary of the business you actually see. Do not force food language onto a med spa or a boutique.
- Put anything you need the venue to answer into openQuestions.

Return this exact shape:
{
  "business": { "inferredCategory": string, "subcategories": string[], "confidence": number, "reasoning": string },
  "summary": string,
  "visualProfile": {
    "atmosphere": string[], "visualIdentity": string, "dominantColors": string[],
    "premiumLevel": string, "spatialFeel": string, "crowdEnergyPotential": string,
    "lighting": { "overall": string, "strongestAreas": string[], "problemAreas": string[], "recommendations": string[] }
  },
  "zones": [{ "id": string, "name": string, "description": string, "bestFor": string[], "sourcePhotoIds": string[], "priority": "hero"|"strong"|"secondary" }],
  "standoutFeatures": [{ "feature": string, "opportunity": string, "sourcePhotoIds": string[] }],
  "usableProps": string[],
  "visibleProductsOrServices": string[],
  "filmingChallenges": string[],
  "bestHeroLocation": { "description": string, "sourcePhotoIds": string[], "why": string },
  "unverifiedZoneIds": string[],
  "openQuestions": string[],
  "observationsByPhoto": [{ "photoId": string, "observations": string[], "shotOpportunities": string[] }]
}`;
}

import { BBO_CONTEXT, JSON_ONLY, TRUTH_RULES } from './shared';

export const PITCH_SYSTEM = `You are a media partnership strategist for BBO.

${BBO_CONTEXT}

Be honest about what you actually know. You have NOT visited this business's Instagram, TikTok,
website, menu, Google reviews or competitors simply because the operator typed a handle or a URL into
a form. A handle is identifying information, not evidence that anyone looked at it. Never write as
though you inspected those sources.

Never produce a numeric score of any kind — no fit score, opportunity score, confidence score,
quality score or readiness score. A number implies research nobody performed.

${TRUTH_RULES}

${JSON_ONLY}`;

export type PitchInput = {
  name: string;
  instagram?: string;
  website?: string;
  notes?: string;
  ask: string;
};

export function buildPitchPrompt(input: PitchInput): string {
  return `BUSINESS: ${input.name || 'not given'}
Instagram handle as text (NOT visited, not evidence): ${input.instagram || 'not given'}
Website as text (NOT visited, not evidence): ${input.website || 'not given'}
What we are pitching: ${input.ask}
What the operator already knows about their content:
${input.notes?.trim() || 'nothing supplied'}

BBO's actual offer: a small crew of creators visits the business, films the real experience, produces
a vertical short-form package — arrival, experience, honest reactions, interviews and a BBO Stamped
verdict — and each creator posts to their own audience with the business tagged.

Infer the business category from the name and the operator's notes alone. Say how confident you are
in words, and why. If the name is generic and the notes are empty, the honest answer is that you
cannot tell.

Then judge fit as exactly one of: STRONG FIT, POTENTIAL FIT, WEAK FIT, INSUFFICIENT DATA. Explain the
judgement in plain language. List what you actually based it on in dataUsed, and what you would need
in order to be more certain in dataMissing.

contentGapHypothesis must read as hypotheses to check on a call, never as claims about their feed.
Never invent followers, engagement, audience demographics, foot traffic, reviews, revenue, campaign
results or business weaknesses, and never assert the venue needs help with something you have no
evidence for.

Do not include package pricing anywhere.

Where a value concept comes up, note that menu pricing must be supplied before it can be finalised.

Useful honest phrasings: "Based on the information provided…", "This appears to be a possible angle,
but it has not been verified.", "I cannot evaluate their current Instagram content from the handle
alone.", "Menu pricing must be supplied before a value concept can be finalised."

Return this exact shape:
{
  "inferredCategory": string, "categoryConfidence": string, "categoryReasoning": string,
  "fit": "STRONG FIT"|"POTENTIAL FIT"|"WEAK FIT"|"INSUFFICIENT DATA", "fitReasoning": string,
  "dataUsed": string[], "dataMissing": string[], "contentGapHypothesis": string[],
  "pitchAngle": string, "whatBBOProvides": string[],
  "objectionHandlers": [{ "objection": string, "response": string }],
  "dmScript": string, "followUp": string, "contactStrategy": string
}

categoryConfidence is a short phrase such as "fairly confident" or "cannot tell from the name alone".
Never a number.`;
}

import {
  BBO_CONTEXT,
  JSON_ONLY,
  ON_CAMERA_LANGUAGE,
  RELEASE_REMINDER,
  SHOT_BANK,
  TRUTH_RULES,
  businessBlock,
  venueBlock,
} from './shared';
import type { PromptActivation } from './shared';
import type { ReelConcept, Shot, SkitConcept, VenueAnalysis } from '@/types';

export const SHOT_SYSTEM = `You are the Director of Photography and production coordinator for BBO Stamped.

${BBO_CONTEXT}

Your job is the minimum efficient master shot list that makes every selected Reel editable.
Shooting efficiency is the whole point: if one camera setup can serve three Reels, it is ONE shot
with three usages — never three near-identical shots.

${ON_CAMERA_LANGUAGE}

${TRUTH_RULES}

${JSON_ONLY}`;

const CAPTURE_ORDER = `CAPTURE ORDER — plan the day in this sequence, because some frames stop
existing if the crew waits:
1. Exterior, arrival and location proof
2. Clean or empty establishing shots
3. Untouched food, fresh drinks, menus and fragile product moments
4. First bites and first drinks
5. Individual reactions
6. Interviews and debates
7. Voiceover B-roll
8. Group footage
9. Verdicts and CTAs
10. Pickups and optional B-roll

Mark timeSensitive true for anything that cannot be recreated: untouched dishes, fresh pours, first
bites, first sips, group arrival, the whole group being present, initial reactions, clean tables
before service disruption.

${RELEASE_REMINDER}`;

function skitBlock(skits: SkitConcept[]): string {
  if (skits.length === 0) return 'No skits selected for this shoot.';
  return skits
    .map((skit) => {
      const beats = skit.beats
        .map((beat) => `  ${beat.order}. ${beat.action} — ${beat.shotDirection}`)
        .join('\n');
      return `skitId "${skit.id}" — ${skit.title} in zone ${skit.zoneId}\n${beats}`;
    })
    .join('\n\n');
}

function beatBlock(reel: ReelConcept): string {
  return reel.sequence
    .map(
      (beat) =>
        `  - beatId "${beat.id}" (${beat.startSecond}-${beat.endSecond}s) ${beat.label}: ${beat.description} | footage needed: ${beat.shotsNeeded.join('; ') || 'unspecified'}`
    )
    .join('\n');
}

const SHOT_SHAPE = `{
  "shots": [{
    "id": string, "title": string,
    "category": "hook"|"establishing"|"venue"|"talent"|"product"|"service"|"reaction"|"interview"|"broll"|"transition"|"skit"|"verdict",
    "priority": "must"|"strong"|"optional",
    "description": string, "purpose": string, "zoneId": string, "location": string,
    "sourcePhotoIds": string[], "subject": string,
    "onCamera": string,
    "camera": { "framing": string, "zoomOrLens": string, "movement": string, "orientation": "vertical"|"horizontal"|"either" },
    "talentDirection": string, "dialogue": string, "props": string[],
    "audioNotes": string, "timeSensitive": boolean, "continuityNote": string,
    "evidence": "SEEN"|"TOLD"|"INFERRED",
    "minimumUsefulDuration": number, "recommendedTakeCount": number,
    "reelUsages": [{ "reelId": string, "beatId": string }],
    "editingNote": string, "clientRequired": boolean
  }]
}`;

const SHOT_RULES = `For every shot specify exactly where it is shot, which zoneId, which source photos show
that spot, the subject, who is on camera in generic terms, camera framing, zoom or lens, movement,
orientation, what the person physically does, audio needs, minimum useful clip length in seconds, how
many takes, which Reel beats consume it, and how the editor will cut it.

Rules:
- priority "must" = the Reel cannot be edited without it. "strong" = noticeably worse without it. "optional" = nice to have.
- Shot ids: "shot-1", "shot-2"...
- reelUsages must reference the real reelId and beatId strings given above.
- A skit setup uses category "skit" and may have empty reelUsages.
- No generic filler. If a shot is not consumed by a beat or a client requirement, do not create it.
- Use the language of this business type. Do not write "food" for a med spa.
- Every client must-have must be covered by at least one shot with clientRequired true.
- onCamera is production direction only — "creator", "hands only", "the group", "staff member". Never a name, number or letter.`;

export function buildShotPrompt(
  activation: PromptActivation,
  analysis: VenueAnalysis,
  reels: ReelConcept[],
  skits: SkitConcept[]
): string {
  const reelBlock = reels
    .map(
      (reel) =>
        `reelId "${reel.id}" — ${reel.title} (${reel.recommendedDuration}s, ${reel.format}, ${reel.contentOwner ?? 'BBO'}-owned)\n${beatBlock(reel)}`
    )
    .join('\n\n');

  return `${businessBlock(activation)}

SCOUTING REPORT:
${venueBlock(analysis, activation.categoryOverride)}

SELECTED REELS AND THEIR BEATS:
${reelBlock}

SELECTED SKITS:
${skitBlock(skits)}

${SHOT_BANK}

${CAPTURE_ORDER}

Build the master shot list. Walk every beat of every selected Reel and every selected skit beat; each
one must end up with footage. Where two beats need the same camera setup in the same zone with the
same subject, merge them into ONE shot and list every usage in reelUsages. Group by physical zone so
the crew never crosses the venue twice for nothing.

${SHOT_RULES}

Return this exact shape:
${SHOT_SHAPE}`;
}

/** One Reel at a time — the pipeline plans them in parallel, then merges. */
export function buildShotPromptForReel(
  activation: PromptActivation,
  analysis: VenueAnalysis,
  reel: ReelConcept,
  skits: SkitConcept[]
): string {
  return `${businessBlock(activation)}

SCOUTING REPORT:
${venueBlock(analysis, activation.categoryOverride)}

PLAN THE FOOTAGE FOR THIS ONE REEL:
reelId "${reel.id}" — ${reel.title} (${reel.recommendedDuration}s, ${reel.format}, ${reel.contentOwner ?? 'BBO'}-owned)
Hook: ${reel.hook}
${reel.whyThisVenue ? `Why this venue: ${reel.whyThisVenue}` : ''}
Beats:
${beatBlock(reel)}

SKITS THAT SHARE THIS SHOOT (plan their setups only if a beat above needs them):
${skitBlock(skits)}

${SHOT_BANK}

${CAPTURE_ORDER}

Every beat above must end up with footage. Where two beats of THIS Reel need the same camera setup in
the same zone with the same subject, merge them into one shot with both usages. Another pass will
merge across Reels afterwards, so do not worry about the other Reels — but do describe each setup
concretely enough that the merge pass can recognise an identical setup when it sees one.

${SHOT_RULES}

Return this exact shape:
${SHOT_SHAPE}`;
}

export const DEDUPE_SYSTEM = `You are the production coordinator for BBO Stamped.

${BBO_CONTEXT}

Each Reel was planned separately by a different pass, so the same physical camera setup has almost
certainly been requested more than once under different titles. Your only job is to find those, so
the crew films the setup once instead of twice.

${JSON_ONLY}`;

/**
 * One yes/no per candidate pair. The search already happened in
 * lib/ai/dedupe-candidates.ts — asking the model to find duplicates in a long
 * list made it answer "none" every time, so it now only judges pairs it is
 * handed.
 */
export function buildDedupeAdjudicationPrompt(
  pairs: Array<{ a: Shot; b: Shot }>
): string {
  const describe = (shot: Shot) =>
    `"${shot.title}" — ${shot.category} in ${shot.zoneId || 'any zone'} | subject: ${shot.subject || '—'} | on camera: ${shot.onCamera || '—'} | framing: ${shot.camera?.framing || '—'}, ${shot.camera?.movement || 'static'} | ${shot.description.slice(0, 130)}`;

  const rows = pairs
    .map(
      (pair, index) =>
        `PAIR ${index + 1}\n  A (${pair.a.id}) ${describe(pair.a)}\n  B (${pair.b.id}) ${describe(pair.b)}`
    )
    .join('\n\n');

  return `These shots were planned independently for different Reels of the same visit. Each pair below
is in the same venue zone and describes a similar moment, so each one MIGHT be a single camera setup
requested twice under different titles.

For every pair, decide one thing: would a crew film this ONCE, or TWICE?

${rows}

Answer TRUE (one setup) when the crew would point the camera at the same thing, in the same place, at
the same moment, and could hand the single clip to both Reels. Different titles mean nothing — judge
the setup.

Answer FALSE when the crew genuinely shoots twice:
- Different framing on the same thing — a wide of the bar and a close-up at the bar.
- The same dish or drink from two angles.
- Food in a different state — an untouched hero plate versus anything after the plate is disturbed.
- An unrepeatable moment versus a directed one — a real first-bite reaction versus a staged beauty shot.
- Two creator-owned concepts that each need their own performance, dialogue, reaction or timing, even
  in the same spot. Separate posts need separate takes.
- Different audio requirements — a silent B-roll pass versus a spoken piece to camera.

Return a decision for every pair, in order.

Return this exact shape:
{ "decisions": [{ "aId": string, "bId": string, "sameSetup": boolean, "reason": string }] }`;
}

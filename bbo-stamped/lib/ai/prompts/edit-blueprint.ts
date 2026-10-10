import { BBO_CONTEXT, JSON_ONLY, TRUTH_RULES } from './shared';
import type { ReelConcept, Shot } from '@/types';

export const BLUEPRINT_SYSTEM = `You are the short-form editor for BBO.

${BBO_CONTEXT}

You are assembling a Reel from footage that already exists. The captured-shot inventory you are given
is the complete source of truth. You may only use shots that were actually captured, and you must
never invent a clip the crew did not shoot.

If a planned beat has no footage, restructure the edit around what does exist and say plainly what is
missing. Never imply footage exists when it does not, and never turn staged skit footage into
apparent documentary evidence about the venue.

${TRUTH_RULES}

${JSON_ONLY}`;

export function buildBlueprintPrompt(reel: ReelConcept, shots: Shot[], businessName: string): string {
  const captured = shots.filter((shot) => shot.completed);
  const missing = shots.filter((shot) => !shot.completed);

  const capturedBlock = captured
    .map(
      (shot) =>
        `- shotId "${shot.id}" — ${shot.title} [${shot.category}] in ${shot.location || shot.zoneId} | ${shot.description} | camera: ${shot.camera.framing}, ${shot.camera.movement}${shot.onCamera ? ` | on camera: ${shot.onCamera}` : ''} | min ${shot.minimumUsefulDuration}s | editor note: ${shot.editingNote}`
    )
    .join('\n');

  const beats = reel.sequence
    .map(
      (beat) =>
        `- ${beat.label} (${beat.startSecond}-${beat.endSecond}s): ${beat.description} | direction: ${beat.editingDirection}${beat.onScreenText ? ` | on-screen: "${beat.onScreenText}"` : ''}`
    )
    .join('\n');

  return `REEL: ${reel.title} for ${businessName}
Owner: ${reel.contentOwner ?? 'BBO'}${reel.angle ? ` | angle: ${reel.angle}` : ''}
Target length: ${reel.recommendedDuration} seconds, vertical.
Hook: ${reel.hook}
Goal: ${reel.goal}
Audio direction: ${reel.audioDirection.type} — ${reel.audioDirection.direction}
${reel.cta ? `CTA: ${reel.cta}` : ''}

PLANNED BEATS:
${beats}

FOOTAGE ACTUALLY CAPTURED — this is everything you have:
${capturedBlock || '- nothing captured yet'}

${missing.length ? `NOT CAPTURED — you may not reference these in any clip:\n${missing.map((s) => `- ${s.title}`).join('\n')}` : 'All planned footage was captured.'}

Produce the exact assembly blueprint. Every clip must map to a real captured shotId from the list
above. Open on the strongest thing you actually have: an answer, a reaction, a claim, a contradiction,
a verified value question or a verdict tease. Maintain clear story progression, delay the final
verdict where it earns the wait, and keep the pacing right for Reels and TikTok.

Be specific rather than generic. Give clip order, in and out points in seconds across the finished
Reel, and what each cut is doing. Then give pacing, hook treatment, where dialogue breathes, where
B-roll covers a cut, transitions, where slow motion earns its place, how audio behaves, on-screen
text, and the ending.

Where a planned beat had no footage, list it in missingCoverage and describe the workaround you used
instead. Do not quietly pretend the beat was covered.

Return this exact shape:
{
  "reelTitle": string, "targetDuration": string,
  "clips": [{ "order": number, "shotId": string, "shotTitle": string, "startSecond": number, "endSecond": number, "direction": string }],
  "pacing": string, "hookTreatment": string, "dialoguePlacement": string, "brollCoverage": string,
  "transitions": string, "slowMotionMoments": string[], "audioTreatment": string,
  "onScreenText": string[], "ending": string,
  "missingCoverage": string[], "workarounds": string[]
}`;
}

import { computeActivationCoverage, groupShotsByZone } from '@/lib/coverage';
import { formatRange } from '@/lib/utils/format';
import { RELEASE_REMINDER } from '@/lib/ai/prompts/shared';
import type { BBOActivation, EditBlueprint, ReelConcept } from '@/types';

/** Plain-text shoot plan for the group chat or a printout. */
export function buildShootPlanText(activation: BBOActivation): string {
  const coverage = computeActivationCoverage(activation);
  const zones = groupShotsByZone(activation);
  const lines: string[] = [];

  lines.push(`BBO STAMPED — ${activation.business.name.toUpperCase()}`);
  if (activation.business.city) lines.push(activation.business.city);
  if (activation.venueAnalysis) {
    lines.push(
      activation.categoryOverride || activation.venueAnalysis.business.inferredCategory
    );
  }
  lines.push(`Kitchen access: ${activation.kitchenAccess ?? 'unknown'}`);
  lines.push('');
  lines.push(RELEASE_REMINDER);
  lines.push('');

  lines.push('REELS WE ARE SHOOTING');
  for (const reel of activation.reels.filter((item) => item.selected)) {
    const reelCoverage = coverage.reels.find((item) => item.reelId === reel.id);
    lines.push(
      `- [${reel.contentOwner ?? 'BBO'}] ${reel.title} (${Math.round(reel.recommendedDuration)}s)${
        reelCoverage ? ` — ${reelCoverage.percent}%${reelCoverage.readyToEdit ? ' READY' : ''}` : ''
      }`
    );
  }
  if (activation.clientRequirements.length) {
    lines.push('');
    lines.push('CLIENT MUST-HAVES');
    for (const requirement of activation.clientRequirements) lines.push(`- ${requirement}`);
  }
  lines.push('');

  const photos = activation.photoPlan ?? [];
  if (photos.length > 0) {
    lines.push(
      `PHOTO PLAN — ${coverage.photos.requiredCompleted}/${coverage.photos.requiredTotal} required frames`
    );
    for (const photo of photos) {
      lines.push(
        `${photo.completed ? '[x]' : '[ ]'} ${photo.priority.toUpperCase()}${
          photo.clientRequired ? ' · CLIENT' : ''
        } — ${photo.title} (${photo.timing})`
      );
      if (photo.description) lines.push(`      ${photo.description}`);
      if (photo.styling) lines.push(`      Styling: ${photo.styling}`);
    }
    lines.push('');
  }

  lines.push(`SHOT LIST — ${coverage.completedShots}/${coverage.totalShots} captured`);
  const reelTitleById = new Map(activation.reels.map((reel) => [reel.id, reel.title]));

  for (const zone of zones) {
    lines.push('');
    lines.push(`## ${zone.name.toUpperCase()} (${zone.completed}/${zone.shots.length})`);
    for (const shot of zone.shots) {
      const usedBy = [
        ...new Set(
          shot.reelUsages
            .map((usage) => reelTitleById.get(usage.reelId))
            .filter((title): title is string => Boolean(title))
        ),
      ];
      lines.push(
        `${shot.completed ? '[x]' : '[ ]'} ${shot.priority.toUpperCase()}${
          shot.clientRequired ? ' · CLIENT' : ''
        } — ${shot.title}`
      );
      if (shot.description) lines.push(`      ${shot.description}`);
      const camera = [shot.camera.zoomOrLens, shot.camera.framing, shot.camera.movement]
        .filter(Boolean)
        .join(' · ');
      if (camera) lines.push(`      Camera: ${camera}`);
      if (shot.onCamera) lines.push(`      On camera: ${shot.onCamera}`);
      if (shot.talentDirection) lines.push(`      Action: ${shot.talentDirection}`);
      lines.push(
        `      ${shot.minimumUsefulDuration}s min · ${shot.recommendedTakeCount} takes${
          usedBy.length ? ` · for ${usedBy.join(' + ')}` : ''
        }`
      );
    }
  }

  return lines.join('\n');
}

/**
 * The main export: a prompt another AI editor (or a human) can act on directly.
 * Only footage that was actually captured is ever referenced.
 */
export function buildEditPromptText(
  activation: BBOActivation,
  reel: ReelConcept,
  blueprint?: EditBlueprint
): string {
  const shotById = new Map(activation.shots.map((shot) => [shot.id, shot]));
  const lines: string[] = [];

  lines.push(
    `Create a ${Math.round(reel.recommendedDuration)}-second vertical Instagram Reel for BBO Stamped at ${activation.business.name}.`
  );
  lines.push('');
  lines.push(`Purpose: ${reel.goal || reel.concept}`);
  if (reel.hook) lines.push(`Open on the hook: ${reel.hook}`);
  lines.push('');

  if (blueprint) {
    lines.push('EDIT SEQUENCE');
    for (const clip of [...blueprint.clips].sort((a, b) => a.order - b.order)) {
      const shot = clip.shotId ? shotById.get(clip.shotId) : undefined;
      const source = shot ? `${shot.title} (${shot.location || shot.zoneId})` : clip.shotTitle;
      const seconds = Math.max(0.4, clip.endSecond - clip.startSecond).toFixed(1);
      lines.push(`${clip.order}. ${source} — use ${seconds}s at ${formatRange(clip.startSecond, clip.endSecond)}.`);
      if (clip.direction) lines.push(`   ${clip.direction}`);
    }
    lines.push('');
    if (blueprint.pacing) lines.push(`Pacing: ${blueprint.pacing}`);
    if (blueprint.hookTreatment) lines.push(`Hook: ${blueprint.hookTreatment}`);
    if (blueprint.dialoguePlacement) lines.push(`Dialogue: ${blueprint.dialoguePlacement}`);
    if (blueprint.brollCoverage) lines.push(`B-roll: ${blueprint.brollCoverage}`);
    if (blueprint.transitions) lines.push(`Transitions: ${blueprint.transitions}`);
    if (blueprint.slowMotionMoments.length)
      lines.push(`Slow motion: ${blueprint.slowMotionMoments.join('; ')}`);
    if (blueprint.audioTreatment) lines.push(`Audio: ${blueprint.audioTreatment}`);
    if (blueprint.onScreenText.length) {
      lines.push('On-screen text:');
      for (const text of blueprint.onScreenText) lines.push(`- ${text}`);
    }
    if (blueprint.ending) lines.push(`End on: ${blueprint.ending}`);
  } else {
    lines.push('PLANNED SEQUENCE (no blueprint generated yet)');
    for (const beat of [...reel.sequence].sort((a, b) => a.order - b.order)) {
      lines.push(
        `${beat.order}. ${beat.label} ${formatRange(beat.startSecond, beat.endSecond)} — ${beat.description}`
      );
      if (beat.editingDirection) lines.push(`   ${beat.editingDirection}`);
    }
    lines.push('');
    lines.push(`Audio: ${reel.audioDirection.type} — ${reel.audioDirection.direction}`);
  }

  lines.push('');
  lines.push('Style: BBO Stamped — hot pink lower-thirds, plain confident voice, no over-editing.');
  lines.push('Do not add footage that is not in the list above.');

  return lines.join('\n');
}

export function downloadJson(activation: BBOActivation): void {
  // Photo payloads are stripped — the JSON is a plan, not a media archive.
  const slim = {
    ...activation,
    photos: activation.photos.map(({ base64: _base64, previewUrl: _previewUrl, ...rest }) => rest),
  };
  const blob = new Blob([JSON.stringify(slim, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `bbo-stamped-${activation.business.name.replace(/\W+/g, '-').toLowerCase()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

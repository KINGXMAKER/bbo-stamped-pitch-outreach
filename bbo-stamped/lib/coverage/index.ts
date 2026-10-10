import type { BBOActivation, PhotoShot, ReelConcept, Shot, VenueZone } from '@/types';

// Coverage is pure application logic. The AI designs the structure once; from
// then on, ticking a capture off recomputes everything locally and instantly.
// Nothing in this file may ever make a network call.

export type BeatCoverage = {
  beatId: string;
  label: string;
  planned: boolean;
  covered: boolean;
  shotIds: string[];
};

export type ReelCoverage = {
  reelId: string;
  title: string;
  linkedShots: number;
  requiredShots: number;
  completedRequired: number;
  percent: number;
  readyToEdit: boolean;
  missingRequired: Shot[];
  beats: BeatCoverage[];
  uncoveredBeats: BeatCoverage[];
};

/** Every shot any beat of this Reel consumes. */
export function shotsForReel(reelId: string, shots: Shot[]): Shot[] {
  return shots.filter((shot) => shot.reelUsages.some((usage) => usage.reelId === reelId));
}

/** A Reel cannot be edited without these. Optional shots only count when a client demanded them. */
export function requiredShotsForReel(reelId: string, shots: Shot[]): Shot[] {
  return shotsForReel(reelId, shots).filter(
    (shot) => shot.priority !== 'optional' || shot.clientRequired
  );
}

export function computeReelCoverage(reel: ReelConcept, shots: Shot[]): ReelCoverage {
  const linked = shotsForReel(reel.id, shots);
  const required = requiredShotsForReel(reel.id, shots);

  const beats: BeatCoverage[] = reel.sequence.map((beat) => {
    const mapped = linked.filter((shot) =>
      shot.reelUsages.some((usage) => usage.reelId === reel.id && usage.beatId === beat.id)
    );
    return {
      beatId: beat.id,
      label: beat.label,
      planned: mapped.length > 0,
      covered: mapped.some((shot) => shot.completed),
      shotIds: mapped.map((shot) => shot.id),
    };
  });

  if (linked.length === 0) {
    return {
      reelId: reel.id,
      title: reel.title,
      linkedShots: 0,
      requiredShots: 0,
      completedRequired: 0,
      percent: 0,
      readyToEdit: false,
      missingRequired: [],
      beats,
      uncoveredBeats: beats,
    };
  }

  const pool = required.length > 0 ? required : linked;
  const completed = pool.filter((shot) => shot.completed);
  const percent = Math.round((completed.length / pool.length) * 100);
  const uncoveredBeats = beats.filter((beat) => !beat.covered);

  return {
    reelId: reel.id,
    title: reel.title,
    linkedShots: linked.length,
    requiredShots: pool.length,
    completedRequired: completed.length,
    percent,
    readyToEdit: completed.length === pool.length && uncoveredBeats.length === 0,
    missingRequired: pool.filter((shot) => !shot.completed),
    beats,
    uncoveredBeats,
  };
}

// ── PHOTO COVERAGE ───────────────────────────────────────────────────────────

export type PhotoCoverage = {
  total: number;
  completed: number;
  requiredTotal: number;
  requiredCompleted: number;
  percent: number;
  complete: boolean;
  missingRequired: PhotoShot[];
  /** Frames that stop being possible once the visit moves on. */
  perishableRemaining: PhotoShot[];
};

/** A still is required when it is a MUST, or when the client asked for it. */
export function requiredPhotos(photos: PhotoShot[]): PhotoShot[] {
  return photos.filter((photo) => photo.priority !== 'optional' || photo.clientRequired);
}

export function isPerishable(photo: PhotoShot): boolean {
  return photo.timing === 'food-untouched' || photo.timing === 'before-service';
}

export function computePhotoCoverage(photos: PhotoShot[]): PhotoCoverage {
  const required = requiredPhotos(photos);
  const requiredCompleted = required.filter((photo) => photo.completed);

  return {
    total: photos.length,
    completed: photos.filter((photo) => photo.completed).length,
    requiredTotal: required.length,
    requiredCompleted: requiredCompleted.length,
    percent:
      required.length === 0
        ? photos.length === 0
          ? 0
          : 100
        : Math.round((requiredCompleted.length / required.length) * 100),
    complete: required.length > 0 && requiredCompleted.length === required.length,
    missingRequired: required.filter((photo) => !photo.completed),
    perishableRemaining: photos.filter((photo) => !photo.completed && isPerishable(photo)),
  };
}

// ── ACTIVATION COVERAGE ──────────────────────────────────────────────────────

export type ActivationCoverage = {
  totalShots: number;
  completedShots: number;
  mustRemaining: number;
  clientRemaining: number;
  reels: ReelCoverage[];
  photos: PhotoCoverage;
  percent: number;
};

export function computeActivationCoverage(activation: BBOActivation): ActivationCoverage {
  const { shots } = activation;
  const photos = activation.photoPlan ?? [];
  const selectedReels = activation.reels.filter((reel) => reel.selected);
  const completed = shots.filter((shot) => shot.completed);

  const clientRemaining =
    shots.filter((shot) => shot.clientRequired && !shot.completed).length +
    photos.filter((photo) => photo.clientRequired && !photo.completed).length;

  const totalCaptures = shots.length + photos.length;
  const completedCaptures = completed.length + photos.filter((photo) => photo.completed).length;

  return {
    totalShots: shots.length,
    completedShots: completed.length,
    mustRemaining:
      shots.filter((shot) => shot.priority === 'must' && !shot.completed).length +
      photos.filter((photo) => photo.priority === 'must' && !photo.completed).length,
    clientRemaining,
    reels: selectedReels.map((reel) => computeReelCoverage(reel, shots)),
    photos: computePhotoCoverage(photos),
    percent: totalCaptures === 0 ? 0 : Math.round((completedCaptures / totalCaptures) * 100),
  };
}

/** How many of the Reels we are actually shooting consume this one setup. */
export function coverageMultiplier(shot: Shot, selectedReelIds: Set<string>): number {
  const reelIds = new Set(
    shot.reelUsages.map((usage) => usage.reelId).filter((id) => selectedReelIds.has(id))
  );
  return reelIds.size;
}

// ── NEXT BEST CAPTURE ────────────────────────────────────────────────────────

export type CaptureKind = 'shot' | 'photo';

export type NextBestCapture = {
  kind: CaptureKind;
  id: string;
  title: string;
  location: string;
  zoneId: string;
  reasons: string[];
  score: number;
  shot?: Shot;
  photo?: PhotoShot;
};

/**
 * Live state of the visit, supplied by the operator in Shoot mode. It changes
 * what is urgent: once food is on the table, the untouched frames are on a
 * clock that ordinary B-roll is not.
 */
export type ShootContext = {
  currentZoneId?: string;
  /** Food/product has arrived, so perishable stills are now or never. */
  serviceStarted?: boolean;
  /** Everyone is still on site — the moment for group frames. */
  /** Is the whole crew in the room right now? Set on the day, not from a roster. */
  groupPresent?: boolean;
};

// Weights are ordered so the tiers in the shoot-day priority list can never
// invert: a client must-have always outranks a convenience win, and a
// perishable food frame outranks ordinary optional B-roll once service starts.
const W = {
  clientMust: 4000,
  reelCritical: 2600,
  multiReel: 700,
  foodBeforeBites: 2200,
  perishableWaiting: 900,
  processWindow: 1500,
  groupWhilePresent: 1200,
  lightingSensitive: 600,
  currentZone: 300,
  strong: 250,
  heroZone: 60,
  optional: 0,
} as const;

export function pickNextBestCapture(
  activation: BBOActivation,
  context: ShootContext = {}
): NextBestCapture | null {
  const selectedReelIds = new Set(
    activation.reels.filter((reel) => reel.selected).map((reel) => reel.id)
  );
  const zoneById = new Map<string, VenueZone>(
    (activation.venueAnalysis?.zones ?? []).map((zone) => [zone.id, zone])
  );
  const problemAreas = new Set(
    (activation.venueAnalysis?.visualProfile.lighting.problemAreas ?? []).map((area) =>
      area.trim().toLowerCase()
    )
  );

  const candidates: NextBestCapture[] = [];

  for (const shot of activation.shots) {
    if (shot.completed) continue;
    const reasons: string[] = [];
    let score = 0;

    if (shot.clientRequired && shot.priority === 'must') {
      score += W.clientMust;
      reasons.push('Client must-have');
    } else if (shot.clientRequired) {
      score += W.clientMust / 2;
      reasons.push('Client asked for this');
    }

    if (shot.priority === 'must') {
      score += W.reelCritical;
      reasons.push('Reel-critical footage — the edit cannot happen without it');
    } else if (shot.priority === 'strong') {
      score += W.strong;
    }

    const multiplier = coverageMultiplier(shot, selectedReelIds);
    if (multiplier > 1) {
      score += W.multiReel * (multiplier - 1);
      reasons.push(`Serves ${multiplier} Reels in one setup`);
    }

    // A process window closes when service ends — you cannot go back for it.
    if (shot.category === 'service' && activation.kitchenAccess === 'approved') {
      score += W.processWindow;
      reasons.push('Process window — this disappears when service moves on');
    }

    if (needsGroup(shot.onCamera) && context.groupPresent) {
      score += W.groupWhilePresent / 2;
      reasons.push('Everyone is here right now');
    }

    const zone = zoneById.get(shot.zoneId);
    if (zone && problemAreas.has(zone.name.trim().toLowerCase())) {
      score += W.lightingSensitive;
      reasons.push('Lighting here only gets harder');
    }
    if (zone?.priority === 'hero') score += W.heroZone;

    if (context.currentZoneId && shot.zoneId === context.currentZoneId) {
      score += W.currentZone;
      reasons.push('You are already standing here');
    }

    candidates.push({
      kind: 'shot',
      id: shot.id,
      title: shot.title,
      location: shot.location || zone?.name || 'Anywhere',
      zoneId: shot.zoneId,
      reasons,
      score,
      shot,
    });
  }

  for (const photo of activation.photoPlan ?? []) {
    if (photo.completed) continue;
    const reasons: string[] = [];
    let score = 0;

    if (photo.clientRequired && photo.priority === 'must') {
      score += W.clientMust;
      reasons.push('Client must-have');
    } else if (photo.clientRequired) {
      score += W.clientMust / 2;
      reasons.push('Client asked for this');
    }

    if (photo.priority === 'must') score += W.reelCritical / 2;
    else if (photo.priority === 'strong') score += W.strong;

    // The single most time-critical frame on a food shoot.
    if (photo.timing === 'food-untouched') {
      score += context.serviceStarted ? W.foodBeforeBites : W.perishableWaiting;
      reasons.push(
        context.serviceStarted
          ? 'Food photos before bites — this frame is gone after the first fork'
          : 'Must be shot untouched, before anyone eats'
      );
    } else if (photo.timing === 'before-service') {
      score += context.serviceStarted ? 0 : W.perishableWaiting;
      if (!context.serviceStarted) reasons.push('Shoot it before the room fills up');
    }

    if (photo.category === 'group-hero') {
      score += context.groupPresent ? W.groupWhilePresent : W.groupWhilePresent / 3;
      reasons.push(
        context.groupPresent
          ? 'Whole group is present — take it now'
          : 'Needs everyone in frame at once'
      );
    }

    if (photo.category === 'process' && activation.kitchenAccess === 'approved') {
      score += W.processWindow;
      reasons.push('Process window — this disappears when service moves on');
    }

    const zone = zoneById.get(photo.zoneId);
    if (zone && problemAreas.has(zone.name.trim().toLowerCase())) {
      score += W.lightingSensitive;
      reasons.push('Lighting here only gets harder');
    }
    if (zone?.priority === 'hero') score += W.heroZone;

    if (context.currentZoneId && photo.zoneId === context.currentZoneId) {
      score += W.currentZone;
      reasons.push('You are already standing here');
    }

    candidates.push({
      kind: 'photo',
      id: photo.id,
      title: photo.title,
      location: photo.location || zone?.name || 'Anywhere',
      zoneId: photo.zoneId,
      reasons,
      score,
      photo,
    });
  }

  if (candidates.length === 0) return null;
  return candidates.reduce((best, item) => (item.score > best.score ? item : best));
}

/** Kept as the previous name so existing video-only callers still work. */
export function pickNextBestShot(
  activation: BBOActivation,
  currentZoneId?: string
): NextBestCapture | null {
  return pickNextBestCapture(activation, { currentZoneId });
}

// ── CAN WE LEAVE? ────────────────────────────────────────────────────────────

export type LeaveBlocker = {
  kind: 'must' | 'client' | 'reel' | 'photo' | 'skit' | 'verdict';
  title: string;
  detail: string;
};

export type LeaveCheck = { clear: boolean; blockers: LeaveBlocker[]; readyReels: string[] };

/**
 * The hard gate before the crew walks out. Entirely deterministic — no LLM call
 * has ever been part of this, and none may be added.
 */
export function runLeaveCheck(activation: BBOActivation): LeaveCheck {
  const coverage = computeActivationCoverage(activation);
  const blockers: LeaveBlocker[] = [];
  const reelTitleById = new Map(activation.reels.map((reel) => [reel.id, reel.title]));

  for (const shot of activation.shots) {
    if (shot.completed) continue;
    const usedBy = [
      ...new Set(
        shot.reelUsages
          .map((usage) => reelTitleById.get(usage.reelId))
          .filter((title): title is string => Boolean(title))
      ),
    ];

    if (shot.priority === 'must') {
      blockers.push({
        kind: 'must',
        title: shot.title,
        detail: usedBy.length
          ? `Required for ${usedBy.join(' + ')}`
          : 'Required shot with no Reel assigned',
      });
    } else if (shot.clientRequired) {
      blockers.push({ kind: 'client', title: shot.title, detail: 'Client request' });
    }
  }

  for (const photo of coverage.photos.missingRequired) {
    blockers.push({
      kind: photo.clientRequired ? 'client' : 'photo',
      title: photo.title,
      detail: photo.clientRequired
        ? 'Client request — photo'
        : `Required photo · ${photo.category.replace('-', ' ')}`,
    });
  }

  for (const reel of coverage.reels) {
    if (reel.readyToEdit) continue;
    const gap = reel.uncoveredBeats.map((beat) => beat.label).slice(0, 3);
    blockers.push({
      kind: 'reel',
      title: reel.title,
      detail: gap.length
        ? `${reel.percent}% covered — still missing: ${gap.join(', ')}`
        : `${reel.percent}% covered`,
    });
  }

  for (const skit of activation.skits) {
    if (!skit.selected || !skit.addedToShoot) continue;
    const outstanding = activation.shots.filter(
      (shot) => shot.category === 'skit' && shot.zoneId === skit.zoneId && !shot.completed
    );
    if (outstanding.length > 0) {
      blockers.push({
        kind: 'skit',
        title: skit.title,
        detail: `${outstanding.length} skit setup${outstanding.length === 1 ? '' : 's'} left`,
      });
    }
  }

  // The verdict is the outro of every BBO Stamped Reel. Leaving without it
  // means the hero Reel has no ending.
  const hasPlan = activation.shots.length > 0 || (activation.photoPlan?.length ?? 0) > 0;
  if (hasPlan && !activation.verdict) {
    blockers.push({
      kind: 'verdict',
      title: 'Final BBO verdict',
      detail: 'Stamped or Clipped — record it before you leave',
    });
  }

  return {
    clear: blockers.length === 0 && hasPlan,
    blockers,
    readyReels: coverage.reels.filter((reel) => reel.readyToEdit).map((reel) => reel.title),
  };
}

// ── ZONES ────────────────────────────────────────────────────────────────────

export type ZoneGroup = {
  zoneId: string;
  name: string;
  shots: Shot[];
  photos: PhotoShot[];
  completed: number;
  total: number;
};

export function groupShotsByZone(activation: BBOActivation): ZoneGroup[] {
  const zoneById = new Map<string, VenueZone>(
    (activation.venueAnalysis?.zones ?? []).map((zone) => [zone.id, zone])
  );
  const groups = new Map<string, { shots: Shot[]; photos: PhotoShot[] }>();

  const bucket = (key: string) => {
    const existing = groups.get(key);
    if (existing) return existing;
    const created = { shots: [] as Shot[], photos: [] as PhotoShot[] };
    groups.set(key, created);
    return created;
  };

  for (const shot of activation.shots) bucket(shot.zoneId || 'unassigned').shots.push(shot);
  for (const photo of activation.photoPlan ?? []) {
    bucket(photo.zoneId || 'unassigned').photos.push(photo);
  }

  return [...groups.entries()]
    .map(([zoneId, group]) => {
      const total = group.shots.length + group.photos.length;
      return {
        zoneId,
        name: zoneById.get(zoneId)?.name ?? (zoneId === 'unassigned' ? 'Anywhere' : zoneId),
        shots: group.shots,
        photos: group.photos,
        completed:
          group.shots.filter((shot) => shot.completed).length +
          group.photos.filter((photo) => photo.completed).length,
        total,
      };
    })
    .sort((a, b) => b.total - a.total);
}

/** A shot that needs everyone is only possible while everyone is still here. */
function needsGroup(onCamera?: string): boolean {
  if (!onCamera) return false;
  const value = onCamera.toLowerCase();
  return value.includes('group') || value.includes('everyone') || value.includes('all ');
}

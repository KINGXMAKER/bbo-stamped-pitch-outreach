import { newId } from '@/lib/utils/id';
import type {
  BBOActivation,
  KitchenAccess,
  PhotoShot,
  ReelConcept,
  Shot,
  SkitConcept,
} from '@/types';

export function createActivation(input: {
  name: string;
  city?: string;
  instagram?: string;
  website?: string;
  clientRequirements: string[];
  notes?: string;
  kitchenAccess?: KitchenAccess;
}): BBOActivation {
  const now = new Date().toISOString();
  return {
    id: newId('act'),
    createdAt: now,
    updatedAt: now,
    business: {
      name: input.name.trim(),
      city: input.city?.trim() || undefined,
      instagram: input.instagram?.trim() || undefined,
      website: input.website?.trim() || undefined,
    },
    clientRequirements: input.clientRequirements,
    notes: input.notes?.trim() || undefined,
    kitchenAccess: input.kitchenAccess ?? 'unknown',
    photos: [],
    reels: [],
    shots: [],
    photoPlan: [],
    skits: [],
    editBlueprints: [],
    generationMeta: {},
  };
}

// ── REGENERATION GUARDS ──────────────────────────────────────────────────────
// Regenerating one thing must never quietly destroy work. Locked items, ticked
// shots and anything the client demanded survive every regeneration.

export function mergeReels(existing: ReelConcept[], incoming: ReelConcept[]): ReelConcept[] {
  const kept = existing.filter((reel) => reel.locked);
  const keptIds = new Set(kept.map((reel) => reel.id));
  const previousSelection = new Map(existing.map((reel) => [reel.id, reel.selected]));

  const fresh = incoming
    .filter((reel) => !keptIds.has(reel.id))
    .map((reel) => ({ ...reel, selected: previousSelection.get(reel.id) ?? reel.selected }));

  return [...kept, ...fresh];
}

export function mergeShots(existing: Shot[], incoming: Shot[]): Shot[] {
  const protectedShots = existing.filter(
    (shot) => shot.locked || shot.completed || shot.clientRequired
  );
  const protectedIds = new Set(protectedShots.map((shot) => shot.id));

  const fresh = incoming.filter((shot) => !protectedIds.has(shot.id));
  return [...protectedShots, ...fresh];
}

export function mergePhotos(existing: PhotoShot[], incoming: PhotoShot[]): PhotoShot[] {
  const protectedPhotos = existing.filter(
    (photo) => photo.locked || photo.completed || photo.clientRequired
  );
  const protectedIds = new Set(protectedPhotos.map((photo) => photo.id));
  return [...protectedPhotos, ...incoming.filter((photo) => !protectedIds.has(photo.id))];
}

export function mergeSkits(existing: SkitConcept[], incoming: SkitConcept[]): SkitConcept[] {
  const kept = existing.filter((skit) => skit.locked || skit.addedToShoot);
  const keptIds = new Set(kept.map((skit) => skit.id));
  return [...kept, ...incoming.filter((skit) => !keptIds.has(skit.id))];
}

/** Turns a selected skit's beats into real Shot objects inside coverage tracking. */
export function skitToShots(skit: SkitConcept, existing: Shot[]): Shot[] {
  const alreadyThere = new Set(existing.map((shot) => shot.id));
  return skit.beats
    .map((beat, index) => {
      const id = `${skit.id}-setup-${beat.order || index + 1}`;
      if (alreadyThere.has(id)) return null;
      const shot: Shot = {
        id,
        title: `${skit.title} — beat ${beat.order || index + 1}`,
        category: 'skit',
        priority: index === 0 ? 'must' : 'strong',
        description: beat.action,
        purpose: skit.viralMechanic || skit.premise,
        zoneId: skit.zoneId,
        location: skit.zoneId,
        sourcePhotoIds: skit.sourcePhotoIds,
        onCamera: skit.characters.length > 1 ? 'the group' : 'creator',
        subject: skit.characters.map((character) => character.role || character.name).join(', ') || 'creator',
        camera: {
          framing: beat.shotDirection,
          zoomOrLens: 'Standard',
          movement: 'As directed',
          orientation: 'vertical',
        },
        talentDirection: beat.dialogue ? `Line: "${beat.dialogue}"` : beat.action,
        dialogue: beat.dialogue,
        props: skit.props,
        minimumUsefulDuration: 6,
        recommendedTakeCount: 3,
        reelUsages: [],
        editingNote: skit.editingDirection,
        completed: false,
        locked: false,
        clientRequired: false,
      };
      return shot;
    })
    .filter((shot): shot is Shot => shot !== null);
}

/**
 * Brings a stored activation up to the current shape.
 *
 * Older saves carry a `talent` roster and numbered "Talent 1-4" entries, and
 * shots/photos that reference those ids in `talentIds`. Both concepts are gone:
 * casting is a shoot-day decision now, so the roster is dropped and the ids are
 * folded into one plain on-camera direction. Anything unrecognised is discarded
 * rather than allowed to reach a component that no longer expects it.
 */
export function migrateActivation(stored: unknown): BBOActivation | null {
  if (!stored || typeof stored !== 'object') return null;
  const raw = stored as Record<string, unknown> & Partial<BBOActivation>;
  if (typeof raw.id !== 'string') return null;

  // Deprecated top-level features. Read once to translate, then never kept.
  const legacyTalent = Array.isArray(raw.talent)
    ? (raw.talent as Array<{ id?: string; name?: string }>)
    : [];
  const talentNameById = new Map(
    legacyTalent
      .filter((member) => typeof member?.id === 'string')
      .map((member) => [member.id as string, member.name ?? ''])
  );

  const onCameraFrom = (value: unknown, existing: unknown): string | undefined => {
    if (typeof existing === 'string' && existing.trim()) return existing;
    if (!Array.isArray(value) || value.length === 0) return undefined;
    // A numbered placeholder carries no meaning worth keeping — only the count does.
    if (value.length > 1) return 'the group';
    const name = talentNameById.get(String(value[0])) ?? '';
    return /^talent \d+$/i.test(name.trim()) || !name.trim() ? 'creator' : 'creator';
  };

  const {
    talent: _talent,
    releaseCapture: _releaseCapture,
    releases: _releases,
    ...rest
  } = raw as Record<string, unknown>;

  const migrated = rest as unknown as BBOActivation;

  return {
    ...migrated,
    kitchenAccess: migrated.kitchenAccess ?? 'unknown',
    photos: migrated.photos ?? [],
    reels: (migrated.reels ?? []).map((reel) => ({
      ...reel,
      contentOwner: reel.contentOwner ?? 'BBO',
      sharedFootage: reel.sharedFootage ?? [],
      uniqueFootage: reel.uniqueFootage ?? [],
      evidenceNotes: reel.evidenceNotes ?? [],
      missingInformation: reel.missingInformation ?? [],
      preShootConfirmations: reel.preShootConfirmations ?? [],
    })),
    shots: (migrated.shots ?? []).map((shot) => {
      const legacy = shot as unknown as { talentIds?: unknown };
      const next = { ...shot, onCamera: onCameraFrom(legacy.talentIds, shot.onCamera) };
      delete (next as { talentIds?: unknown }).talentIds;
      return next;
    }),
    photoPlan: (migrated.photoPlan ?? []).map((photo) => {
      const legacy = photo as unknown as { talentIds?: unknown };
      const next = { ...photo, onCamera: onCameraFrom(legacy.talentIds, photo.onCamera) };
      delete (next as { talentIds?: unknown }).talentIds;
      return next;
    }),
    skits: migrated.skits ?? [],
    editBlueprints: (migrated.editBlueprints ?? []).map((blueprint) => ({
      ...blueprint,
      missingCoverage: blueprint.missingCoverage ?? [],
      workarounds: blueprint.workarounds ?? [],
    })),
    generationMeta: migrated.generationMeta ?? {},
  };
}

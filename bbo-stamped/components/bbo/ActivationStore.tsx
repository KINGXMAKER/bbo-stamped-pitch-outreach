'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as api from '@/lib/api/client';
import { ApiError } from '@/lib/api/client';
import {
  deleteActivation as dbDelete,
  duplicateActivation as dbDuplicate,
  listActivations,
  loadActivation,
  saveActivation,
} from '@/lib/storage/db';
import { mergePhotos, mergeReels, mergeShots, mergeSkits, skitToShots } from '@/lib/storage/activation';
import { newId } from '@/lib/utils/id';
import { MAX_PHOTOS, prepareImage } from '@/lib/utils/image';
import {
  locationPhotoRejectionMessage,
  selectLocationPhotoFiles,
} from '@/lib/location-flow';
import type {
  BBOActivation,
  EditBlueprint,
  PhotoShot,
  ReelConcept,
  Shot,
  SkitConcept,
  VenuePhoto,
} from '@/types';

export type StageKey = 'venueAnalysis' | 'reels' | 'shots' | 'photoPlan' | 'skits' | 'blueprint';

export type ProgressStep = { label: string; state: 'done' | 'active' | 'todo' };

type Progress = { title: string; steps: ProgressStep[] } | null;

type StoreValue = {
  activations: BBOActivation[];
  activation: BBOActivation | null;
  hydrated: boolean;
  busy: StageKey | null;
  progress: Progress;
  errors: Partial<Record<StageKey, string>>;
  toast: string | null;

  showToast: (message: string) => void;
  clearError: (stage: StageKey) => void;

  refreshList: () => Promise<void>;
  openActivation: (id: string) => Promise<boolean>;
  startActivation: (activation: BBOActivation) => Promise<void>;
  closeActivation: () => void;
  update: (patch: (current: BBOActivation) => BBOActivation) => void;
  removeActivation: (id: string) => Promise<void>;
  duplicate: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;

  addPhotos: (files: File[]) => Promise<void>;
  removePhoto: (photoId: string) => void;
  movePhoto: (photoId: string, direction: -1 | 1) => void;
  setPhotoNote: (photoId: string, note: string) => void;

  runScout: () => Promise<boolean>;
  runReels: (options?: { count?: number; only?: string }) => Promise<boolean>;
  runSkits: (options?: { count?: number; steer?: string }) => Promise<boolean>;
  runShots: () => Promise<boolean>;
  runPhotoPlan: () => Promise<boolean>;
  runBlueprint: (reelId: string) => Promise<boolean>;

  toggleReelSelected: (reelId: string) => void;
  toggleReelLock: (reelId: string) => void;
  toggleSkitSelected: (skitId: string) => void;
  toggleSkitLock: (skitId: string) => void;
  addSkitToShoot: (skitId: string) => void;

  toggleShot: (shotId: string) => void;
  patchShot: (shotId: string, patch: Partial<Shot>) => void;
  togglePhoto: (photoId: string) => void;
  patchPhoto: (photoId: string, patch: Partial<PhotoShot>) => void;
  duplicateShot: (shotId: string) => void;
  deleteShot: (shotId: string) => void;
  addCustomShot: () => void;
};

const StoreContext = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore must be used inside <ActivationProvider>.');
  return value;
}

export function ActivationProvider({ children }: { children: React.ReactNode }) {
  const [activations, setActivations] = useState<BBOActivation[]>([]);
  const [activation, setActivation] = useState<BBOActivation | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState<StageKey | null>(null);
  const [progress, setProgress] = useState<Progress>(null);
  const [errors, setErrors] = useState<Partial<Record<StageKey, string>>>({});
  const [toast, setToast] = useState<string | null>(null);

  // Always read the freshest activation inside async flows, never a stale closure.
  const activationRef = useRef<BBOActivation | null>(null);
  const scoutInFlightRef = useRef(false);
  useEffect(() => {
    activationRef.current = activation;
  }, [activation]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 2400);
  }, []);

  const clearError = useCallback((stage: StageKey) => {
    setErrors((current) => {
      const next = { ...current };
      delete next[stage];
      return next;
    });
  }, []);

  const refreshList = useCallback(async () => {
    try {
      setActivations(await listActivations());
    } catch {
      // A browser with no IndexedDB still runs the whole session in memory.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      // A browser with no IndexedDB still runs the whole session in memory.
      const saved = await listActivations().catch(() => [] as BBOActivation[]);
      if (cancelled) return;
      setActivations(saved);
      setHydrated(true);
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced persistence — every edit lands, without a write per keystroke.
  // An unnamed draft is deliberately not saved, so half-started activations
  // never clutter the Saved screen.
  useEffect(() => {
    if (!activation || !activation.business.name.trim()) return;
    const handle = window.setTimeout(() => {
      void saveActivation(activation)
        .then(refreshList)
        .catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [activation, refreshList]);

  const update = useCallback((patch: (current: BBOActivation) => BBOActivation) => {
    setActivation((current) => (current ? patch(current) : current));
  }, []);

  const openActivation = useCallback(async (id: string) => {
    const found = await loadActivation(id).catch(() => null);
    if (!found) return false;
    setActivation(found);
    setErrors({});
    return true;
  }, []);

  const startActivation = useCallback(
    async (next: BBOActivation) => {
      setActivation(next);
      setErrors({});
      if (!next.business.name.trim()) return;
      await saveActivation(next).catch(() => undefined);
      await refreshList();
    },
    [refreshList]
  );

  const closeActivation = useCallback(() => {
    setActivation(null);
    setErrors({});
  }, []);

  const removeActivation = useCallback(
    async (id: string) => {
      await dbDelete(id).catch(() => undefined);
      setActivation((current) => (current?.id === id ? null : current));
      await refreshList();
    },
    [refreshList]
  );

  const duplicate = useCallback(
    async (id: string) => {
      await dbDuplicate(id, newId('act')).catch(() => undefined);
      await refreshList();
      showToast('Activation duplicated');
    },
    [refreshList, showToast]
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      const target = await loadActivation(id).catch(() => null);
      if (!target) return;
      const next = { ...target, business: { ...target.business, name } };
      await saveActivation(next).catch(() => undefined);
      setActivation((current) => (current?.id === id ? next : current));
      await refreshList();
    },
    [refreshList]
  );

  // ── PHOTOS ─────────────────────────────────────────────────────────────────

  const addPhotos = useCallback(
    async (files: File[]) => {
      const current = activationRef.current;
      if (!current) return;

      const room = MAX_PHOTOS - current.photos.length;
      const { accepted, rejected } = selectLocationPhotoFiles(files, room);
      if (accepted.length === 0) {
        showToast(
          room <= 0 ? `Photo limit is ${MAX_PHOTOS}` : locationPhotoRejectionMessage(rejected)
        );
        return;
      }

      const prepared: VenuePhoto[] = [];
      for (const [index, file] of accepted.entries()) {
        try {
          const image = await prepareImage(file);
          prepared.push({
            id: `photo-${current.photos.length + index + 1}-${Math.random().toString(36).slice(2, 6)}`,
            fileName: file.name,
            previewUrl: image.previewUrl,
            base64: image.base64,
            mediaType: image.mediaType,
            sortOrder: current.photos.length + index,
          });
        } catch {
          // Skip a file the browser cannot decode rather than failing the batch.
        }
      }

      if (prepared.length === 0) {
        showToast('None of those images could be read');
        return;
      }
      update((state) => ({ ...state, photos: [...state.photos, ...prepared] }));
      if (rejected.length > 0 || prepared.length < accepted.length) {
        const skipped = rejected.length + (accepted.length - prepared.length);
        showToast(`${prepared.length} added; ${skipped} skipped. ${locationPhotoRejectionMessage(rejected)}`);
      }
    },
    [showToast, update]
  );

  const removePhoto = useCallback(
    (photoId: string) => {
      update((state) => ({
        ...state,
        photos: state.photos
          .filter((photo) => photo.id !== photoId)
          .map((photo, index) => ({ ...photo, sortOrder: index })),
      }));
    },
    [update]
  );

  const movePhoto = useCallback(
    (photoId: string, direction: -1 | 1) => {
      update((state) => {
        const index = state.photos.findIndex((photo) => photo.id === photoId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= state.photos.length) return state;
        const photos = [...state.photos];
        [photos[index], photos[target]] = [photos[target], photos[index]];
        return { ...state, photos: photos.map((photo, order) => ({ ...photo, sortOrder: order })) };
      });
    },
    [update]
  );

  const setPhotoNote = useCallback(
    (photoId: string, note: string) => {
      update((state) => ({
        ...state,
        photos: state.photos.map((photo) =>
          photo.id === photoId ? { ...photo, note: note || undefined } : photo
        ),
      }));
    },
    [update]
  );

  // ── AI STAGES ──────────────────────────────────────────────────────────────

  const failStage = useCallback((stage: StageKey, error: unknown) => {
    const message =
      error instanceof ApiError
        ? error.message
        : 'Something went wrong. Nothing else in this activation was lost.';
    setErrors((current) => ({ ...current, [stage]: message }));
  }, []);

  const runScout = useCallback(async () => {
    const current = activationRef.current;
    if (!current || scoutInFlightRef.current) return false;
    scoutInFlightRef.current = true;

    clearError('venueAnalysis');
    setBusy('venueAnalysis');
    setProgress({
      title: 'Scouting the location',
      steps: [
        { label: `${current.photos.length} photos processed`, state: 'done' },
        { label: 'Reading the space', state: 'active' },
        { label: 'Mapping filming zones', state: 'todo' },
        { label: 'Grounding every call in a photo', state: 'todo' },
      ],
    });

    try {
      const { data, generation } = await api.analyzeLocation(current);
      update((state) => ({
        ...state,
        venueAnalysis: data,
        generationMeta: { ...state.generationMeta, venueAnalysis: generation },
      }));
      showToast(`${data.zones.length} filming zones detected`);
      return true;
    } catch (error) {
      failStage('venueAnalysis', error);
      return false;
    } finally {
      scoutInFlightRef.current = false;
      setBusy(null);
      setProgress(null);
    }
  }, [clearError, failStage, showToast, update]);

  const runReels = useCallback(
    async (options?: { count?: number; only?: string }) => {
      const current = activationRef.current;
      if (!current?.venueAnalysis) return false;

      clearError('reels');
      setBusy('reels');
      setProgress({
        title: 'Designing the Reels',
        steps: [
          { label: 'Venue intelligence loaded', state: 'done' },
          { label: 'Writing Reel concepts', state: 'active' },
          { label: 'Laying out timelines', state: 'todo' },
        ],
      });

      try {
        const count = options?.count ?? Math.max(3, current.reels.length || 4);
        const { data, generation } = await api.generateReels(current, current.venueAnalysis, count);

        update((state) => {
          // Regenerating one Reel must not disturb the others: protect them for
          // the merge, then restore whatever lock state they really had.
          const lockState = new Map(state.reels.map((reel) => [reel.id, reel.locked]));
          const guarded = options?.only
            ? state.reels.map((reel) => ({ ...reel, locked: reel.id === options.only ? false : true }))
            : state.reels;

          const merged = mergeReels(guarded, data.reels).map((reel) => ({
            ...reel,
            locked: lockState.get(reel.id) ?? reel.locked,
          }));

          return {
            ...state,
            reels: merged,
            generationMeta: { ...state.generationMeta, reels: generation },
          };
        });
        showToast(options?.only ? 'Reel regenerated' : `${data.reels.length} Reel concepts ready`);
        return true;
      } catch (error) {
        failStage('reels', error);
        return false;
      } finally {
        setBusy(null);
        setProgress(null);
      }
    },
    [clearError, failStage, showToast, update]
  );

  const runSkits = useCallback(
    async (options?: { count?: number; steer?: string }) => {
      const current = activationRef.current;
      if (!current?.venueAnalysis) return false;

      clearError('skits');
      setBusy('skits');
      setProgress({
        title: 'Writing skits for this exact room',
        steps: [
          { label: 'Venue props and zones loaded', state: 'done' },
          { label: 'Writing concepts', state: 'active' },
        ],
      });

      try {
        const { data, generation } = await api.generateSkits(
          current,
          current.venueAnalysis,
          options?.count ?? 7,
          options?.steer
        );
        update((state) => ({
          ...state,
          skits: mergeSkits(state.skits, data.skits),
          generationMeta: { ...state.generationMeta, skits: generation },
        }));
        showToast(`${data.skits.length} skit concepts ready`);
        return true;
      } catch (error) {
        failStage('skits', error);
        return false;
      } finally {
        setBusy(null);
        setProgress(null);
      }
    },
    [clearError, failStage, showToast, update]
  );

  const runShots = useCallback(async () => {
    const current = activationRef.current;
    if (!current?.venueAnalysis) return false;

    const reels = current.reels.filter((reel) => reel.selected);
    if (reels.length === 0) {
      setErrors((state) => ({ ...state, shots: 'Select at least one Reel to shoot first.' }));
      return false;
    }
    const skits = current.skits.filter((skit) => skit.selected);

    clearError('shots');
    setBusy('shots');
    setProgress({
      title: 'Building the master shot list',
      steps: [
        { label: `${reels.length} Reels selected`, state: 'done' },
        { label: 'Calculating footage requirements', state: 'active' },
        { label: 'Merging shots that serve more than one Reel', state: 'todo' },
      ],
    });

    try {
      const { data, generation } = await api.buildShots(current, current.venueAnalysis, reels, skits);
      update((state) => ({
        ...state,
        shots: mergeShots(state.shots, data.shots),
        generationMeta: { ...state.generationMeta, shots: generation },
      }));
      showToast(`${data.shots.length} shots — deduplicated`);
      return true;
    } catch (error) {
      failStage('shots', error);
      return false;
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, [clearError, failStage, showToast, update]);

  const runPhotoPlan = useCallback(async () => {
    const current = activationRef.current;
    if (!current?.venueAnalysis) return false;

    clearError('photoPlan');
    setBusy('photoPlan');
    setProgress({
      title: 'Planning the stills',
      steps: [
        { label: 'Venue intelligence loaded', state: 'done' },
        { label: 'Working out what has to be shot untouched', state: 'active' },
        { label: 'Covering client must-haves', state: 'todo' },
      ],
    });

    try {
      const reels = current.reels.filter((reel) => reel.selected);
      const { data, generation } = await api.buildPhotoPlan(current, current.venueAnalysis, reels);
      update((state) => ({
        ...state,
        photoPlan: mergePhotos(state.photoPlan ?? [], data.photos),
        generationMeta: { ...state.generationMeta, photoPlan: generation },
      }));
      showToast(`${data.photos.length} photos planned`);
      return true;
    } catch (error) {
      failStage('photoPlan', error);
      return false;
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, [clearError, failStage, showToast, update]);

  const runBlueprint = useCallback(
    async (reelId: string) => {
      const current = activationRef.current;
      if (!current) return false;
      const reel = current.reels.find((item) => item.id === reelId);
      if (!reel) return false;

      const linked = current.shots.filter((shot) =>
        shot.reelUsages.some((usage) => usage.reelId === reelId)
      );

      clearError('blueprint');
      setBusy('blueprint');
      setProgress({
        title: 'Writing the edit blueprint',
        steps: [
          { label: 'Reading captured footage', state: 'done' },
          { label: 'Ordering the assembly', state: 'active' },
        ],
      });

      try {
        const { data, generation } = await api.buildBlueprint(current.business.name, reel, linked);
        const blueprint: EditBlueprint = {
          ...data,
          id: newId('bp'),
          reelId,
          reelTitle: data.reelTitle || reel.title,
          createdAt: new Date().toISOString(),
        };
        update((state) => ({
          ...state,
          editBlueprints: [
            ...state.editBlueprints.filter((item) => item.reelId !== reelId),
            blueprint,
          ],
          generationMeta: { ...state.generationMeta, blueprint: generation },
        }));
        showToast('Edit blueprint ready');
        return true;
      } catch (error) {
        failStage('blueprint', error);
        return false;
      } finally {
        setBusy(null);
        setProgress(null);
      }
    },
    [clearError, failStage, showToast, update]
  );

  // ── SELECTION / LOCKS ──────────────────────────────────────────────────────

  const mapReel = useCallback(
    (reelId: string, patch: (reel: ReelConcept) => ReelConcept) => {
      update((state) => ({
        ...state,
        reels: state.reels.map((reel) => (reel.id === reelId ? patch(reel) : reel)),
      }));
    },
    [update]
  );

  const mapSkit = useCallback(
    (skitId: string, patch: (skit: SkitConcept) => SkitConcept) => {
      update((state) => ({
        ...state,
        skits: state.skits.map((skit) => (skit.id === skitId ? patch(skit) : skit)),
      }));
    },
    [update]
  );

  const toggleReelSelected = useCallback(
    (reelId: string) => mapReel(reelId, (reel) => ({ ...reel, selected: !reel.selected })),
    [mapReel]
  );
  const toggleReelLock = useCallback(
    (reelId: string) => mapReel(reelId, (reel) => ({ ...reel, locked: !reel.locked })),
    [mapReel]
  );
  const toggleSkitSelected = useCallback(
    (skitId: string) => mapSkit(skitId, (skit) => ({ ...skit, selected: !skit.selected })),
    [mapSkit]
  );
  const toggleSkitLock = useCallback(
    (skitId: string) => mapSkit(skitId, (skit) => ({ ...skit, locked: !skit.locked })),
    [mapSkit]
  );

  const addSkitToShoot = useCallback(
    (skitId: string) => {
      update((state) => {
        const skit = state.skits.find((item) => item.id === skitId);
        if (!skit) return state;
        const created = skitToShots(skit, state.shots);
        return {
          ...state,
          shots: [...state.shots, ...created],
          skits: state.skits.map((item) =>
            item.id === skitId ? { ...item, selected: true, addedToShoot: true } : item
          ),
        };
      });
      showToast('Skit setups added to the shot list');
    },
    [showToast, update]
  );

  // ── SHOTS ──────────────────────────────────────────────────────────────────

  const toggleShot = useCallback(
    (shotId: string) => {
      update((state) => ({
        ...state,
        shots: state.shots.map((shot) =>
          shot.id === shotId ? { ...shot, completed: !shot.completed } : shot
        ),
      }));
    },
    [update]
  );

  const patchShot = useCallback(
    (shotId: string, patch: Partial<Shot>) => {
      update((state) => ({
        ...state,
        shots: state.shots.map((shot) => (shot.id === shotId ? { ...shot, ...patch } : shot)),
      }));
    },
    [update]
  );

  const togglePhoto = useCallback(
    (photoId: string) => {
      update((state) => ({
        ...state,
        photoPlan: (state.photoPlan ?? []).map((photo) =>
          photo.id === photoId ? { ...photo, completed: !photo.completed } : photo
        ),
      }));
    },
    [update]
  );

  const patchPhoto = useCallback(
    (photoId: string, patch: Partial<PhotoShot>) => {
      update((state) => ({
        ...state,
        photoPlan: (state.photoPlan ?? []).map((photo) =>
          photo.id === photoId ? { ...photo, ...patch } : photo
        ),
      }));
    },
    [update]
  );

  const duplicateShot = useCallback(
    (shotId: string) => {
      update((state) => {
        const source = state.shots.find((shot) => shot.id === shotId);
        if (!source) return state;
        const copy: Shot = {
          ...structuredClone(source),
          id: newId('shot'),
          title: `${source.title} (2)`,
          completed: false,
          locked: false,
        };
        const index = state.shots.findIndex((shot) => shot.id === shotId);
        const shots = [...state.shots];
        shots.splice(index + 1, 0, copy);
        return { ...state, shots };
      });
    },
    [update]
  );

  const deleteShot = useCallback(
    (shotId: string) => {
      update((state) => ({ ...state, shots: state.shots.filter((shot) => shot.id !== shotId) }));
    },
    [update]
  );

  const addCustomShot = useCallback(() => {
    update((state) => ({
      ...state,
      shots: [
        ...state.shots,
        {
          id: newId('shot'),
          title: 'New shot',
          category: 'broll',
          priority: 'strong',
          description: '',
          purpose: '',
          zoneId: state.venueAnalysis?.zones[0]?.id ?? '',
          location: state.venueAnalysis?.zones[0]?.name ?? '',
          sourcePhotoIds: [],
          subject: '',
          camera: { framing: '', zoomOrLens: '', movement: '', orientation: 'vertical' },
          talentDirection: '',
          minimumUsefulDuration: 5,
          recommendedTakeCount: 2,
          reelUsages: [],
          editingNote: '',
          completed: false,
          locked: false,
          clientRequired: false,
        },
      ],
    }));
    showToast('Custom shot added');
  }, [showToast, update]);

  const value = useMemo<StoreValue>(
    () => ({
      activations,
      activation,
      hydrated,
      busy,
      progress,
      errors,
      toast,
      showToast,
      clearError,
      refreshList,
      openActivation,
      startActivation,
      closeActivation,
      update,
      removeActivation,
      duplicate,
      rename,
      addPhotos,
      removePhoto,
      movePhoto,
      setPhotoNote,
      runScout,
      runReels,
      runSkits,
      runShots,
      runPhotoPlan,
      runBlueprint,
      toggleReelSelected,
      toggleReelLock,
      toggleSkitSelected,
      toggleSkitLock,
      addSkitToShoot,
      toggleShot,
      patchShot,
      togglePhoto,
      patchPhoto,
      duplicateShot,
      deleteShot,
      addCustomShot,
    }),
    [
      activations,
      activation,
      hydrated,
      busy,
      progress,
      errors,
      toast,
      showToast,
      clearError,
      refreshList,
      openActivation,
      startActivation,
      closeActivation,
      update,
      removeActivation,
      duplicate,
      rename,
      addPhotos,
      removePhoto,
      movePhoto,
      setPhotoNote,
      runScout,
      runReels,
      runSkits,
      runShots,
      runPhotoPlan,
      runBlueprint,
      toggleReelSelected,
      toggleReelLock,
      toggleSkitSelected,
      toggleSkitLock,
      addSkitToShoot,
      toggleShot,
      patchShot,
      togglePhoto,
      patchPhoto,
      duplicateShot,
      deleteShot,
      addCustomShot,
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

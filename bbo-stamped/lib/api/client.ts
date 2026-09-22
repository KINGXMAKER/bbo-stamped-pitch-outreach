import type {
  BBOActivation,
  EditBlueprint,
  GenerationInfo,
  PhotoShot,
  PitchIntel,
  ReelConcept,
  Shot,
  SkitConcept,
  VenueAnalysis,
} from '@/types';

/** What the server needs to know about an activation, minus the image payloads. */
export type ActivationContextPayload = {
  business: BBOActivation['business'];
  kitchenAccess: BBOActivation['kitchenAccess'];
  clientRequirements: string[];
  notes?: string;
  photos: Array<{
    id: string;
    fileName: string;
    previewUrl: string;
    base64?: string;
    mediaType: string;
    note?: string;
    sortOrder: number;
  }>;
  categoryOverride?: string;
  budgetAmount?: number;
  menuPricesSupplied?: boolean;
};

/**
 * Photos are only shipped with their base64 for the one vision call. Every later
 * stage reuses the saved venue analysis instead of re-uploading the images.
 */
export function toContext(activation: BBOActivation, includeImages: boolean): ActivationContextPayload {
  return {
    business: activation.business,
    kitchenAccess: activation.kitchenAccess ?? 'unknown',
    clientRequirements: activation.clientRequirements,
    notes: activation.notes,
    categoryOverride: activation.categoryOverride,
    budgetAmount: activation.budgetAmount,
    menuPricesSupplied: activation.menuPricesSupplied,
    photos: activation.photos.map((photo) => ({
      id: photo.id,
      fileName: photo.fileName,
      previewUrl: '',
      base64: includeImages ? photo.base64 : undefined,
      mediaType: photo.mediaType === 'image/png' || photo.mediaType === 'image/webp' ? photo.mediaType : 'image/jpeg',
      note: photo.note,
      sortOrder: photo.sortOrder,
    })),
  };
}

export class ApiError extends Error {
  readonly kind: string;
  constructor(message: string, kind: string) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 'network');
  }

  const payload = (await response.json().catch(() => null)) as
    | { error?: string; kind?: string }
    | null;

  if (!response.ok) {
    // The access cookie expired mid-session. Send them straight to the unlock
    // screen rather than surfacing a dead-end error on top of their work.
    if (response.status === 401 && payload?.kind === 'locked') {
      const back = encodeURIComponent(window.location.pathname + window.location.search);
      // A hard navigation on purpose: the client router would keep the stale
      // in-memory session around, and the gate lives in the proxy, which only
      // re-runs on a real request.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/unlock?next=${back}`);
    }
    throw new ApiError(
      payload?.error ?? 'The server rejected that request.',
      payload?.kind ?? 'unknown'
    );
  }
  return payload as T;
}

type Staged<T> = { data: T; generation: GenerationInfo };

export function analyzeLocation(activation: BBOActivation) {
  return post<Staged<VenueAnalysis>>('/api/ai/analyze-location', {
    activation: toContext(activation, true),
  });
}

export function generateReels(activation: BBOActivation, venueAnalysis: VenueAnalysis, count = 4) {
  return post<Staged<{ reels: ReelConcept[] }>>('/api/ai/generate-reels', {
    activation: toContext(activation, false),
    venueAnalysis,
    count,
  });
}

export function generateSkits(
  activation: BBOActivation,
  venueAnalysis: VenueAnalysis,
  count = 7,
  steer?: string
) {
  return post<Staged<{ skits: SkitConcept[] }>>('/api/ai/generate-skits', {
    activation: toContext(activation, false),
    venueAnalysis,
    count,
    steer,
  });
}

export function buildShots(
  activation: BBOActivation,
  venueAnalysis: VenueAnalysis,
  reels: ReelConcept[],
  skits: SkitConcept[]
) {
  return post<Staged<{ shots: Shot[] }>>('/api/ai/build-shots', {
    activation: toContext(activation, false),
    venueAnalysis,
    reels,
    skits,
  });
}

export function buildPhotoPlan(
  activation: BBOActivation,
  venueAnalysis: VenueAnalysis,
  reels: ReelConcept[]
) {
  return post<Staged<{ photos: PhotoShot[] }>>('/api/ai/build-photo-plan', {
    activation: toContext(activation, false),
    venueAnalysis,
    reels,
  });
}

export function buildBlueprint(businessName: string, reel: ReelConcept, shots: Shot[]) {
  return post<Staged<Omit<EditBlueprint, 'id' | 'reelId' | 'createdAt'>>>('/api/ai/edit-blueprint', {
    businessName,
    reel,
    shots,
  });
}

export function runPitchIntel(input: {
  name: string;
  instagram?: string;
  website?: string;
  notes?: string;
  ask: string;
}) {
  return post<Staged<PitchIntel>>('/api/ai/pitch-intel', input);
}

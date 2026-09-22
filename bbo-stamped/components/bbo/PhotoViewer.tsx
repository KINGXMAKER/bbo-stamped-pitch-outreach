'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useStore } from './ActivationStore';

type ViewerValue = { open: (photoId: string) => void };

const ViewerContext = createContext<ViewerValue>({ open: () => undefined });

export function usePhotoViewer() {
  return useContext(ViewerContext);
}

/**
 * Every AI recommendation can point back at the photos that caused it. This
 * holds the one lightbox those references open.
 */
export function PhotoViewerProvider({ children }: { children: React.ReactNode }) {
  const { activation } = useStore();
  const [openId, setOpenId] = useState<string | null>(null);

  const open = useCallback((photoId: string) => setOpenId(photoId), []);
  const value = useMemo(() => ({ open }), [open]);

  const photos = useMemo(() => activation?.photos ?? [], [activation?.photos]);
  const index = photos.findIndex((photo) => photo.id === openId);
  const photo = index >= 0 ? photos[index] : null;

  useEffect(() => {
    if (!photo) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenId(null);
      if (event.key === 'ArrowRight' && index < photos.length - 1) setOpenId(photos[index + 1].id);
      if (event.key === 'ArrowLeft' && index > 0) setOpenId(photos[index - 1].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photo, index, photos]);

  return (
    <ViewerContext.Provider value={value}>
      {children}
      {photo ? (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Photo ${index + 1}`}
          onClick={() => setOpenId(null)}
        >
          <img src={photo.previewUrl} alt={photo.note || photo.fileName} onClick={(e) => e.stopPropagation()} />
          <div className="row" onClick={(e) => e.stopPropagation()}>
            <span className="label">
              Photo {index + 1} of {photos.length}
            </span>
            {photo.note ? <span className="small muted">{photo.note}</span> : null}
          </div>
          <div className="row" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="btn"
              disabled={index === 0}
              onClick={() => setOpenId(photos[index - 1].id)}
            >
              Prev
            </button>
            <button
              type="button"
              className="btn"
              disabled={index >= photos.length - 1}
              onClick={() => setOpenId(photos[index + 1].id)}
            >
              Next
            </button>
            <button type="button" className="btn" onClick={() => setOpenId(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </ViewerContext.Provider>
  );
}

/** "INSPIRED BY [Photo 3] [Photo 7]" — the grounding affordance, everywhere. */
export function PhotoRefs({
  photoIds,
  label = 'Inspired by',
}: {
  photoIds: string[];
  label?: string;
}) {
  const { activation } = useStore();
  const { open } = usePhotoViewer();

  const photos = (activation?.photos ?? []).map((photo, index) => ({ photo, index }));
  const matches = photoIds
    .map((id) => photos.find((entry) => entry.photo.id === id))
    .filter((entry): entry is { photo: (typeof photos)[number]['photo']; index: number } => Boolean(entry));

  if (matches.length === 0) return null;

  return (
    <div>
      <span className="label" style={{ display: 'block', marginTop: 12 }}>
        {label}
      </span>
      <div className="photo-refs">
        {matches.map(({ photo, index }) => (
          <button
            key={photo.id}
            type="button"
            className="photo-ref"
            onClick={() => open(photo.id)}
            title={`Photo ${index + 1}${photo.note ? ` — ${photo.note}` : ''}`}
            aria-label={`Open photo ${index + 1}`}
          >
            <img src={photo.previewUrl} alt="" />
          </button>
        ))}
      </div>
    </div>
  );
}

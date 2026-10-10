'use client';

import { useRef, useState } from 'react';
import { cx } from '@/lib/utils/format';
import { MAX_PHOTOS } from '@/lib/utils/image';
import { useStore } from './ActivationStore';
import { usePhotoViewer } from './PhotoViewer';

export function PhotoUploader({ compact = false }: { compact?: boolean }) {
  const { activation, addPhotos, removePhoto, movePhoto, setPhotoNote } = useStore();
  const { open } = usePhotoViewer();
  const [dragging, setDragging] = useState(false);
  const [working, setWorking] = useState(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!activation) return null;
  const photos = activation.photos;

  async function take(files: FileList | File[] | null) {
    if (!files) return;
    setWorking(true);
    try {
      await addPhotos(Array.from(files));
    } finally {
      setWorking(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      <label
        className={cx('dropzone', dragging && 'dragging')}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void take(Array.from(event.dataTransfer.files));
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(event) => void take(event.target.files)}
          aria-label="Add location photos"
        />
        <span style={{ fontSize: '1.75rem', display: 'block', marginBottom: 8 }} aria-hidden="true">
          {working ? '◐' : '⬚'}
        </span>
        <div style={{ fontWeight: 600, color: 'var(--white)' }}>
          {working ? 'Processing photos…' : compact ? 'Add more photos' : 'Drop the location photos'}
        </div>
        <p className="small muted" style={{ marginTop: 4 }}>
          Up to {MAX_PHOTOS}. They are resized in your browser before anything is sent.
        </p>
      </label>

      {photos.length > 0 ? (
        <>
          <div className="photo-grid">
            {photos.map((photo, index) => (
              <figure key={photo.id} className="photo-cell">
                <img src={photo.previewUrl} alt={photo.note || photo.fileName} />
                <span className="photo-index">{String(index + 1).padStart(2, '0')}</span>
                <div className="photo-actions">
                  <button type="button" onClick={() => open(photo.id)} title="Enlarge">
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => movePhoto(photo.id, -1)}
                    disabled={index === 0}
                    title="Move earlier"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => movePhoto(photo.id, 1)}
                    disabled={index === photos.length - 1}
                    title="Move later"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => setNoteFor(noteFor === photo.id ? null : photo.id)}
                    title="Add a note"
                  >
                    Note
                  </button>
                  <button type="button" onClick={() => removePhoto(photo.id)} title="Remove">
                    ✕
                  </button>
                </div>
              </figure>
            ))}
          </div>

          {noteFor ? (
            <div className="panel" style={{ marginTop: 12 }}>
              <label className="field">
                <span className="field-label">
                  Note for photo {photos.findIndex((photo) => photo.id === noteFor) + 1}
                </span>
                <input
                  className="input"
                  autoFocus
                  value={photos.find((photo) => photo.id === noteFor)?.note ?? ''}
                  placeholder="e.g. this is the private room they want featured"
                  onChange={(event) => setPhotoNote(noteFor, event.target.value)}
                />
              </label>
              <button type="button" className="btn" style={{ marginTop: 10 }} onClick={() => setNoteFor(null)}>
                Done
              </button>
            </div>
          ) : null}

          <p className="small muted" style={{ marginTop: 10 }}>
            {photos.length} of {MAX_PHOTOS} photos.{' '}
            {activation.venueAnalysis
              ? 'Adding photos does not re-run the scout — use Re-analyse location when you are ready.'
              : 'The scout reads all of them together.'}
          </p>
        </>
      ) : null}
    </div>
  );
}

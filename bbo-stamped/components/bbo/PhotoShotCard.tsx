'use client';

import { useState } from 'react';
import { isPerishable } from '@/lib/coverage';
import { cx } from '@/lib/utils/format';
import type { PhotoShot, ShotPriority } from '@/types';
import { useStore } from './ActivationStore';
import { PhotoRefs } from './PhotoViewer';

const PRIORITY_CLASS: Record<ShotPriority, string> = {
  must: 'badge badge-must',
  strong: 'badge badge-strong',
  optional: 'badge badge-optional',
};

const TIMING_LABEL: Record<PhotoShot['timing'], string> = {
  'before-service': 'Before service',
  'food-untouched': 'Untouched only',
  'during-service': 'During service',
  anytime: 'Anytime',
  'end-of-visit': 'End of visit',
};

export function PhotoShotCard({
  photo,
  zoneName,
  compact = false,
}: {
  photo: PhotoShot;
  zoneName: string;
  compact?: boolean;
}) {
  const { togglePhoto, patchPhoto, activation } = useStore();
  const [expanded, setExpanded] = useState(!compact);
  const [noting, setNoting] = useState(false);


  return (
    <article className={cx('shot-row', photo.completed && 'done')} style={{ flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 14, width: '100%', alignItems: 'flex-start' }}>
        <button
          type="button"
          className={cx('check', photo.completed && 'done')}
          aria-pressed={photo.completed}
          aria-label={
            photo.completed ? `Mark ${photo.title} as not shot` : `Mark ${photo.title} shot`
          }
          onClick={() => togglePhoto(photo.id)}
        >
          ✓
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row-tight">
            <span className="badge badge-zone">Photo</span>
            <span className={PRIORITY_CLASS[photo.priority]}>{photo.priority}</span>
            {photo.clientRequired ? <span className="badge badge-client">Client</span> : null}
            {isPerishable(photo) && !photo.completed ? (
              <span className="badge badge-multi">{TIMING_LABEL[photo.timing]}</span>
            ) : null}
            {photo.locked ? <span className="badge badge-zone">Locked</span> : null}
            {photo.completed ? <span className="badge badge-done">Shot</span> : null}
          </div>

          <h3 className="shot-title" style={{ marginTop: 8 }}>
            {photo.title}
          </h3>
          <p className="small muted" style={{ marginTop: 4 }}>
            {photo.location || zoneName} · {photo.category.replace('-', ' ')}
          </p>

          {compact ? (
            <button
              type="button"
              className="btn"
              style={{ marginTop: 10 }}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? 'Less' : 'Details'}
            </button>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div style={{ width: '100%', marginTop: 14 }}>
          {photo.description ? <p className="small">{photo.description}</p> : null}
          <PhotoRefs photoIds={photo.sourcePhotoIds} />

          <dl className="spec" style={{ marginTop: 14 }}>
            {photo.onCamera ? (
              <>
                <dt>On camera</dt>
                <dd>{photo.onCamera}</dd>
              </>
            ) : photo.subject ? (
              <>
                <dt>Subject</dt>
                <dd>{photo.subject}</dd>
              </>
            ) : null}
            <dt>Frame</dt>
            <dd>
              {[photo.camera.framing, photo.camera.angle].filter(Boolean).join(' · ') ||
                'Photographer’s call'}{' '}
              · {photo.camera.orientation}
            </dd>
            {photo.styling ? (
              <>
                <dt>Styling</dt>
                <dd>{photo.styling}</dd>
              </>
            ) : null}
            <dt>When</dt>
            <dd style={isPerishable(photo) ? { color: 'var(--amber)' } : undefined}>
              {TIMING_LABEL[photo.timing]}
            </dd>
            {photo.note ? (
              <>
                <dt>Note</dt>
                <dd style={{ color: 'var(--gold-soft)' }}>{photo.note}</dd>
              </>
            ) : null}
          </dl>

          {noting ? (
            <div className="panel" style={{ marginTop: 14 }}>
              <label className="field">
                <span className="field-label">Note</span>
                <input
                  className="input"
                  autoFocus
                  value={photo.note ?? ''}
                  onChange={(event) =>
                    patchPhoto(photo.id, { note: event.target.value || undefined })
                  }
                />
              </label>
              <button
                type="button"
                className="btn"
                style={{ marginTop: 10 }}
                onClick={() => setNoting(false)}
              >
                Done
              </button>
            </div>
          ) : null}

          <div className="row-tight" style={{ marginTop: 14 }}>
            <button type="button" className="btn" onClick={() => setNoting((value) => !value)}>
              Note
            </button>
            <button
              type="button"
              className="btn btn-gold"
              onClick={() => patchPhoto(photo.id, { locked: !photo.locked })}
            >
              {photo.locked ? 'Unlock' : 'Lock'}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

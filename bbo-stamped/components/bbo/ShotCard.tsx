'use client';

import { useState } from 'react';
import { coverageMultiplier } from '@/lib/coverage';
import { cx } from '@/lib/utils/format';
import type { ReelConcept, Shot, ShotPriority } from '@/types';
import { useStore } from './ActivationStore';
import { PhotoRefs } from './PhotoViewer';
import { TagList } from './ui';

const PRIORITY_CLASS: Record<ShotPriority, string> = {
  must: 'badge badge-must',
  strong: 'badge badge-strong',
  optional: 'badge badge-optional',
};

export function ShotBadges({ shot, reels }: { shot: Shot; reels: ReelConcept[] }) {
  const selectedIds = new Set(reels.filter((reel) => reel.selected).map((reel) => reel.id));
  const multiplier = coverageMultiplier(shot, selectedIds);

  return (
    <div className="row-tight">
      <span className={PRIORITY_CLASS[shot.priority]}>{shot.priority}</span>
      {shot.clientRequired ? <span className="badge badge-client">Client</span> : null}
      {multiplier > 1 ? <span className="badge badge-multi">{multiplier}× coverage</span> : null}
      {shot.locked ? <span className="badge badge-zone">Locked</span> : null}
      {shot.completed ? <span className="badge badge-done">Captured</span> : null}
    </div>
  );
}

export function ShotCard({
  shot,
  reels,
  zoneName,
  compact = false,
}: {
  shot: Shot;
  reels: ReelConcept[];
  zoneName: string;
  compact?: boolean;
}) {
  const { toggleShot, patchShot, duplicateShot, deleteShot, activation } = useStore();
  const [expanded, setExpanded] = useState(!compact);
  const [editing, setEditing] = useState(false);
  const [noting, setNoting] = useState(false);

  const reelTitleById = new Map(reels.map((reel) => [reel.id, reel.title]));
  const neededFor = [
    ...new Set(
      shot.reelUsages
        .map((usage) => reelTitleById.get(usage.reelId))
        .filter((title): title is string => Boolean(title))
    ),
  ];

  return (
    <article className={cx('shot-row', shot.completed && 'done')} style={{ flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 14, width: '100%', alignItems: 'flex-start' }}>
        <button
          type="button"
          className={cx('check', shot.completed && 'done')}
          aria-pressed={shot.completed}
          aria-label={shot.completed ? `Mark ${shot.title} as not captured` : `Mark ${shot.title} captured`}
          onClick={() => toggleShot(shot.id)}
        >
          ✓
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <ShotBadges shot={shot} reels={reels} />
          <h3 className="shot-title" style={{ marginTop: 8 }}>
            {shot.title}
          </h3>
          <p className="small muted" style={{ marginTop: 4 }}>
            {shot.location || zoneName}
            {shot.category ? ` · ${shot.category}` : ''}
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
          {shot.description ? <p className="small">{shot.description}</p> : null}

          {neededFor.length ? (
            <div style={{ marginTop: 12 }}>
              <span className="label label-gold">Needed for</span>
              <TagList items={neededFor} tone="gold" />
            </div>
          ) : null}

          <PhotoRefs photoIds={shot.sourcePhotoIds} />

          <dl className="spec" style={{ marginTop: 14 }}>
            {shot.onCamera ? (
              <>
                <dt>On camera</dt>
                <dd>{shot.onCamera}</dd>
              </>
            ) : shot.subject ? (
              <>
                <dt>Subject</dt>
                <dd>{shot.subject}</dd>
              </>
            ) : null}
            <dt>Camera</dt>
            <dd>
              {[shot.camera.zoomOrLens, shot.camera.framing, shot.camera.movement]
                .filter(Boolean)
                .join(' · ') || 'Operator’s call'}
              {shot.camera.orientation !== 'vertical' ? ` · ${shot.camera.orientation}` : ''}
            </dd>
            {shot.talentDirection ? (
              <>
                <dt>Action</dt>
                <dd>{shot.talentDirection}</dd>
              </>
            ) : null}
            {shot.dialogue ? (
              <>
                <dt>Line</dt>
                <dd>&ldquo;{shot.dialogue}&rdquo;</dd>
              </>
            ) : null}
            <dt>Length</dt>
            <dd>
              {shot.minimumUsefulDuration}s minimum · {shot.recommendedTakeCount} take
              {shot.recommendedTakeCount === 1 ? '' : 's'}
            </dd>
            {shot.props?.length ? (
              <>
                <dt>Props</dt>
                <dd>{shot.props.join(', ')}</dd>
              </>
            ) : null}
            {shot.editingNote ? (
              <>
                <dt>Edit</dt>
                <dd>{shot.editingNote}</dd>
              </>
            ) : null}
            {shot.note ? (
              <>
                <dt>Note</dt>
                <dd style={{ color: 'var(--gold-soft)' }}>{shot.note}</dd>
              </>
            ) : null}
          </dl>

          {editing ? (
            <div className="panel" style={{ marginTop: 14 }}>
              <label className="field">
                <span className="field-label">Title</span>
                <input
                  className="input"
                  value={shot.title}
                  onChange={(event) => patchShot(shot.id, { title: event.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">Description</span>
                <textarea
                  className="textarea"
                  value={shot.description}
                  onChange={(event) => patchShot(shot.id, { description: event.target.value })}
                />
              </label>
              <div className="field field-pair">
                <label>
                  <span className="field-label">Priority</span>
                  <select
                    className="select"
                    value={shot.priority}
                    onChange={(event) =>
                      patchShot(shot.id, { priority: event.target.value as ShotPriority })
                    }
                  >
                    <option value="must">Must</option>
                    <option value="strong">Strong</option>
                    <option value="optional">Optional</option>
                  </select>
                </label>
                <label>
                  <span className="field-label">Zone</span>
                  <select
                    className="select"
                    value={shot.zoneId}
                    onChange={(event) => {
                      const zone = activation?.venueAnalysis?.zones.find(
                        (item) => item.id === event.target.value
                      );
                      patchShot(shot.id, {
                        zoneId: event.target.value,
                        location: zone?.name ?? shot.location,
                      });
                    }}
                  >
                    <option value="">Anywhere</option>
                    {(activation?.venueAnalysis?.zones ?? []).map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="field">
                <span className="field-label">Camera framing</span>
                <input
                  className="input"
                  value={shot.camera.framing}
                  onChange={(event) =>
                    patchShot(shot.id, { camera: { ...shot.camera, framing: event.target.value } })
                  }
                />
              </label>
              <button type="button" className="btn btn-active" style={{ marginTop: 12 }} onClick={() => setEditing(false)}>
                Done
              </button>
            </div>
          ) : null}

          {noting ? (
            <div className="panel" style={{ marginTop: 14 }}>
              <label className="field">
                <span className="field-label">Note</span>
                <input
                  className="input"
                  autoFocus
                  value={shot.note ?? ''}
                  placeholder="Shot it twice — second take is the one"
                  onChange={(event) => patchShot(shot.id, { note: event.target.value || undefined })}
                />
              </label>
              <button type="button" className="btn" style={{ marginTop: 10 }} onClick={() => setNoting(false)}>
                Done
              </button>
            </div>
          ) : null}

          <div className="row-tight" style={{ marginTop: 14 }}>
            <button type="button" className="btn" onClick={() => setEditing((value) => !value)}>
              Edit
            </button>
            <button type="button" className="btn" onClick={() => setNoting((value) => !value)}>
              Note
            </button>
            <button
              type="button"
              className="btn btn-gold"
              onClick={() => patchShot(shot.id, { locked: !shot.locked })}
            >
              {shot.locked ? 'Unlock' : 'Lock'}
            </button>
            <button type="button" className="btn" onClick={() => duplicateShot(shot.id)}>
              Duplicate
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={shot.locked}
              title={shot.locked ? 'Unlock before deleting' : undefined}
              onClick={() => deleteShot(shot.id)}
            >
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

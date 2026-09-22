'use client';

import { useState } from 'react';
import { computeActivationCoverage } from '@/lib/coverage';
import { relativeDay } from '@/lib/utils/format';
import { useStore } from './ActivationStore';
import { Empty, ScreenHead } from './ui';

export function SavedActivations({ onOpen, onCreate }: { onOpen: () => void; onCreate: () => void }) {
  const { activations, openActivation, removeActivation, duplicate, rename, hydrated } = useStore();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  if (!hydrated) {
    return (
      <div>
        <ScreenHead title="Saved" />
        <p className="small muted">Loading your activations…</p>
      </div>
    );
  }

  if (activations.length === 0) {
    return (
      <div>
        <ScreenHead title="Saved" />
        <Empty mark="◫" title="Nothing saved yet">
          Activations appear here the moment you name one. They stay on this device.
        </Empty>
        <button type="button" className="btn-primary" onClick={onCreate}>
          Create activation
        </button>
      </div>
    );
  }

  return (
    <div>
      <ScreenHead
        title="Saved"
        lede="Everything is stored in this browser — plans, coverage, notes and blueprints."
        action={
          <button type="button" className="btn" onClick={onCreate}>
            + New
          </button>
        }
      />

      <div className="grid-cards">
        {activations.map((item) => {
          const coverage = computeActivationCoverage(item);
          const category = item.categoryOverride || item.venueAnalysis?.business.inferredCategory;

          return (
            <article key={item.id} className="card">
              {renaming === item.id ? (
                <input
                  className="input"
                  autoFocus
                  defaultValue={item.business.name}
                  onBlur={(event) => {
                    void rename(item.id, event.target.value.trim() || item.business.name);
                    setRenaming(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    const value = (event.target as HTMLInputElement).value.trim();
                    void rename(item.id, value || item.business.name);
                    setRenaming(null);
                  }}
                />
              ) : (
                <h3 className="display" style={{ fontSize: '1.375rem', color: 'var(--white)' }}>
                  {item.business.name}
                </h3>
              )}

              <p className="small muted" style={{ marginTop: 6 }}>
                {[category, item.business.city].filter(Boolean).join(' · ') || 'Not scouted yet'}
              </p>

              {coverage.reels.length > 0 ? (
                <ul className="small" style={{ listStyle: 'none', marginTop: 12 }}>
                  {coverage.reels.slice(0, 3).map((reel) => (
                    <li key={reel.reelId} className="spread" style={{ padding: '3px 0' }}>
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {reel.title}
                      </span>
                      <span style={{ color: reel.readyToEdit ? 'var(--green)' : 'var(--muted)' }}>
                        {reel.readyToEdit ? 'Ready' : `${reel.percent}%`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="small muted" style={{ marginTop: 12 }}>
                  {item.photos.length} photo{item.photos.length === 1 ? '' : 's'} ·{' '}
                  {item.reels.length} Reels · {item.shots.length} shots
                </p>
              )}

              <p className="label" style={{ marginTop: 14 }}>
                Edited {relativeDay(item.updatedAt)}
              </p>

              <div className="row-tight" style={{ marginTop: 14 }}>
                <button
                  type="button"
                  className="btn btn-active"
                  onClick={async () => {
                    if (await openActivation(item.id)) onOpen();
                  }}
                >
                  Open
                </button>
                <button type="button" className="btn" onClick={() => void duplicate(item.id)}>
                  Duplicate
                </button>
                <button type="button" className="btn" onClick={() => setRenaming(item.id)}>
                  Rename
                </button>
                {confirmDelete === item.id ? (
                  <button
                    type="button"
                    className="btn btn-danger btn-active"
                    onClick={() => {
                      void removeActivation(item.id);
                      setConfirmDelete(null);
                    }}
                  >
                    Confirm delete
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => setConfirmDelete(item.id)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

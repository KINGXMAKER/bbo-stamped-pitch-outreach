'use client';

import { useState } from 'react';
import { computeReelCoverage } from '@/lib/coverage';
import type { BeatCoverage } from '@/lib/coverage';
import { cx, formatRange } from '@/lib/utils/format';
import type { ReelConcept, Shot } from '@/types';
import { useStore } from './ActivationStore';
import { PhotoRefs } from './PhotoViewer';
import { CopyButton, Meter, TagList } from './ui';

export function ReelTimeline({
  reel,
  beatCoverage,
}: {
  reel: ReelConcept;
  beatCoverage?: BeatCoverage[];
}) {
  const coverageById = new Map((beatCoverage ?? []).map((beat) => [beat.beatId, beat]));

  return (
    <div>
      {[...reel.sequence]
        .sort((a, b) => a.order - b.order)
        .map((beat) => {
          const cover = coverageById.get(beat.id);
          return (
            <div key={beat.id} className="beat">
              <span className="beat-clock">{formatRange(beat.startSecond, beat.endSecond)}</span>
              <div>
                <div className="beat-label">
                  {cover ? (
                    <span
                      className={cx('beat-dot', cover.covered ? 'covered' : cover.planned && 'planned')}
                      title={
                        cover.covered
                          ? 'Footage captured'
                          : cover.planned
                            ? 'Shots planned, not captured yet'
                            : 'No shot assigned yet'
                      }
                    />
                  ) : null}
                  {beat.label}
                </div>
                <p className="beat-body">{beat.description}</p>
                {beat.onScreenText ? (
                  <p className="beat-screen-text">&ldquo;{beat.onScreenText}&rdquo;</p>
                ) : null}
                {beat.dialogue ? (
                  <p className="beat-meta">
                    <strong style={{ color: 'var(--white)' }}>Dialogue:</strong> {beat.dialogue}
                  </p>
                ) : null}
                {beat.voiceover ? (
                  <p className="beat-meta">
                    <strong style={{ color: 'var(--white)' }}>VO:</strong> {beat.voiceover}
                  </p>
                ) : null}
                {beat.shotsNeeded.length ? (
                  <p className="beat-meta">
                    <strong style={{ color: 'var(--white)' }}>Footage:</strong>{' '}
                    {beat.shotsNeeded.join(' · ')}
                  </p>
                ) : null}
                {beat.editingDirection ? (
                  <p className="beat-meta" style={{ fontStyle: 'italic' }}>
                    {beat.editingDirection}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
    </div>
  );
}

export function ReelCard({
  reel,
  shots,
  onOpenBlueprint,
}: {
  reel: ReelConcept;
  shots: Shot[];
  onOpenBlueprint?: (reelId: string) => void;
}) {
  const { toggleReelSelected, toggleReelLock, runReels, busy } = useStore();
  const [open, setOpen] = useState(false);
  const coverage = computeReelCoverage(reel, shots);
  const isGroup = (reel.contentOwner ?? 'BBO') === 'BBO';
  const hasShots = coverage.linkedShots > 0;

  return (
    <article className={cx('card', reel.selected && 'card-accent')}>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="row-tight" style={{ marginBottom: 6 }}>
            {/* Group vs solo is the first thing to know about a concept: it
                decides the voice, the crew needed and whether it can be handed
                to one creator. It leads the badges for that reason. */}
            <span className={cx('badge', isGroup ? 'badge-multi' : 'badge-client')}>
              {isGroup ? 'Group · we' : 'Solo · I'}
            </span>
            {reel.angle ? <span className="badge badge-zone">{reel.angle}</span> : null}
            <span className="badge badge-strong">{reel.format}</span>
            <span className="badge badge-zone">{Math.round(reel.recommendedDuration)}s</span>
            {reel.locked ? <span className="badge badge-client">Locked</span> : null}
            {coverage.readyToEdit ? <span className="badge badge-done">Ready to edit</span> : null}
          </div>
          <h3 className="display" style={{ fontSize: '1.375rem', color: 'var(--white)' }}>
            {reel.title}
          </h3>
        </div>

        <button
          type="button"
          className={cx('btn', reel.selected && 'btn-active')}
          aria-pressed={reel.selected}
          onClick={() => toggleReelSelected(reel.id)}
          style={{ flexShrink: 0 }}
        >
          {reel.selected ? '✓ Shooting' : 'Shoot this'}
        </button>
      </div>

      {reel.hook ? (
        <p className="quote" style={{ marginTop: 14 }}>
          {reel.hook}
        </p>
      ) : null}

      <p className="small" style={{ marginTop: 12 }}>
        {reel.concept}
      </p>
      {reel.goal ? (
        <p className="small muted" style={{ marginTop: 6 }}>
          <strong style={{ color: 'var(--white)' }}>Goal:</strong> {reel.goal}
        </p>
      ) : null}

      {hasShots ? (
        <div style={{ marginTop: 16 }}>
          <div className="spread" style={{ marginBottom: 6 }}>
            <span className="label">Coverage</span>
            <span className="small" style={{ color: coverage.readyToEdit ? 'var(--green)' : 'var(--white)' }}>
              {coverage.completedRequired} / {coverage.requiredShots} shots · {coverage.percent}%
            </span>
          </div>
          <Meter percent={coverage.percent} ready={coverage.readyToEdit} />
        </div>
      ) : null}

      <PhotoRefs photoIds={reel.sourcePhotoIds} />

      <div className="row-tight" style={{ marginTop: 16 }}>
        <button type="button" className="btn" onClick={() => setOpen((value) => !value)}>
          {open ? 'Hide timeline' : `Timeline · ${reel.sequence.length} beats`}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy !== null || reel.locked}
          onClick={() => void runReels({ only: reel.id })}
          title={reel.locked ? 'Unlock this Reel first' : 'Rewrite just this Reel'}
        >
          Regenerate
        </button>
        <button type="button" className="btn btn-gold" onClick={() => toggleReelLock(reel.id)}>
          {reel.locked ? 'Unlock' : 'Lock'}
        </button>
        {coverage.readyToEdit && onOpenBlueprint ? (
          <button type="button" className="btn btn-active" onClick={() => onOpenBlueprint(reel.id)}>
            Edit blueprint
          </button>
        ) : null}
      </div>

      {open ? (
        <div style={{ marginTop: 18 }}>
          <div className="divider" />
          <ReelTimeline reel={reel} beatCoverage={hasShots ? coverage.beats : undefined} />

          <div className="divider" />
          <span className="label label-gold">Audio direction</span>
          <p className="small" style={{ marginTop: 6 }}>
            <strong style={{ color: 'var(--white)' }}>{reel.audioDirection.type}</strong> —{' '}
            {reel.audioDirection.direction}
          </p>
          {reel.audioDirection.searchTerms?.length ? (
            <TagList items={reel.audioDirection.searchTerms} tone="gold" />
          ) : null}

          {reel.captionIdeas.length ? (
            <>
              <div className="divider" />
              <span className="label label-gold">Caption ideas</span>
              <div className="stack-sm" style={{ marginTop: 8 }}>
                {reel.captionIdeas.map((caption) => (
                  <div key={caption} className="panel">
                    <p className="small">{caption}</p>
                    <div style={{ marginTop: 8 }}>
                      <CopyButton text={caption} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

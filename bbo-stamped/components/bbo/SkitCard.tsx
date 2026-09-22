'use client';

import { useState } from 'react';
import { cx } from '@/lib/utils/format';
import type { SkitConcept } from '@/types';
import { useStore } from './ActivationStore';
import { PhotoRefs } from './PhotoViewer';
import { CopyButton, TagList } from './ui';

/** The one-tap rewrites the Skit Lab offers. Each becomes a steer on regeneration. */
const STEERS: Array<{ label: string; steer: string }> = [
  { label: 'Funnier', steer: 'Push the comedy harder — sharper turn, bigger reaction.' },
  { label: 'Messier', steer: 'Make it messier and more chaotic — let it go wrong on camera.' },
  { label: 'More relatable', steer: 'Make the situation something the audience has personally lived.' },
  { label: 'More viral', steer: 'Front-load the conflict so the first two seconds stop the scroll.' },
  { label: 'Easier to film', steer: 'Cut it to two setups a small crew can shoot in ten minutes.' },
  { label: '20 seconds', steer: 'Compress every concept to roughly 20 seconds.' },
  { label: 'Turn into POV', steer: 'Rewrite as first-person POV pieces addressed to camera.' },
];

export function SkitSteerBar({ disabled }: { disabled: boolean }) {
  const { runSkits } = useStore();
  return (
    <div className="row-tight">
      {STEERS.map((option) => (
        <button
          key={option.label}
          type="button"
          className="btn"
          disabled={disabled}
          onClick={() => void runSkits({ steer: option.steer })}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SkitCard({ skit, zoneName }: { skit: SkitConcept; zoneName: string }) {
  const { toggleSkitSelected, toggleSkitLock, addSkitToShoot } = useStore();
  const [open, setOpen] = useState(false);

  const script = [
    skit.title,
    '',
    skit.premise,
    '',
    ...skit.beats
      .sort((a, b) => a.order - b.order)
      .map((beat) =>
        [`${beat.order}. ${beat.action}`, beat.dialogue ? `   "${beat.dialogue}"` : '', `   → ${beat.shotDirection}`]
          .filter(Boolean)
          .join('\n')
      ),
    '',
    `Ending: ${skit.ending}`,
    `On screen: ${skit.onScreenText}`,
    `Caption: ${skit.captionAngle}`,
  ].join('\n');

  return (
    <article className={cx('card', skit.selected && 'card-accent')}>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="row-tight" style={{ marginBottom: 6 }}>
            <span className="badge badge-strong">{skit.difficulty}</span>
            <span className="badge badge-zone">{Math.round(skit.estimatedDuration)}s</span>
            <span className="badge badge-zone">
              {skit.castSize} cast · {zoneName}
            </span>
            {skit.addedToShoot ? <span className="badge badge-done">In shot list</span> : null}
            {skit.locked ? <span className="badge badge-client">Locked</span> : null}
          </div>
          <h3 className="display" style={{ fontSize: '1.25rem', color: 'var(--white)' }}>
            {skit.title}
          </h3>
        </div>
        <button
          type="button"
          className={cx('btn', skit.selected && 'btn-active')}
          aria-pressed={skit.selected}
          onClick={() => toggleSkitSelected(skit.id)}
          style={{ flexShrink: 0 }}
        >
          {skit.selected ? '✓ Selected' : 'Select'}
        </button>
      </div>

      {skit.hook ? (
        <p className="quote" style={{ marginTop: 14 }}>
          {skit.hook}
        </p>
      ) : null}

      <p className="small" style={{ marginTop: 12 }}>
        {skit.premise}
      </p>

      {skit.whyThisLocationWorks ? (
        <div className="callout callout-gold" style={{ marginTop: 12 }}>
          <span className="label label-gold">Why it only works here</span>
          <p className="small" style={{ marginTop: 6 }}>
            {skit.whyThisLocationWorks}
          </p>
        </div>
      ) : null}

      <PhotoRefs photoIds={skit.sourcePhotoIds} />

      <div className="row-tight" style={{ marginTop: 16 }}>
        <button type="button" className="btn" onClick={() => setOpen((value) => !value)}>
          {open ? 'Hide script' : `Script · ${skit.beats.length} beats`}
        </button>
        <button
          type="button"
          className="btn btn-active"
          disabled={skit.addedToShoot}
          onClick={() => addSkitToShoot(skit.id)}
        >
          {skit.addedToShoot ? 'Added' : 'Add to shoot'}
        </button>
        <button type="button" className="btn btn-gold" onClick={() => toggleSkitLock(skit.id)}>
          {skit.locked ? 'Unlock' : 'Lock'}
        </button>
        <CopyButton text={script} label="Copy script" />
      </div>

      {open ? (
        <div style={{ marginTop: 18 }}>
          <div className="divider" />
          {skit.characters.length ? (
            <TagList items={skit.characters.map((c) => `${c.name} — ${c.role}`)} tone="pink" />
          ) : null}
          {skit.props.length ? <TagList items={skit.props} tone="gold" /> : null}

          {[...skit.beats]
            .sort((a, b) => a.order - b.order)
            .map((beat) => (
              <div key={beat.order} className="beat">
                <span className="beat-clock">{String(beat.order).padStart(2, '0')}</span>
                <div>
                  <p className="beat-body">{beat.action}</p>
                  {beat.dialogue ? (
                    <p className="beat-screen-text">&ldquo;{beat.dialogue}&rdquo;</p>
                  ) : null}
                  <p className="beat-meta">{beat.shotDirection}</p>
                </div>
              </div>
            ))}

          <div className="divider" />
          <dl className="spec">
            <dt>Ending</dt>
            <dd>{skit.ending}</dd>
            {skit.viralMechanic ? (
              <>
                <dt>Why it travels</dt>
                <dd>{skit.viralMechanic}</dd>
              </>
            ) : null}
            {skit.onScreenText ? (
              <>
                <dt>On screen</dt>
                <dd>{skit.onScreenText}</dd>
              </>
            ) : null}
            {skit.captionAngle ? (
              <>
                <dt>Caption</dt>
                <dd>{skit.captionAngle}</dd>
              </>
            ) : null}
            {skit.editingDirection ? (
              <>
                <dt>Edit</dt>
                <dd>{skit.editingDirection}</dd>
              </>
            ) : null}
          </dl>
        </div>
      ) : null}
    </article>
  );
}

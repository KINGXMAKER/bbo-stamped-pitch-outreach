'use client';

import { useMemo, useState } from 'react';
import { groupShotsByZone, pickNextBestCapture } from '@/lib/coverage';
import type { ShootContext } from '@/lib/coverage';
import { cx } from '@/lib/utils/format';
import type { BBOActivation } from '@/types';
import { useStore } from './ActivationStore';
import { LeaveCheck } from './LeaveCheck';
import { PhotoShotCard } from './PhotoShotCard';
import { ReelCoverage } from './ReelCoverage';
import { ShotCard } from './ShotCard';
import { Empty, ScreenHead, SectionHead } from './ui';

export function ShootMode({
  activation,
  onOpenBlueprints,
}: {
  activation: BBOActivation;
  onOpenBlueprints: () => void;
}) {
  const { toggleShot, togglePhoto, update } = useStore();
  const [zoneId, setZoneId] = useState<string>('all');
  const [showDone, setShowDone] = useState(false);
  const [serviceStarted, setServiceStarted] = useState(false);
  const [groupPresent, setAllTalentPresent] = useState(true);

  const zones = useMemo(() => groupShotsByZone(activation), [activation]);

  const context: ShootContext = {
    currentZoneId: zoneId === 'all' ? undefined : zoneId,
    serviceStarted,
    groupPresent,
  };
  const nextBest = useMemo(
    () => pickNextBestCapture(activation, context),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activation, zoneId, serviceStarted, groupPresent]
  );

  const hasPlan = activation.shots.length > 0 || (activation.photoPlan?.length ?? 0) > 0;
  if (!hasPlan) {
    return (
      <div>
        <ScreenHead title="Shoot" />
        <Empty mark="◎" title="No capture list yet">
          Pick your Reels, build the master shot list and the photo plan first. Shoot mode is what
          you actually hold in your hand at the venue.
        </Empty>
      </div>
    );
  }

  const visibleZones = zoneId === 'all' ? zones : zones.filter((zone) => zone.zoneId === zoneId);

  return (
    <div>
      <ReelCoverage activation={activation} />

      <SectionHead label="On the day" />
      <div className="card">
        <div className="row-tight">
          <button
            type="button"
            className={cx('btn', serviceStarted && 'btn-active')}
            aria-pressed={serviceStarted}
            onClick={() => setServiceStarted((value) => !value)}
          >
            {serviceStarted ? '✓ Food / product is out' : 'Food / product is out'}
          </button>
          <button
            type="button"
            className={cx('btn', groupPresent && 'btn-active')}
            aria-pressed={groupPresent}
            onClick={() => setAllTalentPresent((value) => !value)}
          >
            {groupPresent ? '✓ Everyone is here' : 'Everyone is here'}
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          These change what is urgent. Once the food is out, untouched frames are on a clock.
        </p>
      </div>

      <SectionHead label="I'm at" />
      <div className="scroll-x">
        <div className="row-tight" style={{ flexWrap: 'nowrap', paddingBottom: 4 }}>
          <button
            type="button"
            className={cx('btn', zoneId === 'all' && 'btn-active')}
            onClick={() => setZoneId('all')}
          >
            Everywhere
          </button>
          {zones.map((zone) => (
            <button
              key={zone.zoneId}
              type="button"
              className={cx('btn', zoneId === zone.zoneId && 'btn-active')}
              onClick={() => setZoneId(zone.zoneId)}
              style={{ whiteSpace: 'nowrap' }}
            >
              {zone.name} · {zone.completed}/{zone.total}
            </button>
          ))}
        </div>
      </div>

      {nextBest ? (
        <section className="card card-accent" style={{ marginTop: 18 }}>
          <div className="row-tight">
            <span className="label label-pink">Next best capture</span>
            <span className="badge badge-zone">{nextBest.kind === 'photo' ? 'Photo' : 'Video'}</span>
          </div>
          <h2 className="display" style={{ fontSize: '1.625rem', color: 'var(--white)', marginTop: 8 }}>
            {nextBest.title}
          </h2>
          <p className="small muted" style={{ marginTop: 4 }}>
            {nextBest.location}
          </p>

          {nextBest.reasons.length ? (
            <ul className="small" style={{ margin: '12px 0 0 16px' }}>
              {nextBest.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}

          <div className="row-tight" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="btn btn-active"
              style={{ minHeight: 48, flex: 1 }}
              onClick={() =>
                nextBest.kind === 'photo' ? togglePhoto(nextBest.id) : toggleShot(nextBest.id)
              }
            >
              ✓ Got it
            </button>
            {nextBest.zoneId ? (
              <button
                type="button"
                className="btn"
                style={{ minHeight: 48 }}
                onClick={() => setZoneId(nextBest.zoneId)}
              >
                Show this zone
              </button>
            ) : null}
          </div>
        </section>
      ) : (
        <div className="callout callout-green" style={{ marginTop: 18 }}>
          <span className="label" style={{ color: 'var(--green)' }}>
            Everything on the list is captured
          </span>
        </div>
      )}

      <div className="spread" style={{ marginTop: 26 }}>
        <span className="label label-pink">Capture list</span>
        <button type="button" className="btn" onClick={() => setShowDone((value) => !value)}>
          {showDone ? 'Hide captured' : 'Show captured'}
        </button>
      </div>

      {visibleZones.map((zone) => {
        const shots = showDone ? zone.shots : zone.shots.filter((shot) => !shot.completed);
        const photos = showDone ? zone.photos : zone.photos.filter((photo) => !photo.completed);
        if (shots.length === 0 && photos.length === 0) return null;
        return (
          <section key={zone.zoneId} style={{ marginTop: 20 }}>
            <div className="spread" style={{ marginBottom: 10 }}>
              <h3 className="display" style={{ fontSize: '1.125rem', color: 'var(--white)' }}>
                {zone.name}
              </h3>
              <span className="label">
                {zone.completed} / {zone.total}
              </span>
            </div>
            <div className="stack-sm">
              {photos.map((photo) => (
                <PhotoShotCard key={photo.id} photo={photo} zoneName={zone.name} compact />
              ))}
              {shots.map((shot) => (
                <ShotCard
                  key={shot.id}
                  shot={shot}
                  reels={activation.reels}
                  zoneName={zone.name}
                  compact
                />
              ))}
            </div>
          </section>
        );
      })}

      <LeaveCheck activation={activation} />

      <SectionHead label="Verdict" />
      <div className="card">
        <div className="row-tight">
          <button
            type="button"
            className={cx('btn', activation.verdict?.value === 'stamped' && 'btn-active')}
            style={{ minHeight: 52, flex: 1 }}
            onClick={() =>
              update((state) => ({
                ...state,
                verdict: { value: 'stamped', notes: state.verdict?.notes },
              }))
            }
          >
            💋 Stamped
          </button>
          <button
            type="button"
            className={cx('btn', activation.verdict?.value === 'clipped' && 'btn-active')}
            style={{ minHeight: 52, flex: 1 }}
            onClick={() =>
              update((state) => ({
                ...state,
                verdict: { value: 'clipped', notes: state.verdict?.notes },
              }))
            }
          >
            ✂️ Clipped
          </button>
        </div>
        <label className="field" style={{ marginTop: 14 }}>
          <span className="field-label">Verdict notes</span>
          <textarea
            className="textarea"
            value={activation.verdict?.notes ?? ''}
            placeholder="Why it landed the way it did."
            onChange={(event) =>
              update((state) => ({
                ...state,
                verdict: {
                  value: state.verdict?.value ?? 'stamped',
                  notes: event.target.value || undefined,
                },
              }))
            }
          />
        </label>
      </div>

      <div style={{ marginTop: 20 }}>
        <button type="button" className="btn-primary ghost" onClick={onOpenBlueprints}>
          Finish shoot → edit blueprints
        </button>
      </div>
    </div>
  );
}

'use client';

import { computeActivationCoverage } from '@/lib/coverage';
import type { BBOActivation } from '@/types';
import { Meter } from './ui';

export function ReelCoverage({
  activation,
  sticky = true,
}: {
  activation: BBOActivation;
  sticky?: boolean;
}) {
  const coverage = computeActivationCoverage(activation);
  const photoCount = activation.photoPlan?.length ?? 0;
  if (activation.shots.length === 0 && photoCount === 0) return null;

  return (
    <section
      className="coverage-bar"
      style={sticky ? undefined : { position: 'static' }}
      aria-label="Shoot coverage"
    >
      <div className="spread">
        <div>
          <div className="display" style={{ fontSize: '1.25rem', color: 'var(--white)' }}>
            {activation.business.name}
          </div>
          <span className="label" style={{ marginTop: 2, display: 'block' }}>
            {coverage.completedShots} / {coverage.totalShots} shots · {coverage.photos.completed} /{' '}
            {coverage.photos.total} photos
          </span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="pct">{coverage.percent}%</div>
          {coverage.mustRemaining > 0 ? (
            <span className="label label-pink">{coverage.mustRemaining} must left</span>
          ) : (
            <span className="label" style={{ color: 'var(--green)' }}>
              All musts done
            </span>
          )}
        </div>
      </div>

      {coverage.reels.length > 0 || photoCount > 0 ? (
        <div style={{ marginTop: 12 }}>
          {photoCount > 0 ? (
            <div className="coverage-row">
              <span className="name">Photos</span>
              <Meter percent={coverage.photos.percent} ready={coverage.photos.complete} />
              <span
                className="val"
                style={coverage.photos.complete ? { color: 'var(--green)' } : undefined}
              >
                {coverage.photos.complete ? 'Done' : `${coverage.photos.percent}%`}
              </span>
            </div>
          ) : null}
          {coverage.reels.map((reel) => (
            <div key={reel.reelId} className="coverage-row">
              <span className="name" title={reel.title}>
                {reel.title}
              </span>
              <Meter percent={reel.percent} ready={reel.readyToEdit} />
              <span className="val" style={reel.readyToEdit ? { color: 'var(--green)' } : undefined}>
                {reel.readyToEdit ? 'Ready' : `${reel.percent}%`}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {coverage.clientRemaining > 0 ? (
        <p className="small" style={{ color: 'var(--gold)', marginTop: 8 }}>
          {coverage.clientRemaining} client request
          {coverage.clientRemaining === 1 ? '' : 's'} still uncaptured.
        </p>
      ) : null}
    </section>
  );
}

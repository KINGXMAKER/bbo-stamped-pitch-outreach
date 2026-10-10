'use client';

import { computeReelCoverage } from '@/lib/coverage';
import { buildEditPromptText } from '@/lib/export/text';
import { formatRange } from '@/lib/utils/format';
import type { BBOActivation, ReelConcept } from '@/types';
import { useStore } from './ActivationStore';
import { CopyButton, ErrorBox, SectionHead } from './ui';

export function EditBlueprintPanel({
  activation,
  reel,
}: {
  activation: BBOActivation;
  reel: ReelConcept;
}) {
  const { runBlueprint, busy, errors, clearError } = useStore();
  const blueprint = activation.editBlueprints.find((item) => item.reelId === reel.id);
  const coverage = computeReelCoverage(reel, activation.shots);
  const shotById = new Map(activation.shots.map((shot) => [shot.id, shot]));
  const generating = busy === 'blueprint';

  return (
    <section className="card card-accent card-accent-gold">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <span className="label label-gold">Edit blueprint</span>
          <h3 className="display" style={{ fontSize: '1.375rem', color: 'var(--white)', marginTop: 6 }}>
            {reel.title}
          </h3>
          <p className="small muted" style={{ marginTop: 4 }}>
            Target {blueprint?.targetDuration || `${Math.round(reel.recommendedDuration)} seconds`} ·{' '}
            {coverage.completedRequired}/{coverage.requiredShots} shots captured
          </p>
        </div>
        <button
          type="button"
          className="btn btn-gold"
          disabled={generating || coverage.completedRequired === 0}
          onClick={() => void runBlueprint(reel.id)}
        >
          {generating ? 'Writing…' : blueprint ? 'Rebuild' : 'Build blueprint'}
        </button>
      </div>

      {errors.blueprint ? (
        <div style={{ marginTop: 14 }}>
          <ErrorBox message={errors.blueprint} onDismiss={() => clearError('blueprint')} />
        </div>
      ) : null}

      {!blueprint ? (
        <p className="small muted" style={{ marginTop: 16 }}>
          {coverage.completedRequired === 0
            ? 'Tick some footage off in Shoot mode first — the blueprint only ever references clips you actually captured.'
            : 'Build the blueprint when you are done shooting. You can still copy the planned sequence below.'}
        </p>
      ) : (
        <div style={{ marginTop: 18 }}>
          <SectionHead label="Shot order" tone="gold" />
          {[...blueprint.clips]
            .sort((a, b) => a.order - b.order)
            .map((clip) => {
              const shot = clip.shotId ? shotById.get(clip.shotId) : undefined;
              return (
                <div key={`${clip.order}-${clip.shotTitle}`} className="beat">
                  <span className="beat-clock">{formatRange(clip.startSecond, clip.endSecond)}</span>
                  <div>
                    <div className="beat-label">
                      {String(clip.order).padStart(2, '0')} · {shot?.title ?? clip.shotTitle}
                    </div>
                    {shot ? (
                      <p className="beat-meta">
                        {shot.location || shot.zoneId} · {shot.camera.framing}
                      </p>
                    ) : null}
                    {clip.direction ? <p className="beat-body">{clip.direction}</p> : null}
                  </div>
                </div>
              );
            })}

          <div className="divider" />
          <dl className="spec" style={{ gridTemplateColumns: '104px 1fr' }}>
            {blueprint.hookTreatment ? (
              <>
                <dt>Hook</dt>
                <dd>{blueprint.hookTreatment}</dd>
              </>
            ) : null}
            {blueprint.pacing ? (
              <>
                <dt>Pacing</dt>
                <dd>{blueprint.pacing}</dd>
              </>
            ) : null}
            {blueprint.dialoguePlacement ? (
              <>
                <dt>Dialogue</dt>
                <dd>{blueprint.dialoguePlacement}</dd>
              </>
            ) : null}
            {blueprint.brollCoverage ? (
              <>
                <dt>B-roll</dt>
                <dd>{blueprint.brollCoverage}</dd>
              </>
            ) : null}
            {blueprint.transitions ? (
              <>
                <dt>Cuts</dt>
                <dd>{blueprint.transitions}</dd>
              </>
            ) : null}
            {blueprint.slowMotionMoments.length ? (
              <>
                <dt>Slow-mo</dt>
                <dd>{blueprint.slowMotionMoments.join(' · ')}</dd>
              </>
            ) : null}
            {blueprint.audioTreatment ? (
              <>
                <dt>Audio</dt>
                <dd>{blueprint.audioTreatment}</dd>
              </>
            ) : null}
            {blueprint.ending ? (
              <>
                <dt>Ending</dt>
                <dd>{blueprint.ending}</dd>
              </>
            ) : null}
          </dl>

          {blueprint.onScreenText.length ? (
            <div className="callout callout-gold" style={{ marginTop: 14 }}>
              <span className="label label-gold">On-screen text</span>
              <ul className="small" style={{ margin: '8px 0 0 16px' }}>
                {blueprint.onScreenText.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      <div className="row-tight" style={{ marginTop: 18 }}>
        <CopyButton
          className="btn btn-active"
          label="Copy edit prompt"
          text={buildEditPromptText(activation, reel, blueprint)}
        />
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        Paste straight into ChatCut, Claude, or your editor’s notes.
      </p>
    </section>
  );
}

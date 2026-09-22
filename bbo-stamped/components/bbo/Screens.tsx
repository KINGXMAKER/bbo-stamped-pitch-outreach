'use client';

import { useMemo, useState } from 'react';
import { computeActivationCoverage, computePhotoCoverage, coverageMultiplier, groupShotsByZone } from '@/lib/coverage';
import { buildEditPromptText, buildShootPlanText, downloadJson } from '@/lib/export/text';
import { cx } from '@/lib/utils/format';
import type { BBOActivation } from '@/types';
import { useStore } from './ActivationStore';
import { EditBlueprintPanel } from './EditBlueprint';
import { LocationScoutReport } from './LocationScout';
import { PhotoUploader } from './PhotoUploader';
import { ReelCard } from './ReelCard';
import { ReelCoverage } from './ReelCoverage';
import { PhotoShotCard } from './PhotoShotCard';
import { ProviderDebug } from './ProviderDebug';
import { ShotCard } from './ShotCard';
import { DEFAULT_FILTERS, ShotFilters, applyShotFilters } from './ShotFilters';
import type { ShotFilterState } from './ShotFilters';
import { SkitCard, SkitSteerBar } from './SkitCard';
import { CopyButton, Empty, ErrorBox, ScreenHead, SectionHead } from './ui';

// ── REELS ────────────────────────────────────────────────────────────────────

export function ReelsScreen({
  activation,
  onShotsBuilt,
}: {
  activation: BBOActivation;
  onShotsBuilt: () => void;
}) {
  const { runReels, runShots, busy, errors, clearError } = useStore();
  const [blueprintFor, setBlueprintFor] = useState<string | null>(null);

  if (!activation.venueAnalysis) {
    return (
      <div>
        <ScreenHead title="Reels" />
        <Empty mark="◐" title="Scout the location first">
          The Reel producer works from the scouting report, so it never has to guess what the room
          looks like.
        </Empty>
      </div>
    );
  }

  const selected = activation.reels.filter((reel) => reel.selected);
  const blueprintReel = blueprintFor
    ? activation.reels.find((reel) => reel.id === blueprintFor)
    : null;

  return (
    <div>
      <ScreenHead
        title="Reels"
        lede="Each concept is a real timeline. Pick the ones you are actually shooting, then build one shot list that serves all of them."
      />

      <LocationScoutReport />

      <SectionHead
        label="Reel concepts"
        note={activation.reels.length ? `${selected.length} selected` : undefined}
      />

      {errors.reels ? (
        <div style={{ marginBottom: 14 }}>
          <ErrorBox
            message={errors.reels}
            onRetry={() => void runReels()}
            onDismiss={() => clearError('reels')}
          />
        </div>
      ) : null}

      {activation.reels.length === 0 ? (
        <>
          <Empty mark="▤" title="No Reel concepts yet">
            The producer reads the scouting report and designs the Reels that fit this exact place.
          </Empty>
          <button
            type="button"
            className="btn-primary"
            disabled={busy !== null}
            onClick={() => void runReels({ count: 4 })}
          >
            {busy === 'reels' ? 'Writing…' : 'Generate Reel concepts'}
          </button>
        </>
      ) : (
        <>
          <div className="stack">
            {activation.reels.map((reel) => (
              <ReelCard
                key={reel.id}
                reel={reel}
                shots={activation.shots}
                onOpenBlueprint={(id) => setBlueprintFor(id)}
              />
            ))}
          </div>

          {blueprintReel ? (
            <div style={{ marginTop: 18 }}>
              <EditBlueprintPanel activation={activation} reel={blueprintReel} />
              <button type="button" className="btn" style={{ marginTop: 12 }} onClick={() => setBlueprintFor(null)}>
                Close blueprint
              </button>
            </div>
          ) : null}

          <div className="row-tight" style={{ marginTop: 18 }}>
            <button
              type="button"
              className="btn"
              disabled={busy !== null}
              onClick={() => void runReels()}
            >
              {busy === 'reels' ? 'Working…' : 'Regenerate unlocked Reels'}
            </button>
            <span className="small muted">Locked Reels are never touched.</span>
          </div>

          {errors.shots ? (
            <div style={{ marginTop: 16 }}>
              <ErrorBox
                message={errors.shots}
                onRetry={() => void runShots()}
                onDismiss={() => clearError('shots')}
              />
            </div>
          ) : null}

          <div style={{ marginTop: 20 }}>
            <button
              type="button"
              className="btn-primary"
              disabled={selected.length === 0 || busy !== null}
              onClick={async () => {
                if (await runShots()) onShotsBuilt();
              }}
            >
              {busy === 'shots' ? 'Building…' : 'Build master shot list'}
            </button>
            {selected.length === 0 ? (
              <p className="small muted" style={{ marginTop: 10, textAlign: 'center' }}>
                Choose at least one Reel to shoot.
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

// ── SHOTS ────────────────────────────────────────────────────────────────────

export function ShotsScreen({ activation }: { activation: BBOActivation }) {
  const { runShots, runPhotoPlan, addCustomShot, busy, errors, clearError } = useStore();
  const [filters, setFilters] = useState<ShotFilterState>(DEFAULT_FILTERS);
  const [lane, setLane] = useState<'video' | 'photos'>('video');

  const zones = useMemo(() => groupShotsByZone(activation), [activation]);
  const zoneNameById = new Map(zones.map((zone) => [zone.zoneId, zone.name]));
  const visible = applyShotFilters(activation.shots, filters);

  const selectedReelIds = new Set(
    activation.reels.filter((reel) => reel.selected).map((reel) => reel.id)
  );
  const shared = activation.shots.filter(
    (shot) => coverageMultiplier(shot, selectedReelIds) > 1
  ).length;
  const coverage = computeActivationCoverage(activation);

  const photos = activation.photoPlan ?? [];
  const photoCoverage = computePhotoCoverage(photos);

  if (activation.shots.length === 0 && photos.length === 0) {
    return (
      <div>
        <ScreenHead title="Shots" />
        <Empty mark="◇" title="No capture list yet">
          Select your Reels, then build the master shot list. Shots that serve more than one Reel
          are merged into a single camera setup.
        </Empty>
      </div>
    );
  }

  return (
    <div>
      <ScreenHead
        title="Master shot list"
        lede={`${activation.shots.length} shots for ${selectedReelIds.size} Reels${
          shared > 0 ? ` — ${shared} of them serve more than one Reel` : ''
        }.`}
      />

      <ReelCoverage activation={activation} sticky={false} />

      <div className="row-tight" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={cx('btn', lane === 'video' && 'btn-active')}
          aria-pressed={lane === 'video'}
          onClick={() => setLane('video')}
        >
          Video · {activation.shots.length}
        </button>
        <button
          type="button"
          className={cx('btn', lane === 'photos' && 'btn-active')}
          aria-pressed={lane === 'photos'}
          onClick={() => setLane('photos')}
        >
          Photos · {photos.length}
        </button>
      </div>

      {lane === 'photos' ? (
        <PhotoLane
          activation={activation}
          onBuild={() => void runPhotoPlan()}
          busy={busy === 'photoPlan'}
          error={errors.photoPlan}
          onDismiss={() => clearError('photoPlan')}
          coverage={photoCoverage}
        />
      ) : null}

      {lane === 'video' && errors.shots ? (
        <div style={{ marginBottom: 14 }}>
          <ErrorBox
            message={errors.shots}
            onRetry={() => void runShots()}
            onDismiss={() => clearError('shots')}
          />
        </div>
      ) : null}

      {lane === 'video' ? (
        <>
      <ShotFilters activation={activation} filters={filters} onChange={setFilters} />

      <div className="spread" style={{ marginTop: 18 }}>
        <span className="label label-pink">
          {visible.length} of {activation.shots.length} shown · {coverage.completedShots} captured
        </span>
        <div className="row-tight">
          <button type="button" className="btn" onClick={addCustomShot}>
            + Custom shot
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={() => void runShots()}
          >
            {busy === 'shots' ? 'Working…' : 'Regenerate unlocked'}
          </button>
        </div>
      </div>

      <p className="small muted" style={{ marginTop: 6 }}>
        Captured, locked and client-required shots survive every regeneration.
      </p>

      <div className="stack-sm" style={{ marginTop: 16 }}>
        {visible.length === 0 ? (
          <Empty mark="⌀" title="Nothing matches those filters">
            Loosen a filter to see the rest of the list.
          </Empty>
        ) : (
          visible.map((shot) => (
            <ShotCard
              key={shot.id}
              shot={shot}
              reels={activation.reels}
              zoneName={zoneNameById.get(shot.zoneId) ?? 'Anywhere'}
              compact
            />
          ))
        )}
      </div>
        </>
      ) : null}
    </div>
  );
}

/** The stills lane. Separate coverage, separate deadlines, same shoot. */
function PhotoLane({
  activation,
  onBuild,
  busy,
  error,
  onDismiss,
  coverage,
}: {
  activation: BBOActivation;
  onBuild: () => void;
  busy: boolean;
  error?: string;
  onDismiss: () => void;
  coverage: ReturnType<typeof computePhotoCoverage>;
}) {
  const photos = activation.photoPlan ?? [];
  const zoneNameById = new Map(
    (activation.venueAnalysis?.zones ?? []).map((zone) => [zone.id, zone.name])
  );

  return (
    <div>
      {error ? (
        <div style={{ marginBottom: 14 }}>
          <ErrorBox message={error} onRetry={onBuild} onDismiss={onDismiss} />
        </div>
      ) : null}

      {photos.length === 0 ? (
        <>
          <Empty mark="▣" title="No photo plan yet">
            Stills are their own deliverable — hero food, the full spread, the group hero, and every
            client must-have.
          </Empty>
          <button type="button" className="btn-primary" disabled={busy} onClick={onBuild}>
            {busy ? 'Planning…' : 'Build photo plan'}
          </button>
        </>
      ) : (
        <>
          <div className="card">
            <div className="spread">
              <div>
                <span className="label label-gold">Photo coverage</span>
                <p className="small muted" style={{ marginTop: 4 }}>
                  {coverage.requiredCompleted} / {coverage.requiredTotal} required ·{' '}
                  {coverage.completed} of {coverage.total} shot
                </p>
              </div>
              <div className="pct" style={coverage.complete ? { color: 'var(--green)' } : undefined}>
                {coverage.percent}%
              </div>
            </div>
            {coverage.perishableRemaining.length > 0 ? (
              <div className="callout callout-gold" style={{ marginTop: 14 }}>
                <span className="label label-gold">Shoot these before the visit moves on</span>
                <ul className="small" style={{ margin: '8px 0 0 16px' }}>
                  {coverage.perishableRemaining.map((photo) => (
                    <li key={photo.id}>{photo.title}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="spread" style={{ marginTop: 18 }}>
            <span className="label label-gold">{photos.length} planned frames</span>
            <button type="button" className="btn" disabled={busy} onClick={onBuild}>
              {busy ? 'Working…' : 'Regenerate unlocked'}
            </button>
          </div>

          <div className="stack-sm" style={{ marginTop: 16 }}>
            {photos.map((photo) => (
              <PhotoShotCard
                key={photo.id}
                photo={photo}
                zoneName={zoneNameById.get(photo.zoneId) ?? 'Anywhere'}
                compact
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── SKITS ────────────────────────────────────────────────────────────────────

export function SkitsScreen({ activation }: { activation: BBOActivation }) {
  const { runSkits, busy, errors, clearError } = useStore();
  const zoneNameById = new Map(
    (activation.venueAnalysis?.zones ?? []).map((zone) => [zone.id, zone.name])
  );

  if (!activation.venueAnalysis) {
    return (
      <div>
        <ScreenHead title="Skit lab" />
        <Empty mark="☺" title="Scout the location first">
          Skits here are built from the actual room — the furniture, the signage, the props in your
          photos.
        </Empty>
      </div>
    );
  }

  return (
    <div>
      <ScreenHead
        title="Skit lab"
        lede="Every concept has to use something that is physically in this venue. If it would work anywhere, it does not belong here."
      />

      {errors.skits ? (
        <div style={{ marginBottom: 14 }}>
          <ErrorBox
            message={errors.skits}
            onRetry={() => void runSkits()}
            onDismiss={() => clearError('skits')}
          />
        </div>
      ) : null}

      {activation.skits.length === 0 ? (
        <>
          <Empty mark="☺" title="No skits yet">
            Generate location-specific skit concepts, then add the ones you like straight into the
            shot list.
          </Empty>
          <button
            type="button"
            className="btn-primary"
            disabled={busy !== null}
            onClick={() => void runSkits({ count: 7 })}
          >
            {busy === 'skits' ? 'Writing…' : 'Generate skit concepts'}
          </button>
        </>
      ) : (
        <>
          <SectionHead label="Rewrite the batch" note="Locked and added skits stay" />
          <SkitSteerBar disabled={busy !== null} />

          <div className="stack" style={{ marginTop: 18 }}>
            {activation.skits.map((skit) => (
              <SkitCard
                key={skit.id}
                skit={skit}
                zoneName={zoneNameById.get(skit.zoneId) ?? 'Anywhere'}
              />
            ))}
          </div>

          <button
            type="button"
            className="btn"
            style={{ marginTop: 18 }}
            disabled={busy !== null}
            onClick={() => void runSkits()}
          >
            {busy === 'skits' ? 'Working…' : 'Generate more'}
          </button>
        </>
      )}
    </div>
  );
}

// ── EXPORT ───────────────────────────────────────────────────────────────────

export function ExportScreen({ activation }: { activation: BBOActivation }) {
  const coverage = computeActivationCoverage(activation);
  const selected = activation.reels.filter((reel) => reel.selected);

  return (
    <div>
      <ScreenHead
        title="Export"
        lede="Take the plan out of here — into the group chat, into your editor, or into another AI."
      />

      <SectionHead label="Reels" note={`${coverage.reels.filter((r) => r.readyToEdit).length} ready`} />
      {selected.length === 0 ? (
        <Empty mark="⇱" title="No Reels selected">
          Select the Reels you are shooting and their edit prompts appear here.
        </Empty>
      ) : (
        <div className="stack">
          {selected.map((reel) => {
            const blueprint = activation.editBlueprints.find((item) => item.reelId === reel.id);
            const reelCoverage = coverage.reels.find((item) => item.reelId === reel.id);
            return (
              <div key={reel.id} className="card">
                <div className="spread" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <h3 className="display" style={{ fontSize: '1.25rem', color: 'var(--white)' }}>
                      {reel.title}
                    </h3>
                    <p className="small muted" style={{ marginTop: 4 }}>
                      {reelCoverage?.readyToEdit
                        ? 'Ready to edit'
                        : `${reelCoverage?.percent ?? 0}% covered`}{' '}
                      · {blueprint ? 'blueprint built' : 'planned sequence only'}
                    </p>
                  </div>
                  <CopyButton
                    className="btn btn-active"
                    label="Copy edit prompt"
                    text={buildEditPromptText(activation, reel, blueprint)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SectionHead label="Whole activation" />
      <div className="card">
        <div className="row-tight">
          <CopyButton className="btn" label="Copy shoot plan" text={buildShootPlanText(activation)} />
          <button type="button" className="btn" onClick={() => downloadJson(activation)}>
            Download JSON
          </button>
          <button type="button" className="btn" onClick={() => window.print()}>
            Print / save PDF
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>
          The JSON holds the whole plan. Photos stay on this device.
        </p>
      </div>

      <SectionHead label="Shoot plan preview" />
      <pre className="pre">{buildShootPlanText(activation)}</pre>
    </div>
  );
}

// ── SETTINGS ─────────────────────────────────────────────────────────────────

export function SettingsScreen({ activation }: { activation: BBOActivation }) {
  const { update, closeActivation } = useStore();

  return (
    <div>
      <ScreenHead title="Settings" lede="This activation only. Nothing here leaves the device." />

      <SectionHead label="Business" />
      <div className="card">
        <label className="field">
          <span className="field-label">Name</span>
          <input
            className="input"
            value={activation.business.name}
            onChange={(event) =>
              update((state) => ({
                ...state,
                business: { ...state.business, name: event.target.value },
              }))
            }
          />
        </label>
        <div className="field field-pair">
          <label>
            <span className="field-label">City</span>
            <input
              className="input"
              value={activation.business.city ?? ''}
              onChange={(event) =>
                update((state) => ({
                  ...state,
                  business: { ...state.business, city: event.target.value || undefined },
                }))
              }
            />
          </label>
          <label>
            <span className="field-label">Instagram</span>
            <input
              className="input"
              value={activation.business.instagram ?? ''}
              onChange={(event) =>
                update((state) => ({
                  ...state,
                  business: { ...state.business, instagram: event.target.value || undefined },
                }))
              }
            />
          </label>
        </div>
      </div>

      <SectionHead label="Photos" note={`${activation.photos.length} added`} />
      <div className="card">
        <PhotoUploader compact />
      </div>

      <SectionHead label="Client must-haves" />
      <div className="card">
        <textarea
          className="textarea"
          value={activation.clientRequirements.join('\n')}
          onChange={(event) =>
            update((state) => ({
              ...state,
              clientRequirements: event.target.value
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
            }))
          }
        />
      </div>

      <ProviderDebug activation={activation} />

      <div style={{ marginTop: 24 }}>
        <button type="button" className="btn-primary ghost" onClick={closeActivation}>
          Close activation
        </button>
      </div>
    </div>
  );
}

// ── FIRST RUN ────────────────────────────────────────────────────────────────

export function FirstRun({ onCreate }: { onCreate: () => void }) {
  const features = [
    ['AI location scout', 'Reads your photos and tells you what the place actually is.'],
    ['Reel builder', 'Real timelines, beat by beat, built for this venue.'],
    ['Shot coverage', 'One deduplicated list, live percentages, nothing shot twice.'],
    ['Skit lab', 'Comedy that only makes sense in this room.'],
  ];

  return (
    <div className="hero-first-run">
      <span className="label label-pink">BBO Stamped</span>
      <h1>
        Turn any location into <em>a Reel plan.</em>
      </h1>
      <p className="screen-lede" style={{ fontSize: 'var(--text-lead)', marginBottom: 28 }}>
        Drop the location photos. BBO scouts the space, builds your Reel concepts and tells you
        exactly what footage you need before you leave.
      </p>

      <button type="button" className="btn-primary" style={{ maxWidth: 340 }} onClick={onCreate}>
        Create activation
      </button>

      <div className="grid-cards" style={{ marginTop: 44 }}>
        {features.map(([title, note]) => (
          <div key={title} className="card card-accent">
            <h2 className="display" style={{ fontSize: '1.125rem', color: 'var(--white)' }}>
              {title}
            </h2>
            <p className="small muted" style={{ marginTop: 8 }}>
              {note}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

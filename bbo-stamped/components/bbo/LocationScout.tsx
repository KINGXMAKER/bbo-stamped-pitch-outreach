'use client';

import { useState } from 'react';
import { useStore } from './ActivationStore';
import { PhotoRefs } from './PhotoViewer';
import { SectionHead, TagList } from './ui';
import type { VenueAnalysis } from '@/types';

export function ClassificationCard({ analysis }: { analysis: VenueAnalysis }) {
  const { activation, update } = useStore();
  const [editing, setEditing] = useState(false);
  const override = activation?.categoryOverride;
  const shown = override?.trim() || analysis.business.inferredCategory;

  return (
    <div className="card card-accent">
      <span className="label label-pink">AI detected</span>
      <div className="spread" style={{ alignItems: 'flex-start', marginTop: 8 }}>
        <div>
          <div className="display" style={{ fontSize: '1.75rem', color: 'var(--white)' }}>
            {shown}
          </div>
          {analysis.business.subcategories.length ? (
            <TagList items={analysis.business.subcategories} tone="pink" />
          ) : null}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="pct">{Math.round(analysis.business.confidence)}%</div>
          <span className="label">confidence</span>
        </div>
      </div>

      {analysis.business.reasoning ? (
        <p className="small muted" style={{ marginTop: 12 }}>
          {analysis.business.reasoning}
        </p>
      ) : null}

      {editing ? (
        <div style={{ marginTop: 14 }}>
          <label className="field">
            <span className="field-label">Correct the classification</span>
            <input
              className="input"
              autoFocus
              defaultValue={shown}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                update((state) => ({
                  ...state,
                  categoryOverride: (event.target as HTMLInputElement).value.trim() || undefined,
                }));
                setEditing(false);
              }}
              onBlur={(event) => {
                update((state) => ({
                  ...state,
                  categoryOverride: event.target.value.trim() || undefined,
                }));
                setEditing(false);
              }}
            />
          </label>
        </div>
      ) : (
        <div className="row-tight" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            {override ? 'Edit correction' : 'Correct this'}
          </button>
          {override ? (
            <button
              type="button"
              className="btn"
              onClick={() => update((state) => ({ ...state, categoryOverride: undefined }))}
            >
              Use AI classification
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function LocationScoutReport() {
  const { activation, runScout, busy } = useStore();
  const [expanded, setExpanded] = useState(false);
  const analysis = activation?.venueAnalysis;
  if (!activation || !analysis) return null;

  const profile = analysis.visualProfile;

  return (
    <section>
      <SectionHead label="Location scout" note={`${analysis.zones.length} zones`} />

      <ClassificationCard analysis={analysis} />

      {analysis.summary ? (
        <div className="card">
          <p className="serif" style={{ fontSize: 'var(--text-lead)', color: 'var(--white)' }}>
            {analysis.summary}
          </p>
        </div>
      ) : null}

      <div className="card">
        <span className="label label-pink">Hero location</span>
        <p style={{ marginTop: 8, color: 'var(--white)' }}>{analysis.bestHeroLocation.description}</p>
        <p className="small muted" style={{ marginTop: 6 }}>
          {analysis.bestHeroLocation.why}
        </p>
        <PhotoRefs photoIds={analysis.bestHeroLocation.sourcePhotoIds} />
      </div>

      <SectionHead label="Filming zones" />
      <div className="grid-cards">
        {analysis.zones.map((zone) => (
          <article key={zone.id} className="card">
            <div className="spread" style={{ alignItems: 'flex-start' }}>
              <h3 className="display" style={{ fontSize: '1.125rem', color: 'var(--white)' }}>
                {zone.name}
              </h3>
              <span
                className={
                  zone.priority === 'hero'
                    ? 'badge badge-must'
                    : zone.priority === 'strong'
                      ? 'badge badge-strong'
                      : 'badge badge-optional'
                }
              >
                {zone.priority}
              </span>
            </div>
            <p className="small" style={{ marginTop: 8 }}>
              {zone.description}
            </p>
            <TagList items={zone.bestFor} />
            <PhotoRefs photoIds={zone.sourcePhotoIds} />
          </article>
        ))}
      </div>

      {analysis.standoutFeatures.length ? (
        <>
          <SectionHead label="What makes this place different" />
          <div className="stack">
            {analysis.standoutFeatures.map((item) => (
              <div key={item.feature} className="card">
                <h3 className="display" style={{ fontSize: '1rem', color: 'var(--white)' }}>
                  {item.feature}
                </h3>
                <p className="small" style={{ marginTop: 6 }}>
                  {item.opportunity}
                </p>
                <PhotoRefs photoIds={item.sourcePhotoIds} />
              </div>
            ))}
          </div>
        </>
      ) : null}

      <SectionHead label="Shooting conditions" />
      <div className="card">
        <dl className="spec" style={{ gridTemplateColumns: '110px 1fr' }}>
          <dt>Lighting</dt>
          <dd>{profile.lighting.overall || 'Not assessed'}</dd>
          {profile.lighting.strongestAreas.length ? (
            <>
              <dt>Best light</dt>
              <dd>{profile.lighting.strongestAreas.join(', ')}</dd>
            </>
          ) : null}
          {profile.lighting.problemAreas.length ? (
            <>
              <dt>Problem</dt>
              <dd style={{ color: 'var(--amber)' }}>{profile.lighting.problemAreas.join(', ')}</dd>
            </>
          ) : null}
          <dt>Identity</dt>
          <dd>{profile.visualIdentity}</dd>
          <dt>Feel</dt>
          <dd>
            {[profile.premiumLevel, profile.spatialFeel, profile.crowdEnergyPotential]
              .filter(Boolean)
              .join(' · ')}
          </dd>
        </dl>

        {profile.lighting.recommendations.length ? (
          <div className="callout callout-gold" style={{ marginTop: 14 }}>
            <span className="label label-gold">Do this on the day</span>
            <ul style={{ margin: '8px 0 0 16px' }} className="small">
              {profile.lighting.recommendations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="row-tight" style={{ marginTop: 14 }}>
          <TagList items={profile.atmosphere} tone="pink" />
          <TagList items={profile.dominantColors} />
        </div>
      </div>

      <div className="card">
        <div className="spread">
          <span className="label">More detail</span>
          <button type="button" className="btn" onClick={() => setExpanded((value) => !value)}>
            {expanded ? 'Hide' : 'Show'}
          </button>
        </div>

        {expanded ? (
          <div style={{ marginTop: 16 }} className="stack">
            {analysis.usableProps.length ? (
              <div>
                <span className="label label-gold">Usable props</span>
                <TagList items={analysis.usableProps} tone="gold" />
              </div>
            ) : null}
            {analysis.visibleProductsOrServices.length ? (
              <div>
                <span className="label label-gold">Visible products &amp; services</span>
                <TagList items={analysis.visibleProductsOrServices} tone="gold" />
              </div>
            ) : null}
            {analysis.filmingChallenges.length ? (
              <div className="callout callout-red">
                <span className="label" style={{ color: 'var(--red)' }}>
                  Filming challenges
                </span>
                <ul style={{ margin: '8px 0 0 16px' }} className="small">
                  {analysis.filmingChallenges.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {analysis.observationsByPhoto.map((entry) => {
              const index = activation.photos.findIndex((photo) => photo.id === entry.photoId);
              if (index < 0) return null;
              return (
                <div key={entry.photoId} className="panel">
                  <span className="label label-pink">Photo {index + 1}</span>
                  <ul style={{ margin: '8px 0 0 16px' }} className="small">
                    {entry.observations.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  {entry.shotOpportunities.length ? (
                    <TagList items={entry.shotOpportunities} tone="pink" />
                  ) : null}
                  <PhotoRefs photoIds={[entry.photoId]} label="Photo" />
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="row-tight" style={{ marginTop: 14 }}>
        <button
          type="button"
          className="btn"
          disabled={busy === 'venueAnalysis'}
          onClick={() => void runScout()}
        >
          {busy === 'venueAnalysis' ? 'Re-analysing…' : 'Re-analyse location'}
        </button>
        <span className="small muted">
          Run this after adding photos. Reels, shots and skits stay as they are.
        </span>
      </div>
    </section>
  );
}

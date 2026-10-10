'use client';

import { useEffect, useRef, useState } from 'react';
import { createActivation } from '@/lib/storage/activation';
import { canAnalyzeLocation } from '@/lib/location-flow';
import { cx } from '@/lib/utils/format';
import { useStore } from './ActivationStore';
import { PhotoUploader } from './PhotoUploader';
import { ErrorBox, ScreenHead, SectionHead } from './ui';
import type { KitchenAccess } from '@/types';

export function ActivationCreator({ onAnalysed }: { onAnalysed: () => void }) {
  const { activation, startActivation, update, runScout, busy, errors, clearError } = useStore();
  const [nameError, setNameError] = useState(false);
  const bootstrapped = useRef(false);

  // A draft exists from the moment this screen opens so photos can be dropped
  // straight away. It is only written to storage once it has a name.
  useEffect(() => {
    if (activation || bootstrapped.current) return;
    bootstrapped.current = true;
    void startActivation(
      createActivation({
        name: '',
        clientRequirements: [],
      })
    );
  }, [activation, startActivation]);

  if (!activation) return null;

  const hasName = activation.business.name.trim().length > 0;
  const hasPhotos = activation.photos.length > 0;
  const scouting = busy === 'venueAnalysis';
  const canAnalyse = canAnalyzeLocation(activation.photos.length, busy);

  async function analyse() {
    if (!hasName) {
      setNameError(true);
      document.getElementById('business-name')?.focus();
      return;
    }
    const ok = await runScout();
    if (ok) onAnalysed();
  }

  return (
    <div>
      <ScreenHead
        title="New activation"
        lede="Name the business and drop the photos. Everything else — what kind of place it is, how it looks, where to film — is read off the images."
      />

      <SectionHead label="Business" />
      <div className="card card-accent">
        <label className="field" htmlFor="business-name">
          <span className="field-label">Business name *</span>
          <input
            id="business-name"
            className="input"
            style={nameError && !hasName ? { borderColor: 'var(--red)' } : undefined}
            value={activation.business.name}
            placeholder="e.g. The Patio, 1Republik, Glow Lab"
            onChange={(event) => {
              setNameError(false);
              update((state) => ({
                ...state,
                business: { ...state.business, name: event.target.value },
              }));
            }}
          />
        </label>

        <div className="field field-pair">
          <label>
            <span className="field-label">
              City <span className="optional">optional</span>
            </span>
            <input
              className="input"
              value={activation.business.city ?? ''}
              placeholder="Newark, NJ"
              onChange={(event) =>
                update((state) => ({
                  ...state,
                  business: { ...state.business, city: event.target.value || undefined },
                }))
              }
            />
          </label>
          <label>
            <span className="field-label">
              Instagram <span className="optional">optional</span>
            </span>
            <input
              className="input"
              value={activation.business.instagram ?? ''}
              placeholder="@handle"
              onChange={(event) =>
                update((state) => ({
                  ...state,
                  business: { ...state.business, instagram: event.target.value || undefined },
                }))
              }
            />
          </label>
        </div>

        <label className="field">
          <span className="field-label">
            Website <span className="optional">optional</span>
          </span>
          <input
            className="input"
            value={activation.business.website ?? ''}
            placeholder="thepatio.com"
            onChange={(event) =>
              update((state) => ({
                ...state,
                business: { ...state.business, website: event.target.value || undefined },
              }))
            }
          />
        </label>
      </div>

      <SectionHead label="Client priorities" note="Optional" />
      <div className="card card-accent card-accent-gold">
        <label className="field">
          <span className="field-label label-gold">What does the business want featured?</span>
          <textarea
            className="textarea"
            placeholder={'One per line:\nPatio\nWings\nBirthday packages\nSignature cocktails'}
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
          <span className="small muted" style={{ display: 'block', marginTop: 6 }}>
            These become locked client shots that regeneration cannot delete.
          </span>
        </label>

        <label className="field">
          <span className="field-label label-gold">Anything else we need to know?</span>
          <textarea
            className="textarea"
            placeholder="Owner is only there until 6. The back room is being repainted. Bring the ring light."
            value={activation.notes ?? ''}
            onChange={(event) =>
              update((state) => ({ ...state, notes: event.target.value || undefined }))
            }
          />
        </label>
      </div>

      <SectionHead label="Access" />
      <div className="card">
        <span className="field-label">Kitchen / back-of-house</span>
        <div className="row-tight">
          {(
            [
              ['approved', 'Approved'],
              ['denied', 'Denied'],
              ['unknown', 'Not confirmed'],
            ] as Array<[KitchenAccess, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={cx('btn', activation.kitchenAccess === value && 'btn-active')}
              aria-pressed={activation.kitchenAccess === value}
              onClick={() => update((state) => ({ ...state, kitchenAccess: value }))}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          Gates every process capture — chef hands, plating, the pass. Nothing behind the pass is
          planned as required footage unless this is approved.
        </p>
      </div>

      <SectionHead label="Budget challenge" note="Optional" />
      <div className="card">
        <div className="field-pair">
          <label className="field">
            <span className="field-label">
              Amount<span className="optional">for &ldquo;What $X gets you here&rdquo;</span>
            </span>
            <input
              className="input"
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="e.g. 50"
              value={activation.budgetAmount ?? ''}
              onChange={(event) =>
                update((state) => ({
                  ...state,
                  budgetAmount: event.target.value ? Number(event.target.value) : undefined,
                }))
              }
            />
          </label>
          <label className="field">
            <span className="field-label">Menu prices</span>
            <select
              className="select"
              value={activation.menuPricesSupplied ? 'yes' : 'no'}
              onChange={(event) =>
                update((state) => ({
                  ...state,
                  menuPricesSupplied: event.target.value === 'yes',
                }))
              }
            >
              <option value="no">Not supplied yet</option>
              <option value="yes">Supplied in notes or photos</option>
            </select>
          </label>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          Without real prices the plan will say they must be confirmed rather than invent an order.
        </p>
      </div>

      <SectionHead label="Location photos" note={`${activation.photos.length} added`} />
      <div className="card">
        <PhotoUploader />
      </div>

      {errors.venueAnalysis ? (
        <div style={{ marginTop: 16 }}>
          <ErrorBox
            message={errors.venueAnalysis}
            onRetry={() => void analyse()}
            onDismiss={() => clearError('venueAnalysis')}
          />
        </div>
      ) : null}

      <div style={{ marginTop: 20 }}>
        <button
          type="button"
          className="btn-primary"
          disabled={!canAnalyse}
          onClick={() => void analyse()}
        >
          {scouting ? 'Scouting…' : 'Analyse location'}
        </button>
        {!hasPhotos ? (
          <p className="small muted" style={{ marginTop: 10, textAlign: 'center' }}>
            Add at least one photo — the scout works from what it can actually see.
          </p>
        ) : null}
      </div>
    </div>
  );
}

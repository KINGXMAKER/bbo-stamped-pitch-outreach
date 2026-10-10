'use client';

import { useState } from 'react';
import { ApiError, runPitchIntel } from '@/lib/api/client';
import type { PitchFit, PitchIntel as PitchIntelData } from '@/types';
import { CopyButton, ErrorBox, ScreenHead, SectionHead, TagList } from './ui';

const ASKS = [
  'Gifted visit + content',
  'Paid content package',
  'Monthly retainer',
  'Event collab / BBO night',
  'BBO Stamped feature (organic)',
];

const FIT_COLOR: Record<PitchFit, string> = {
  'STRONG FIT': 'var(--green)',
  'POTENTIAL FIT': 'var(--gold)',
  'WEAK FIT': 'var(--amber)',
  'INSUFFICIENT DATA': 'var(--muted)',
};

export function PitchIntelScreen() {
  const [form, setForm] = useState({
    name: '',
    instagram: '',
    website: '',
    notes: '',
    ask: ASKS[0],
  });
  const [result, setResult] = useState<PitchIntelData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!form.name.trim() && !form.instagram.trim()) {
      setError('Add a business name or an Instagram handle first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await runPitchIntel({
        name: form.name.trim(),
        instagram: form.instagram.trim() || undefined,
        website: form.website.trim() || undefined,
        notes: form.notes.trim() || undefined,
        ask: form.ask,
      });
      setResult(data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Pitch intel failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <ScreenHead
        title="Pitch intel"
        lede="A partnership angle built from what you actually know. It infers the category — it does not read their Instagram, and it will say so."
      />

      <div className="card card-accent card-accent-gold">
        <label className="field">
          <span className="field-label label-gold">Business</span>
          <input
            className="input"
            value={form.name}
            placeholder="1Republik, Hook & Reel…"
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </label>

        <div className="field field-pair">
          <label>
            <span className="field-label label-gold">
              Instagram <span className="optional">optional</span>
            </span>
            <input
              className="input"
              value={form.instagram}
              placeholder="@handle"
              onChange={(event) => setForm({ ...form, instagram: event.target.value })}
            />
          </label>
          <label>
            <span className="field-label label-gold">
              Website <span className="optional">optional</span>
            </span>
            <input
              className="input"
              value={form.website}
              placeholder="business.com"
              onChange={(event) => setForm({ ...form, website: event.target.value })}
            />
          </label>
        </div>

        <label className="field">
          <span className="field-label label-gold">What do you already know?</span>
          <textarea
            className="textarea"
            value={form.notes}
            placeholder="They only post flyers. Friday nights are packed. Owner runs the page himself."
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </label>

        <label className="field">
          <span className="field-label label-gold">What we&rsquo;re pitching</span>
          <select
            className="select"
            value={form.ask}
            onChange={(event) => setForm({ ...form, ask: event.target.value })}
          >
            {ASKS.map((ask) => (
              <option key={ask} value={ask}>
                {ask}
              </option>
            ))}
          </select>
        </label>

        <button type="button" className="btn-primary" style={{ marginTop: 18 }} disabled={busy} onClick={() => void run()}>
          {busy ? 'Working…' : 'Generate pitch intel'}
        </button>
      </div>

      {error ? (
        <div style={{ marginTop: 16 }}>
          <ErrorBox message={error} onRetry={() => void run()} onDismiss={() => setError(null)} />
        </div>
      ) : null}

      {result ? (
        <>
          <SectionHead label="Fit" tone="gold" />
          <div className="card">
            <div className="display" style={{ fontSize: '2rem', color: FIT_COLOR[result.fit] }}>
              {result.fit}
            </div>
            <p className="small" style={{ marginTop: 10 }}>
              {result.fitReasoning}
            </p>

            <div className="divider" />
            <dl className="spec" style={{ gridTemplateColumns: '120px 1fr' }}>
              <dt>Category</dt>
              <dd>
                {result.inferredCategory}{' '}
                <span className="muted">({result.categoryConfidence})</span>
              </dd>
              <dt>Reasoning</dt>
              <dd>{result.categoryReasoning}</dd>
            </dl>

            {result.dataUsed.length ? (
              <div style={{ marginTop: 14 }}>
                <span className="label">Based on</span>
                <TagList items={result.dataUsed} />
              </div>
            ) : null}
            {result.dataMissing.length ? (
              <div style={{ marginTop: 10 }}>
                <span className="label label-gold">Would need to be sure</span>
                <TagList items={result.dataMissing} tone="gold" />
              </div>
            ) : null}
          </div>

          {result.contentGapHypothesis.length ? (
            <>
              <SectionHead label="Gaps to check" tone="gold" />
              <div className="card">
                <p className="small muted" style={{ marginBottom: 10 }}>
                  Hypotheses, not facts — confirm before you say them out loud.
                </p>
                <ul className="small" style={{ margin: '0 0 0 16px' }}>
                  {result.contentGapHypothesis.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}

          <SectionHead label="The pitch" />
          <div className="card card-accent">
            <p className="quote">{result.pitchAngle}</p>
            <div style={{ marginTop: 12 }}>
              <CopyButton text={result.pitchAngle} />
            </div>

            {result.whatBBOProvides.length ? (
              <>
                <div className="divider" />
                <span className="label label-gold">What BBO provides</span>
                <ul className="small" style={{ margin: '8px 0 0 16px' }}>
                  {result.whatBBOProvides.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </>
            ) : null}

            {result.objectionHandlers.length ? (
              <>
                <div className="divider" />
                <span className="label label-gold">Objections</span>
                <div className="stack-sm" style={{ marginTop: 8 }}>
                  {result.objectionHandlers.map((item) => (
                    <div key={item.objection} className="panel">
                      <p className="small" style={{ color: 'var(--white)' }}>
                        &ldquo;{item.objection}&rdquo;
                      </p>
                      <p className="small muted" style={{ marginTop: 6 }}>
                        → {item.response}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          <SectionHead label="Outreach" />
          <div className="card">
            <span className="label label-pink">DM</span>
            <p className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>
              {result.dmScript}
            </p>
            <div style={{ marginTop: 10 }}>
              <CopyButton text={result.dmScript} />
            </div>

            <div className="divider" />
            <span className="label label-pink">Follow-up</span>
            <p className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>
              {result.followUp}
            </p>
            <div style={{ marginTop: 10 }}>
              <CopyButton text={result.followUp} />
            </div>

            {result.contactStrategy ? (
              <>
                <div className="divider" />
                <span className="label">How to reach them</span>
                <p className="small" style={{ marginTop: 8 }}>
                  {result.contactStrategy}
                </p>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

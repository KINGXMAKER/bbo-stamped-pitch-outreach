'use client';

import { useEffect, useState } from 'react';
import type { BBOActivation, GenerationInfo } from '@/types';
import { CopyButton, SectionHead } from './ui';

type Routing = Array<{
  capability: string;
  chain: Array<{ provider: string; model: string | null; configured: boolean }>;
}>;

const STAGE_LABELS: Array<[keyof BBOActivation['generationMeta'], string]> = [
  ['venueAnalysis', 'Location scout'],
  ['reels', 'Reels'],
  ['shots', 'Shots'],
  ['photoPlan', 'Photo plan'],
  ['skits', 'Skits'],
  ['blueprint', 'Edit blueprint'],
];

/**
 * Developer view of the provider layer. Deliberately tucked inside Settings so
 * none of this reaches the shoot-day interface. It shows provider names, model
 * ids and timings only — never a key, and never an authorization header.
 */
export function ProviderDebug({ activation }: { activation: BBOActivation }) {
  const [routing, setRouting] = useState<Routing | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || routing) return;
    let cancelled = false;
    fetch('/api/ai/routing')
      .then((res) => res.json())
      .then((data: { routing: Routing }) => {
        if (!cancelled) setRouting(data.routing);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, routing]);

  const runs = STAGE_LABELS.map(([key, label]) => ({
    label,
    info: activation.generationMeta[key] as GenerationInfo | undefined,
  }));

  const totals = runs.reduce(
    (acc, run) => {
      const usage = run.info?.usage;
      if (!usage) return acc;
      return {
        prompt: acc.prompt + (usage.promptTokens ?? 0),
        completion: acc.completion + (usage.completionTokens ?? 0),
        cost: acc.cost + (usage.reportedCostUsd ?? 0),
        hasCost: acc.hasCost || usage.reportedCostUsd !== undefined,
      };
    },
    { prompt: 0, completion: 0, cost: 0, hasCost: false }
  );

  return (
    <section>
      <SectionHead label="Provider debug" note="Developer" />
      <div className="card">
        <div className="spread">
          <p className="small muted" style={{ margin: 0 }}>
            Which provider answered each stage, how long it took, and what it fell back from.
          </p>
          <button type="button" className="btn" onClick={() => setOpen((value) => !value)}>
            {open ? 'Hide' : 'Show'}
          </button>
        </div>

        {open ? (
          <div style={{ marginTop: 18 }}>
            {routing ? (
              <>
                <span className="label label-gold">Live routing</span>
                <div className="stack-sm" style={{ marginTop: 8, marginBottom: 18 }}>
                  {routing.map((entry) => (
                    <div key={entry.capability} className="panel">
                      <span className="label">{entry.capability}</span>
                      <ol style={{ margin: '8px 0 0 18px' }} className="small">
                        {entry.chain.map((step) => (
                          <li
                            key={step.provider}
                            style={{ color: step.configured ? 'var(--text)' : 'var(--muted-deep)' }}
                          >
                            {step.provider} — {step.model ?? 'no usable model'}
                            {step.configured ? '' : ' (no key)'}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="small muted" style={{ marginBottom: 18 }}>
                Loading routing…
              </p>
            )}

            <span className="label label-gold">Stage runs</span>
            <div className="stack-sm" style={{ marginTop: 8 }}>
              {runs.map(({ label, info }) => (
                <div key={label} className="panel">
                  <div className="spread">
                    <span className="display" style={{ fontSize: '0.9375rem', color: 'var(--white)' }}>
                      {label}
                    </span>
                    {info ? (
                      <span className="small muted">{(info.latencyMs / 1000).toFixed(1)}s</span>
                    ) : (
                      <span className="small muted">Not run</span>
                    )}
                  </div>

                  {info ? (
                    <>
                      <p className="small" style={{ marginTop: 6 }}>
                        {info.providerUsed} · {info.modelUsed}
                        {info.fallbackOccurred ? ' · fell back' : ''}
                        {info.validatedFirstTry ? ' · valid first try' : ' · needed repair'}
                      </p>

                      {info.usage ? (
                        <p className="small muted" style={{ marginTop: 4 }}>
                          {info.usage.promptTokens ?? '—'} in / {info.usage.completionTokens ?? '—'}{' '}
                          out
                          {info.usage.reportedCostUsd !== undefined
                            ? ` · $${info.usage.reportedCostUsd.toFixed(5)} reported`
                            : ''}
                        </p>
                      ) : null}

                      {info.attempts.length > 1 ? (
                        <ol style={{ margin: '8px 0 0 18px' }} className="small muted">
                          {info.attempts.map((attempt, index) => (
                            <li key={`${attempt.provider}-${index}`}>
                              {attempt.provider} · {attempt.model ?? '—'} ·{' '}
                              <span
                                style={{
                                  color:
                                    attempt.status === 'ok' ? 'var(--green)' : 'var(--amber)',
                                }}
                              >
                                {attempt.status === 'ok'
                                  ? 'ok'
                                  : `${attempt.errorType}${
                                      attempt.httpStatus ? ` ${attempt.httpStatus}` : ''
                                    }`}
                              </span>{' '}
                              · {(attempt.latencyMs / 1000).toFixed(1)}s
                            </li>
                          ))}
                        </ol>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ))}
            </div>

            {totals.prompt > 0 || totals.completion > 0 ? (
              <div className="callout callout-gold" style={{ marginTop: 16 }}>
                <span className="label label-gold">Reported usage for this activation</span>
                <p className="small" style={{ marginTop: 6 }}>
                  {totals.prompt} prompt tokens · {totals.completion} completion tokens
                  {totals.hasCost ? ` · $${totals.cost.toFixed(5)} reported by providers` : ''}
                </p>
                {!totals.hasCost ? (
                  <p className="small muted" style={{ marginTop: 4 }}>
                    No provider in this run reported a price, so no cost is shown. Nothing here is
                    estimated.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div style={{ marginTop: 16 }}>
              <CopyButton
                label="Copy debug JSON"
                text={JSON.stringify(activation.generationMeta, null, 2)}
              />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

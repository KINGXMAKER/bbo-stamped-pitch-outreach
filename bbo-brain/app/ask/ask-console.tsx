'use client';

import Link from 'next/link';
import { useActionState, useRef } from 'react';
import { askAction, type AskState } from '@/app/actions';
import { SubmitButton } from '@/components/client';

const EXAMPLES = [
  'What has BBO learned?',
  'What did BBO learn this week?',
  'What should BBO make next?',
  'What hooks work best for BBO?',
  'What topics generate the most shares?',
  'What topics generate comments but poor retention?',
  'Which guests consistently outperform?',
  'Which content lengths work best?',
  'Do question captions outperform declarative captions?',
  'What should we stop doing?',
  'What should we test next?',
  'What BBO rules have the strongest evidence?',
  'What rules are being challenged?',
  'What did we believe three months ago that we no longer believe?',
  "What topics perform well on the podcast but haven't been used in BBO Court?",
];

const CONF: Record<string, string> = { STRONG_SIGNAL: 'chip-green', MODERATE_SIGNAL: 'chip-pink', EARLY_SIGNAL: 'chip-amber', INSUFFICIENT_DATA: 'chip-muted', 'N/A': 'chip-muted' };

export function AskConsole({ aiEnabled }: { aiEnabled: boolean }) {
  const [state, action] = useActionState<AskState, FormData>(askAction, { result: null, error: null });
  const ref = useRef<HTMLTextAreaElement>(null);
  const r = state.result;

  return (
    <div className="split">
      <div className="stack">
        <form action={action} className="card stack-sm rise">
          <label className="field">
            <span className="field-label">Your question</span>
            <textarea ref={ref} name="question" className="textarea" style={{ minHeight: '5rem', fontSize: '1.05rem' }} placeholder="Which relationship topics perform best when the guest is male?" required />
          </label>
          <div className="spread">
            <span className="xs muted">{aiEnabled ? 'Evidence is calculated first; Gemini only explains it.' : 'AI is not configured — answers show the calculated evidence directly.'}</span>
            <SubmitButton className="btn btn-primary" pendingText="Querying records…">
              Ask BBO
            </SubmitButton>
          </div>
        </form>

        {state.error ? <div className="callout callout-red">{state.error}</div> : null}

        {r ? (
          <div className="stack rise">
            <article className={`card ${r.answeredBy === 'ai' ? 'card-gold' : ''} card-hero stack-sm`}>
              <div className="row">
                <span className={`chip ${r.answeredBy === 'ai' ? 'chip-gold' : 'chip-green'}`}>{r.answeredBy === 'ai' ? 'AI explanation of calculated evidence' : 'Calculated answer'}</span>
                <span className={`chip ${CONF[r.evidence.confidence] ?? 'chip-muted'}`}>{String(r.evidence.confidence).replace(/_/g, ' ')}</span>
                <span className="xs muted">
                  {r.evidence.sampleSize} records{r.evidence.dateRange ? ` · ${r.evidence.dateRange.from} → ${r.evidence.dateRange.to}` : ''} · routed by {r.routedBy} as “{r.intent.kind.replace(/_/g, ' ')}”
                </span>
              </div>
              <h2 className="section-title" style={{ whiteSpace: 'normal' }}>
                {r.evidence.title}
              </h2>
              <div className="serif white" style={{ fontSize: '1.2rem', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                {r.answer}
              </div>
              {r.caveats.length ? (
                <ul className="stack-xs xs warn" style={{ listStyle: 'none' }}>
                  {r.caveats.map((c, i) => (
                    <li key={i}>⚠ {c}</li>
                  ))}
                </ul>
              ) : null}
              {r.evidence.baseline ? <div className="xs muted">Baseline: {r.evidence.baseline}</div> : null}
            </article>

            {r.evidence.tables.map((t, i) => (
              <div key={i} className="stack-sm">
                <div className="kicker kicker-muted">Evidence · {t.title}</div>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        {t.columns.map((c) => (
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {t.rows.length ? (
                        t.rows.slice(0, 30).map((row, j) => (
                          <tr key={j}>
                            {row.map((cell, k) => (
                              <td key={k} className={typeof cell === 'number' ? 'num' : 'small'}>
                                {cell === null || cell === '' ? '—' : String(cell).replace(/⟪|⟫/g, '')}
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={t.columns.length} className="small muted">
                            No rows.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <aside className="stack">
        {r && (r.evidence.supporting.length || r.evidence.rules.length || r.evidence.experiments.length) ? (
          <div className="card stack-sm">
            {r.evidence.supporting.length ? (
              <>
                <div className="kicker kicker-muted">Supporting posts</div>
                {r.evidence.supporting.map((s) => (
                  <Link key={s.contentId} href={`/content/${s.contentId}`} className="spread small">
                    <span className="clamp-2">{s.title}</span>
                    <span className="mono">{s.score?.toFixed(2) ?? '—'}</span>
                  </Link>
                ))}
              </>
            ) : null}
            {r.evidence.rules.length ? (
              <>
                <div className="kicker kicker-muted">Applicable rules</div>
                {r.evidence.rules.map((x) => (
                  <div key={x.code} className="xs">
                    <span className="mono pink">{x.code}</span> {x.text}
                  </div>
                ))}
              </>
            ) : null}
            {r.evidence.experiments.length ? (
              <>
                <div className="kicker kicker-muted">Relevant experiments</div>
                {r.evidence.experiments.map((x) => (
                  <div key={x.code} className="xs">
                    <span className="mono pink">{x.code}</span> {x.name} · {x.status}
                  </div>
                ))}
              </>
            ) : null}
          </div>
        ) : null}
        <div className="card stack-sm">
          <div className="kicker kicker-muted">Try asking</div>
          {EXAMPLES.map((q) => (
            <button
              key={q}
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ justifyContent: 'flex-start', whiteSpace: 'normal', textAlign: 'left', fontWeight: 400 }}
              onClick={() => {
                if (ref.current) {
                  ref.current.value = q;
                  ref.current.focus();
                }
              }}
            >
              {q}
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}

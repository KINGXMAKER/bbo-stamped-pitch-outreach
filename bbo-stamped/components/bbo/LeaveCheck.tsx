'use client';

import { useState } from 'react';
import { runLeaveCheck } from '@/lib/coverage';
import type { BBOActivation } from '@/types';

const BLOCKER_LABEL: Record<ReturnType<typeof runLeaveCheck>['blockers'][number]['kind'], string> = {
  client: 'Client request',
  must: 'Required shot',
  reel: 'Reel',
  photo: 'Required photo',
  skit: 'Skit',
  verdict: 'Verdict',
};

export function LeaveCheck({ activation }: { activation: BBOActivation }) {
  const [result, setResult] = useState<ReturnType<typeof runLeaveCheck> | null>(null);

  return (
    <section style={{ marginTop: 22 }}>
      <button
        type="button"
        className="btn-primary"
        onClick={() => setResult(runLeaveCheck(activation))}
        disabled={activation.shots.length === 0 && (activation.photoPlan?.length ?? 0) === 0}
      >
        Can we leave?
      </button>

      {result ? (
        result.clear ? (
          <div className="card card-accent" style={{ marginTop: 14, borderColor: 'rgba(0,201,107,0.35)' }}>
            <div className="display" style={{ fontSize: '1.75rem', color: 'var(--green)' }}>
              You&rsquo;re covered 💋
            </div>
            <ul className="small" style={{ margin: '12px 0 0 16px' }}>
              {result.readyReels.map((title) => (
                <li key={title} style={{ color: 'var(--green)' }}>
                  {title} — ready to edit
                </li>
              ))}
              <li>All client requests captured</li>
            </ul>
          </div>
        ) : (
          <div className="card" style={{ marginTop: 14, borderColor: 'rgba(255,77,94,0.35)' }}>
            <div className="display" style={{ fontSize: '1.75rem', color: 'var(--red)' }}>
              Not yet
            </div>
            <p className="small muted" style={{ marginTop: 6 }}>
              {result.blockers.length} thing{result.blockers.length === 1 ? '' : 's'} still standing
              between you and a finished edit.
            </p>

            <ol className="stack-sm" style={{ marginTop: 14, listStyle: 'none' }}>
              {result.blockers.map((blocker, index) => (
                <li key={`${blocker.kind}-${blocker.title}-${index}`} className="panel">
                  <div className="row-tight">
                    <span
                      className={
                        blocker.kind === 'client'
                          ? 'badge badge-client'
                          : blocker.kind === 'must' || blocker.kind === 'verdict'
                            ? 'badge badge-must'
                            : 'badge badge-strong'
                      }
                    >
                      {BLOCKER_LABEL[blocker.kind]}
                    </span>
                  </div>
                  <div className="shot-title" style={{ marginTop: 8, fontSize: '1rem' }}>
                    {blocker.title}
                  </div>
                  <p className="small muted" style={{ marginTop: 4 }}>
                    {blocker.detail}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        )
      ) : null}
    </section>
  );
}

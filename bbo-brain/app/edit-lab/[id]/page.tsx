import Link from 'next/link';
import { notFound } from 'next/navigation';
import { decideEditSessionAction } from '@/app/actions';
import { SubmitButton } from '@/components/client';
import { Notice } from '@/components/notice';
import { fmtDate, PageHead, Section, StatusChip } from '@/components/ui';
import { getDb } from '@/lib/db/client';
import { sessionDetail } from '@/lib/intel/gatekeeper';
import { getSetting } from '@/lib/seed';

export const dynamic = 'force-dynamic';

const DIMENSIONS = ['hook', 'clarity', 'tension', 'payoff', 'shareability', 'comment_potential'] as const;

export default async function EditSession({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const db = getDb();
  const { session, reviews } = sessionDetail(db, Number(id));
  if (!session) notFound();
  const passMark = getSetting<{ passMark: number }>(db, 'gatekeeper').passMark;
  const s = session as { id: number; title: string; status: string; attempts: number; final_total: number | null; human_note: string | null; created_at: string; published_content_id: number | null; source_transcript: string };

  return (
    <>
      <Notice searchParams={sp as Record<string, string>} />
      <PageHead
        kicker={`Edit session #${s.id} · ${fmtDate(s.created_at, true)}`}
        title={s.title}
        lede={s.status === 'needs_human' ? `Automatic retries are used up. The last attempt scored ${s.final_total}/60 — your call.` : s.status === 'passed' ? `Passed the Gatekeeper at ${s.final_total}/60 on attempt ${s.attempts}.` : s.human_note ?? undefined}
        actions={<StatusChip status={s.status} />}
      />
      <div className="split">
        <div className="stack">
          {reviews
            .slice()
            .reverse()
            .map((r) => {
              const rr = r as unknown as { attempt: number; total: number; passed: number; editor_run_id: number; gatekeeper_run_id: number } & Record<(typeof DIMENSIONS)[number], number>;
              return (
                <Section key={rr.attempt} title={`Attempt ${rr.attempt}`} note={`${rr.total}/60 · ${rr.passed ? 'passed' : 'failed'}`}>
                  <div className={`card stack ${rr.passed ? 'card-green' : 'card-red'}`}>
                    <div className="grid-3">
                      {DIMENSIONS.map((d) => (
                        <div key={d} className="stack-xs">
                          <div className="spread xs">
                            <span className="muted">{d.replace('_', ' ')}</span>
                            <span className="mono white">{rr[d]}/10</span>
                          </div>
                          <div className="bar">
                            <span style={{ width: `${rr[d] * 10}%`, background: rr[d] >= 8 ? 'var(--green)' : rr[d] >= 6 ? 'var(--amber)' : 'var(--red)' }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    {r.autoFails.length || r.reasons.length ? (
                      <div className="callout callout-red stack-xs">
                        {r.autoFails.map((f) => (
                          <span key={f} className="chip chip-red">
                            {f.replace(/_/g, ' ')}
                          </span>
                        ))}
                        {r.reasons.map((reason, i) => (
                          <div key={i} className="small">
                            — {reason}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {r.plan ? (
                      <div className="stack-sm">
                        <div className="sowhat">
                          <div className="kicker kicker-muted">Opening {r.plan.opening.source_timestamp ? `· ${r.plan.opening.source_timestamp}` : ''}</div>
                          <div className="sowhat-text">“{r.plan.opening.line}”</div>
                          <div className="xs muted">{r.plan.opening.why}</div>
                        </div>
                        <div className="table-wrap">
                          <table className="data">
                            <thead>
                              <tr>
                                <th>#</th>
                                <th>In → out</th>
                                <th>Beat</th>
                                <th>Purpose</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.plan.beats.map((b) => (
                                <tr key={b.order}>
                                  <td className="mono small">{b.order}</td>
                                  <td className="mono xs nowrap">
                                    {b.source_in ?? '?'} → {b.source_out ?? '?'}
                                  </td>
                                  <td className="small">{b.text}</td>
                                  <td className="xs muted">{b.purpose}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="grid-3">
                          <div className="panel stack-xs">
                            <div className="kicker kicker-muted">Text hook</div>
                            <div className="small white">{r.plan.text_hook}</div>
                          </div>
                          <div className="panel stack-xs">
                            <div className="kicker kicker-muted">Caption · CTA</div>
                            <div className="small">{r.plan.caption}</div>
                            <div className="xs pink">{r.plan.cta}</div>
                          </div>
                          <div className="panel stack-xs">
                            <div className="kicker kicker-muted">Cut</div>
                            {r.plan.cuts.map((c, i) => (
                              <div key={i} className="xs">
                                <span className="mono muted">
                                  {c.source_in}–{c.source_out}
                                </span>{' '}
                                {c.reason}
                              </div>
                            ))}
                          </div>
                        </div>
                        {r.plan.packaging.length ? (
                          <div className="grid-2">
                            {r.plan.packaging.map((p, i) => (
                              <div key={i} className="panel stack-xs">
                                <div className="kicker kicker-muted">{p.platform}</div>
                                <div className="small">{p.caption}</div>
                                <div className="xs muted">{p.notes}</div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {r.plan.needs_new_material.length ? <div className="callout callout-amber xs">Needs new material: {r.plan.needs_new_material.join(' · ')}</div> : null}
                      </div>
                    ) : null}
                    <div className="xs muted">
                      <Link href={`/runs/${rr.editor_run_id}`}>editor run #{rr.editor_run_id}</Link> · <Link href={`/runs/${rr.gatekeeper_run_id}`}>gatekeeper run #{rr.gatekeeper_run_id}</Link>
                    </div>
                  </div>
                </Section>
              );
            })}
        </div>
        <aside className="stack">
          {s.status !== 'human_approved' && s.status !== 'human_rejected' ? (
            <Section title="Human decision">
              <form action={decideEditSessionAction} className="card stack-sm">
                <input type="hidden" name="id" value={s.id} />
                <input className="input" name="note" placeholder="Why" />
                <div className="row">
                  <SubmitButton className="btn btn-green" name="op" value="approve">
                    Approve edit
                  </SubmitButton>
                  <SubmitButton className="btn btn-red" name="op" value="reject">
                    Reject
                  </SubmitButton>
                </div>
                <span className="xs muted">Pass mark {passMark}/60. Your decision is stored with every score and failure reason.</span>
              </form>
            </Section>
          ) : null}
          <Section title="After publishing">
            <form action={decideEditSessionAction} className="card stack-sm">
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="op" value="link" />
              <label className="field">
                <span className="field-label">Content ID this edit became</span>
                <input className="input" type="number" name="contentId" defaultValue={s.published_content_id ?? ''} required />
              </label>
              <SubmitButton className="btn">Link post</SubmitButton>
              <span className="xs muted">Linking lets BBO BRAIN compare Gatekeeper scores with real performance.</span>
            </form>
          </Section>
          <Section title="Source transcript">
            <div className="card">
              <pre className="xs muted" style={{ whiteSpace: 'pre-wrap', maxHeight: '26rem', overflowY: 'auto' }}>
                {s.source_transcript}
              </pre>
            </div>
          </Section>
        </aside>
      </div>
    </>
  );
}

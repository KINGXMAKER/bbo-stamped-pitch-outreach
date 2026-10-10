import Link from 'next/link';
import { notFound } from 'next/navigation';
import { assignContentAction, experimentStateAction } from '@/app/actions';
import { SubmitButton } from '@/components/client';
import { Notice } from '@/components/notice';
import { Confidence, Empty, fmtDate, PageHead, PostRow, Section, StatusChip } from '@/components/ui';
import { all, get, getDb, parseJson } from '@/lib/db/client';
import { loadFacts, METRIC_DEFS, type MetricKey } from '@/lib/intel/dataset';
import type { GroupComparison } from '@/lib/intel/stats';

export const dynamic = 'force-dynamic';

export default async function ExperimentDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const db = getDb();
  const e = get<{ id: number; code: string; name: string; hypothesis: string; variable_key: string | null; control_value: string | null; variant_value: string | null; primary_metric: MetricKey; status: string; origin: string; start_date: string | null; end_date: string | null; min_sample_per_arm: number; result_json: string | null; result_summary: string | null; confidence_label: string | null; lesson_id: number | null; franchise_id: number | null; topic_id: number | null }>(
    db,
    'SELECT * FROM experiments WHERE id = ?',
    Number(id)
  );
  if (!e) notFound();
  const assignments = all<{ content_id: number; arm: string; assigned_by: string }>(db, 'SELECT content_id, arm, assigned_by FROM experiment_content WHERE experiment_id = ?', e.id);
  const facts = new Map(loadFacts(db, { contentIds: assignments.map((a) => a.content_id) }).map((f) => [f.contentId, f]));
  const result = parseJson<{ primary?: GroupComparison; secondary?: Array<{ metric: MetricKey; comparison: GroupComparison }>; controlN?: number; variantN?: number; evaluatedAt?: string } | null>(e.result_json, null);
  const scope = [
    e.franchise_id ? get<{ name: string }>(db, 'SELECT name FROM franchises WHERE id = ?', e.franchise_id)?.name : null,
    e.topic_id ? get<{ name: string }>(db, 'SELECT name FROM topics WHERE id = ?', e.topic_id)?.name : null,
  ].filter(Boolean);
  const metricLabel = METRIC_DEFS[e.primary_metric]?.label ?? e.primary_metric;
  const fmt = (v: number | null | undefined) => (typeof v === 'number' ? (METRIC_DEFS[e.primary_metric]?.kind === 'rate' ? `${(v * 100).toFixed(2)}%` : v.toFixed(3)) : '—');

  return (
    <>
      <Notice searchParams={sp as Record<string, string>} />
      <PageHead
        kicker={`${e.code} · ${e.origin.replace(/_/g, ' ')}${scope.length ? ` · ${scope.join(' · ')}` : ''}`}
        title={e.name}
        lede={e.hypothesis}
        actions={
          <>
            <StatusChip status={e.status} />
            {e.confidence_label ? <Confidence label={e.confidence_label} /> : null}
          </>
        }
      />

      <div className="split">
        <div className="stack">
          <Section title="Design">
            <div className="grid-4">
              <Spec label="Variable" value={e.variable_key?.replace(/_/g, ' ') ?? 'manual assignment'} />
              <Spec label="Control" value={e.control_value?.replace(/_/g, ' ') ?? '—'} />
              <Spec label="Variant" value={e.variant_value?.replace(/_/g, ' ') ?? '—'} />
              <Spec label="Primary metric" value={metricLabel} />
            </div>
          </Section>

          <Section title="Result" note={result?.evaluatedAt ? `evaluated ${fmtDate(result.evaluatedAt, true)}` : undefined}>
            {result?.primary ? (
              <div className="card stack-sm">
                <div className="sowhat">
                  <div className="sowhat-text">{e.result_summary}</div>
                </div>
                <div className="grid-4">
                  <Spec label="Variant median" value={fmt(result.primary.medianGroup)} />
                  <Spec label="Control median" value={fmt(result.primary.medianRest)} />
                  <Spec label="Effect" value={result.primary.effect ? `${result.primary.effect.toFixed(2)}x` : '—'} />
                  <Spec label="p-value" value={result.primary.pValue?.toFixed(3) ?? '—'} />
                </div>
                {result.secondary?.length ? (
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Secondary metric</th>
                          <th className="num">Variant</th>
                          <th className="num">Control</th>
                          <th className="num">Effect</th>
                          <th>Signal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.secondary.map((s) => (
                          <tr key={s.metric}>
                            <td className="small">{METRIC_DEFS[s.metric]?.label}</td>
                            <td className="num">{s.comparison.medianGroup?.toFixed(4) ?? '—'}</td>
                            <td className="num">{s.comparison.medianRest?.toFixed(4) ?? '—'}</td>
                            <td className="num">{s.comparison.effect ? `${s.comparison.effect.toFixed(2)}x` : '—'}</td>
                            <td>
                              <Confidence label={s.comparison.confidence} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                <p className="xs muted">Assignments come from BBO&apos;s own posting, not random allocation — read results as strong associations, and keep topic and franchise constant where you can.</p>
                {e.lesson_id ? (
                  <Link href={`/lessons/${e.lesson_id}`} className="small pink">
                    Result recorded as a lesson →
                  </Link>
                ) : null}
              </div>
            ) : (
              <Empty title="No result yet">{e.status === 'proposed' ? 'Start the experiment, then publish posts in each arm.' : 'Evaluate once both arms have posts.'}</Empty>
            )}
          </Section>

          <div className="grid-2">
            {(['variant', 'control'] as const).map((arm) => {
              const list = assignments.filter((a) => a.arm === arm);
              return (
                <Section key={arm} title={`${arm} arm`} note={`${list.length} / ${e.min_sample_per_arm}`}>
                  <div className="card stack-sm">
                    {list.length ? (
                      list.map((a) => (facts.get(a.content_id) ? <PostRow key={a.content_id} fact={facts.get(a.content_id)!} extra={<span className="xs muted">assigned by {a.assigned_by}</span>} /> : null))
                    ) : (
                      <span className="small muted">No posts yet.</span>
                    )}
                  </div>
                </Section>
              );
            })}
          </div>
        </div>

        <aside className="stack">
          <Section title="Controls">
            <div className="card stack-sm">
              {e.status === 'proposed' ? (
                <form action={experimentStateAction} className="stack-sm">
                  <input type="hidden" name="id" value={e.id} />
                  <input type="hidden" name="op" value="start" />
                  <label className="field">
                    <span className="field-label">Count posts published from</span>
                    <input className="input" type="date" name="startDate" defaultValue={new Date().toISOString().slice(0, 10)} />
                  </label>
                  <SubmitButton className="btn btn-primary">Start experiment</SubmitButton>
                </form>
              ) : null}
              {e.status === 'running' ? (
                <>
                  <form action={experimentStateAction}>
                    <input type="hidden" name="id" value={e.id} />
                    <input type="hidden" name="op" value="evaluate" />
                    <SubmitButton className="btn">Evaluate now</SubmitButton>
                  </form>
                  <form action={experimentStateAction}>
                    <input type="hidden" name="id" value={e.id} />
                    <input type="hidden" name="op" value="complete" />
                    <SubmitButton className="btn btn-green">Complete → lesson</SubmitButton>
                  </form>
                </>
              ) : null}
              {e.status === 'proposed' || e.status === 'running' ? (
                <form action={experimentStateAction} className="row-tight">
                  <input type="hidden" name="id" value={e.id} />
                  <input type="hidden" name="op" value="abandon" />
                  <input className="input" name="note" placeholder="Why abandon?" style={{ flex: 1 }} />
                  <SubmitButton className="btn btn-sm btn-red">Abandon</SubmitButton>
                </form>
              ) : null}
              <div className="xs muted">
                Started {fmtDate(e.start_date, true)} · ended {fmtDate(e.end_date, true)}
              </div>
            </div>
          </Section>
          {e.status !== 'completed' && e.status !== 'abandoned' ? (
            <Section title="Assign a post">
              <form action={assignContentAction} className="card stack-sm">
                <input type="hidden" name="experimentId" value={e.id} />
                <input type="hidden" name="back" value={`/experiments/${e.id}`} />
                <label className="field">
                  <span className="field-label">Content ID (from the library URL)</span>
                  <input className="input" type="number" name="contentId" required />
                </label>
                <select className="select" name="arm">
                  <option value="variant">variant</option>
                  <option value="control">control</option>
                </select>
                <SubmitButton className="btn">Assign</SubmitButton>
                <span className="xs muted">Human assignments are never overwritten by auto-assignment.</span>
              </form>
            </Section>
          ) : null}
        </aside>
      </div>
    </>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel stack-xs">
      <div className="kicker kicker-muted">{label}</div>
      <div className="small white">{value}</div>
    </div>
  );
}

import Link from 'next/link';
import { decideProposalAction } from '@/app/actions';
import { JobButton, SubmitButton } from '@/components/client';
import { Notice } from '@/components/notice';
import { Confidence, Empty, fmtDate, PageHead, Section, StatusChip } from '@/components/ui';
import { all, getDb, parseJson } from '@/lib/db/client';
import { valueLabel, loadLabels } from '@/lib/intel/patterns';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Rule Proposals' };

type Proposal = {
  id: number;
  proposed_text: string;
  category: string;
  applies_to_json: string;
  reason: string;
  lesson_id: number | null;
  supporting_json: string;
  contradicting_json: string;
  metric_difference_json: string | null;
  sample_size: number | null;
  confidence_label: string | null;
  affected_rule_ids_json: string;
  status: string;
  decided_text: string | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
};

export default async function Proposals({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const db = getDb();
  const labels = loadLabels(db);
  const proposals = all<Proposal>(db, 'SELECT * FROM rule_proposals ORDER BY CASE status WHEN \'pending\' THEN 0 ELSE 1 END, id DESC');
  const pending = proposals.filter((p) => p.status === 'pending');
  const decided = proposals.filter((p) => p.status !== 'pending');
  const rules = new Map(all<{ id: number; code: string; text: string }>(db, 'SELECT r.id, r.code, rv.text FROM rules r JOIN rule_versions rv ON rv.id = r.current_version_id').map((r) => [r.id, r]));

  return (
    <>
      <Notice searchParams={sp as Record<string, string>} />
      <PageHead
        kicker="The loop editing the loop"
        title="Rule proposals"
        lede={<>When a lesson keeps holding up, BBO BRAIN proposes a rule. <em>Nothing changes until you decide.</em> Only approved rules reach future AI workflows.</>}
        actions={<JobButton kind="rule-proposals" label="Check for new proposals" className="btn" />}
      />

      {!pending.length ? (
        <Empty title="No proposals waiting">A lesson must be SUPPORTED at moderate-or-better confidence, with 8+ posts, across 2 consecutive evaluations before it is proposed.</Empty>
      ) : (
        <div className="stack">
          {pending.map((p) => {
            const supporting = parseJson<Array<{ contentId: number; title: string }>>(p.supporting_json, []);
            const contradicting = parseJson<Array<{ contentId: number; title: string }>>(p.contradicting_json, []);
            const diff = parseJson<{ metric?: string; effect?: number; describe?: string } | null>(p.metric_difference_json, null);
            const applies = parseJson<{ workflows?: string[]; franchises?: string[]; platforms?: string[] }>(p.applies_to_json, {});
            const affected = parseJson<number[]>(p.affected_rule_ids_json, []).map((id) => rules.get(id)).filter(Boolean);
            return (
              <article key={p.id} id={`p${p.id}`} className="card card-gold card-hero stack rise">
                <div className="row">
                  <span className="kicker kicker-gold">Proposed rule · #{p.id}</span>
                  <Confidence label={p.confidence_label} />
                  <span className="xs muted">proposed {fmtDate(p.created_at, true)}</span>
                </div>
                <h2 className="serif white" style={{ fontSize: 'clamp(1.4rem, 1.1rem + 1vw, 2rem)', lineHeight: 1.2 }}>
                  {p.proposed_text}
                </h2>

                <div className="grid-4">
                  <Box label="Why it was proposed">
                    <span className="small">{p.reason}</span>
                    {p.lesson_id ? (
                      <Link href={`/lessons/${p.lesson_id}`} className="xs pink">
                        open lesson →
                      </Link>
                    ) : null}
                  </Box>
                  <Box label="Metric difference">
                    <span className="mono white">{diff?.effect ? `${diff.effect.toFixed(2)}x` : '—'}</span>
                    <span className="xs muted">{diff?.describe}</span>
                  </Box>
                  <Box label="Sample size · confidence">
                    <span className="mono white">{p.sample_size ?? '?'} posts</span>
                    <Confidence label={p.confidence_label} />
                  </Box>
                  <Box label="Scope">
                    <span className="xs">{applies.workflows?.join(', ') ?? 'all workflows'}</span>
                    <span className="xs muted">{applies.franchises?.length ? applies.franchises.map((f) => valueLabel(labels, 'franchise', f)).join(', ') : 'all franchises'}</span>
                  </Box>
                </div>

                <div className="grid-3">
                  <Box label={`Supporting content (${supporting.length})`}>
                    {supporting.map((s) => (
                      <Link key={s.contentId} href={`/content/${s.contentId}`} className="xs clamp-2 up">
                        {s.title}
                      </Link>
                    ))}
                  </Box>
                  <Box label={`Contradicting content (${contradicting.length})`}>
                    {contradicting.length ? contradicting.map((s) => (
                      <Link key={s.contentId} href={`/content/${s.contentId}`} className="xs clamp-2 down">
                        {s.title}
                      </Link>
                    )) : <span className="xs muted">None in the linked evidence.</span>}
                  </Box>
                  <Box label="Current rules affected">
                    {affected.length ? affected.map((r) => (
                      <div key={r!.id} className="xs">
                        <span className="mono gold">{r!.code}</span> {r!.text}
                      </div>
                    )) : <span className="xs muted">No active rule tests the same attribute.</span>}
                  </Box>
                </div>

                <form action={decideProposalAction} className="stack-sm">
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="back" value="/proposals" />
                  <label className="field">
                    <span className="field-label">Edit the wording before approving (optional)</span>
                    <textarea name="text" className="textarea" defaultValue={p.proposed_text} style={{ minHeight: '4rem' }} />
                  </label>
                  <input className="input" name="note" placeholder="Decision note (kept with the record)" />
                  <div className="row">
                    <SubmitButton className="btn btn-green" name="action" value="approve">
                      Approve
                    </SubmitButton>
                    <SubmitButton className="btn btn-primary" name="action" value="edit_approve">
                      Edit + approve
                    </SubmitButton>
                    <SubmitButton className="btn btn-red" name="action" value="reject">
                      Reject
                    </SubmitButton>
                    <SubmitButton className="btn btn-ghost" name="action" value="observe">
                      Keep observing
                    </SubmitButton>
                  </div>
                </form>
              </article>
            );
          })}
        </div>
      )}

      {decided.length ? (
        <Section title="Decided" note={`${decided.length} proposals`}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Proposal</th>
                  <th>Decision</th>
                  <th>Final text / note</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((p) => (
                  <tr key={p.id}>
                    <td className="mono small">{p.id}</td>
                    <td className="small">{p.proposed_text}</td>
                    <td>
                      <StatusChip status={p.status} />
                    </td>
                    <td className="small">{p.decided_text ?? p.decision_note ?? '—'}</td>
                    <td className="small nowrap">{fmtDate(p.decided_at, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}
    </>
  );
}

function Box({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="panel stack-xs">
      <div className="kicker kicker-muted">{label}</div>
      {children}
    </div>
  );
}

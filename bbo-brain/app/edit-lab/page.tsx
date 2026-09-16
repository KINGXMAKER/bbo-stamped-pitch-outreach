import Link from 'next/link';
import { runEditSessionAction } from '@/app/actions';
import { SubmitButton } from '@/components/client';
import { Notice } from '@/components/notice';
import { Empty, fmtDate, PageHead, Section, StatusChip } from '@/components/ui';
import { all, get, getDb } from '@/lib/db/client';
import { aiConfigured } from '@/lib/ai/run';
import { formatTranscript } from '@/lib/intel/analysis';
import { gatekeeperCalibration } from '@/lib/intel/gatekeeper';
import { getSetting } from '@/lib/seed';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit Lab' };

export default async function EditLab({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const db = getDb();
  const gate = getSetting<{ passMark: number; maxAutoRetries: number }>(db, 'gatekeeper');
  const sessions = all<{ id: number; title: string; status: string; attempts: number; final_total: number | null; updated_at: string; published_content_id: number | null }>(db, 'SELECT id, title, status, attempts, final_total, updated_at, published_content_id FROM edit_sessions ORDER BY id DESC LIMIT 40');
  const withTranscripts = all<{ id: number; title: string }>(db, `SELECT c.id, c.title FROM content c JOIN transcripts t ON t.content_id = c.id JOIN platform_posts pp ON pp.id = c.primary_post_id ORDER BY pp.published_at DESC LIMIT 60`);
  const prefillId = Number(sp.content) || null;
  const prefill = prefillId ? get<{ title: string; segments_json: string | null; slug: string | null }>(db, `SELECT c.title, t.segments_json, f.slug FROM content c JOIN transcripts t ON t.content_id = c.id LEFT JOIN franchises f ON f.id = c.franchise_id WHERE c.id = ? ORDER BY t.id DESC LIMIT 1`, prefillId) : null;
  const franchises = all<{ slug: string; name: string }>(db, 'SELECT slug, name FROM franchises ORDER BY name');
  const calibration = gatekeeperCalibration(db);

  return (
    <>
      <Notice searchParams={sp as Record<string, string>} />
      <PageHead
        kicker="BBO Viral Editor → BBO Gatekeeper"
        title="Edit Lab"
        lede={<>The editor builds the cut from the transcript. A separate Gatekeeper judges it — pass at {gate.passMark}/60 with no automatic failures, up to {gate.maxAutoRetries} automatic revisions, then you decide.</>}
      />
      <div className="split">
        <div className="stack">
          <Section title="New edit">
            <form action={runEditSessionAction} className="card stack-sm">
              <div className="row-tight xs">
                <span className="muted">Load a transcribed post:</span>
                {withTranscripts.slice(0, 8).map((c) => (
                  <Link key={c.id} href={`/edit-lab?content=${c.id}`} className={`chip ${prefillId === c.id ? 'chip-pink' : ''}`}>
                    {c.title.slice(0, 28)}
                  </Link>
                ))}
              </div>
              <input type="hidden" name="contentId" value={prefillId ?? ''} />
              <div className="grid-2">
                <label className="field">
                  <span className="field-label">Title</span>
                  <input className="input" name="title" defaultValue={prefill?.title ?? ''} required />
                </label>
                <label className="field">
                  <span className="field-label">Franchise (loads its scoped rules)</span>
                  <select className="select" name="franchise" defaultValue={prefill?.slug ?? ''}>
                    <option value="">Unspecified</option>
                    {franchises.map((f) => (
                      <option key={f.slug} value={f.slug}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="field">
                <span className="field-label">Source transcript with timestamps</span>
                <textarea className="textarea mono xs" name="transcript" defaultValue={prefill ? formatTranscript(prefill.segments_json) : ''} style={{ minHeight: '16rem' }} placeholder={'[00:00.0–00:02.1] first line\n[00:02.1–00:05.4] next line'} required />
              </label>
              <div className="spread">
                <span className="xs muted">{aiConfigured() ? 'Runs 2–6 model calls (≈1–4 minutes).' : 'GEMINI_API_KEY is not set — the Edit Lab needs an AI provider.'}</span>
                <SubmitButton className="btn btn-primary" pendingText="Editor and Gatekeeper working…">
                  Run editor + gatekeeper
                </SubmitButton>
              </div>
            </form>
          </Section>

          <Section title="Sessions">
            {sessions.length ? (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Edit</th>
                      <th>Status</th>
                      <th className="num">Attempts</th>
                      <th className="num">Final</th>
                      <th>Published as</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <Link href={`/edit-lab/${s.id}`} className="white">
                            {s.title}
                          </Link>
                        </td>
                        <td>
                          <StatusChip status={s.status} />
                        </td>
                        <td className="num">{s.attempts}</td>
                        <td className={`num ${s.final_total !== null && s.final_total >= gate.passMark ? 'up' : 'down'}`}>{s.final_total ?? '—'}/60</td>
                        <td className="small">{s.published_content_id ? <Link href={`/content/${s.published_content_id}`}>#{s.published_content_id}</Link> : '—'}</td>
                        <td className="small">{fmtDate(s.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No edits yet" />
            )}
          </Section>
        </div>
        <aside className="stack">
          <Section title="Does the Gatekeeper predict winners?">
            <div className="card stack-sm">
              <div className="serif white" style={{ fontSize: '1.1rem' }}>
                {calibration.verdict}
              </div>
              <div className="xs muted">
                {calibration.n} published edits with scores · Spearman ρ {calibration.spearman?.toFixed(2) ?? '—'} · median score when passed {calibration.medianScorePassed?.toFixed(2) ?? '—'} vs failed {calibration.medianScoreFailed?.toFixed(2) ?? '—'}
              </div>
              <span className="xs muted">Link each edit to the post it became (on the session page) so this can be measured.</span>
            </div>
          </Section>
          <Section title="Automatic failures">
            <div className="card stack-xs xs">
              {['unclear speaker/context', 'hook requires excessive explanation', 'no meaningful payoff', 'dead setup dominates opening', 'hook/payoff mismatch', 'near-duplicate of a post in the last 30 days (checked by code, not the model)', 'a stronger opening exists later in the source'].map((f) => (
                <div key={f}>— {f}</div>
              ))}
            </div>
          </Section>
        </aside>
      </div>
    </>
  );
}

import Link from 'next/link';
import { Empty, fmtDate, PageHead, StatusChip } from '@/components/ui';
import { all, getDb } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI Agent Runs' };

export default async function Runs({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (sp.workflow) {
    where.push('r.workflow = ?');
    params.push(sp.workflow);
  }
  if (sp.status) {
    where.push('r.status = ?');
    params.push(sp.status);
  }
  if (sp.content && Number(sp.content)) {
    where.push(`json_extract(r.input_json, '$.contentId') = ?`);
    params.push(Number(sp.content));
  }
  const runs = all<{ id: number; workflow: string; status: string; model: string | null; prompt_slug: string | null; prompt_version: number | null; skill: string | null; skill_version: number | null; score_version: string | null; rules: number; latency_ms: number | null; confidence: string | null; created_at: string; error: string | null }>(
    db,
    `SELECT r.id, r.workflow, r.status, r.model, pv.slug AS prompt_slug, pv.version AS prompt_version, s.slug AS skill, sv.version AS skill_version, psv.version AS score_version,
            (SELECT COUNT(*) FROM ai_run_rules arr WHERE arr.ai_run_id = r.id) AS rules, r.latency_ms, r.confidence, r.created_at, r.error
     FROM ai_runs r LEFT JOIN prompt_versions pv ON pv.id = r.prompt_version_id LEFT JOIN skill_versions sv ON sv.id = r.skill_version_id LEFT JOIN skills s ON s.id = sv.skill_id
     LEFT JOIN performance_score_versions psv ON psv.id = r.score_version_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.id DESC LIMIT 200`,
    ...params
  );
  const workflows = all<{ workflow: string; n: number; errors: number }>(db, `SELECT workflow, COUNT(*) AS n, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors FROM ai_runs GROUP BY workflow ORDER BY n DESC`);

  return (
    <>
      <PageHead kicker="AI Agent Runs" title="Every model call, on the record" lede={<>Model, prompt version, skill version, the exact rule versions loaded, score version, inputs, structured output and confidence. No chain-of-thought is requested or stored.</>} />
      <div className="row" style={{ marginBottom: '1rem' }}>
        <Link href="/runs" className={`chip ${!sp.workflow ? 'chip-pink' : ''}`}>
          All
        </Link>
        {workflows.map((w) => (
          <Link key={w.workflow} href={`/runs?workflow=${w.workflow}`} className={`chip ${sp.workflow === w.workflow ? 'chip-pink' : ''}`}>
            {w.workflow.replace(/_/g, ' ')} ({w.n}
            {w.errors ? `, ${w.errors} errors` : ''})
          </Link>
        ))}
      </div>
      {runs.length ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Workflow</th>
                <th>Status</th>
                <th>Model</th>
                <th>Prompt</th>
                <th>Skill</th>
                <th className="num">Rules</th>
                <th>Score</th>
                <th className="num">Latency</th>
                <th>Confidence</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="mono small">
                    <Link href={`/runs/${r.id}`} className="pink">
                      {r.id}
                    </Link>
                  </td>
                  <td className="small">{r.workflow.replace(/_/g, ' ')}</td>
                  <td>
                    <StatusChip status={r.status} />
                  </td>
                  <td className="mono xs">{r.model ?? '—'}</td>
                  <td className="mono xs">{r.prompt_slug ? `${r.prompt_slug} v${r.prompt_version}` : '—'}</td>
                  <td className="mono xs">{r.skill ? `${r.skill} v${r.skill_version}` : '—'}</td>
                  <td className="num">{r.rules || ''}</td>
                  <td className="mono xs">{r.score_version ?? ''}</td>
                  <td className="num">{r.latency_ms ? `${(r.latency_ms / 1000).toFixed(1)}s` : '—'}</td>
                  <td className="small">{r.confidence ?? ''}</td>
                  <td className="small nowrap">{fmtDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No AI runs yet">Runs appear when analysis, enrichment, reviews, the Edit Lab or Ask BBO call a model.</Empty>
      )}
    </>
  );
}

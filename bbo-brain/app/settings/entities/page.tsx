import Link from 'next/link';
import { decideEntityAction } from '@/app/actions';
import { SubmitButton } from '@/components/client';
import { Notice } from '@/components/notice';
import { Empty, fmtDate, PageHead, Section, StatusChip } from '@/components/ui';
import { all, getDb } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Entity Resolution' };

export default async function Entities({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const db = getDb();
  const pending = all<{ id: number; entity_type: string; raw_value: string; suggested_entity_id: string | null; similarity: number | null; context_content_id: number | null; context: string | null; created_at: string; suggested_name: string | null; content_title: string | null }>(
    db,
    `SELECT c.*, CASE c.entity_type WHEN 'person' THEN (SELECT canonical_name FROM people WHERE CAST(id AS TEXT) = c.suggested_entity_id)
                                    WHEN 'topic' THEN (SELECT name FROM topics WHERE CAST(id AS TEXT) = c.suggested_entity_id)
                                    WHEN 'franchise' THEN (SELECT name FROM franchises WHERE CAST(id AS TEXT) = c.suggested_entity_id) END AS suggested_name,
            (SELECT title FROM content WHERE id = c.context_content_id) AS content_title
     FROM entity_resolution_candidates c WHERE c.status = 'pending' ORDER BY c.similarity DESC`
  );
  const resolved = all<{ id: number; entity_type: string; raw_value: string; status: string; resolved_entity_id: string | null; resolved_at: string }>(db, `SELECT id, entity_type, raw_value, status, resolved_entity_id, resolved_at FROM entity_resolution_candidates WHERE status != 'pending' ORDER BY resolved_at DESC LIMIT 30`);

  return (
    <>
      <Notice searchParams={sp as Record<string, string>} />
      <PageHead
        kicker="Settings · Entity resolution"
        title="Is this the same person?"
        lede={<>Near-matches are never merged silently. Exact aliases resolve automatically; anything that only looks similar waits here for you.</>}
      />
      {pending.length ? (
        <div className="stack">
          {pending.map((c) => (
            <article key={c.id} className="card stack-sm">
              <div className="row">
                <span className="chip">{c.entity_type}</span>
                <span className="xs muted">similarity {c.similarity !== null ? `${Math.round(c.similarity * 100)}%` : '—'} · {fmtDate(c.created_at, true)}</span>
              </div>
              <div className="grid-2">
                <div className="panel stack-xs">
                  <div className="kicker kicker-muted">Found</div>
                  <div className="white" style={{ fontSize: '1.15rem' }}>
                    {c.raw_value}
                  </div>
                  {c.context_content_id ? (
                    <Link href={`/content/${c.context_content_id}`} className="xs pink clamp-2">
                      in: {c.content_title}
                    </Link>
                  ) : null}
                </div>
                <div className="panel stack-xs">
                  <div className="kicker kicker-muted">Looks like</div>
                  <div className="white" style={{ fontSize: '1.15rem' }}>
                    {c.suggested_name ?? c.suggested_entity_id}
                  </div>
                  {c.entity_type === 'person' && c.suggested_entity_id ? (
                    <Link href={`/people/${c.suggested_entity_id}`} className="xs pink">
                      open profile →
                    </Link>
                  ) : null}
                </div>
              </div>
              <form action={decideEntityAction} className="row">
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="entityId" value={c.suggested_entity_id ?? ''} />
                <SubmitButton className="btn btn-green" name="action" value="merge">
                  Same — merge & learn alias
                </SubmitButton>
                {c.entity_type === 'person' ? (
                  <SubmitButton className="btn" name="action" value="create">
                    Different person
                  </SubmitButton>
                ) : null}
                <SubmitButton className="btn btn-ghost" name="action" value="ignore">
                  Ignore
                </SubmitButton>
              </form>
            </article>
          ))}
        </div>
      ) : (
        <Empty title="Nothing to review">Every name in BBO BRAIN is resolved.</Empty>
      )}
      {resolved.length ? (
        <Section title="Recently resolved">
          <div className="table-wrap">
            <table className="data">
              <tbody>
                {resolved.map((r) => (
                  <tr key={r.id}>
                    <td className="small">{r.entity_type}</td>
                    <td className="small white">{r.raw_value}</td>
                    <td>
                      <StatusChip status={r.status} />
                    </td>
                    <td className="small">{fmtDate(r.resolved_at, true)}</td>
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

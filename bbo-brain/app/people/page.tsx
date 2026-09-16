import Link from 'next/link';
import { Empty, fmtDate, fmtX, PageHead } from '@/components/ui';
import { getDb } from '@/lib/db/client';
import { peopleIndex } from '@/lib/intel/queries';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'People & Guests' };

export default async function People({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const minApps = Number(sp.min ?? 2);
  const role = sp.role ?? 'guest';
  const all = peopleIndex(getDb());
  const people = all.filter((p) => p.appearances >= minApps && (role === 'all' || p.roles.includes(role)));
  const tone = (v: number | null) => (v === null ? '' : v >= 1.15 ? 'up' : v <= 0.85 ? 'down' : '');

  return (
    <>
      <PageHead
        kicker="People / Guests"
        title="Who moves BBO content"
        lede={<>How content featuring each person performs against BBO&apos;s baseline. Identified from caption tags and People records — untagged appearances are not counted.</>}
      />
      <div className="row" style={{ marginBottom: '1rem' }}>
        {[
          ['guest', 'Guests'],
          ['editor', 'Editors'],
          ['creator', 'Creators'],
          ['all', 'Everyone'],
        ].map(([r, l]) => (
          <Link key={r} href={`/people?role=${r}&min=${minApps}`} className={`chip ${role === r ? 'chip-pink' : ''}`}>
            {l}
          </Link>
        ))}
        <span className="section-rule" />
        {[1, 2, 3, 5].map((m) => (
          <Link key={m} href={`/people?role=${role}&min=${m}`} className={`chip ${minApps === m ? 'chip-pink' : ''}`}>
            {m}+ appearances
          </Link>
        ))}
      </div>
      {people.length ? (
        <div className="table-wrap rise">
          <table className="data">
            <thead>
              <tr>
                <th>Person</th>
                <th>Roles</th>
                <th>Gender</th>
                <th className="num">Appearances</th>
                <th className="num">Scored</th>
                <th className="num">Median score</th>
                <th className="num">Share rate</th>
                <th className="num">Comment rate</th>
                <th className="num">Retention</th>
                <th>Last appearance</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/people/${p.id}`} className="white">
                      {p.canonical_name}
                    </Link>
                  </td>
                  <td className="small muted">{p.roles.join(', ')}</td>
                  <td className="small muted">{p.gender ?? '—'}</td>
                  <td className="num">{p.appearances}</td>
                  <td className="num">{p.scored}</td>
                  <td className={`num ${tone(p.medianScore)}`}>{p.medianScore?.toFixed(2) ?? '—'}</td>
                  <td className={`num ${tone(p.shareRatio)}`}>{fmtX(p.shareRatio)}</td>
                  <td className={`num ${tone(p.commentRatio)}`}>{fmtX(p.commentRatio)}</td>
                  <td className={`num ${tone(p.retentionRatio)}`}>{fmtX(p.retentionRatio)}</td>
                  <td className="small nowrap">{fmtDate(p.lastAppearance, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Nobody matches">Lower the appearance filter.</Empty>
      )}
      <p className="xs muted" style={{ marginTop: '.8rem' }}>
        Rate columns are medians relative to the BBO median for all scored posts (1.00x = typical). With 2–4 appearances, treat any ranking as an early signal.
      </p>
    </>
  );
}

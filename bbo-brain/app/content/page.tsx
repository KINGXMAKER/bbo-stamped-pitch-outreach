import Link from 'next/link';
import { DemoFlag, fmtDate, fmtNum, fmtPct, LabelChip, PageHead, Thumb } from '@/components/ui';
import { getDb } from '@/lib/db/client';
import { filterOptions, libraryQuery, type LibraryFilters } from '@/lib/intel/queries';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Content Library' };

const PAGE = 60;
const LABELS = ['BREAKOUT', 'WINNER', 'ABOVE_AVERAGE', 'AVERAGE', 'BELOW_AVERAGE', 'LOSER', 'IMMATURE', 'UNSCORED'];
const DURATIONS = ['<=15s', '16-30s', '31-45s', '46-60s', '>60s'];
const SORTS: Array<[NonNullable<LibraryFilters['sort']>, string]> = [
  ['newest', 'Newest'],
  ['score', 'Performance score'],
  ['views', 'Views'],
  ['share_rate', 'Share rate'],
  ['comment_rate', 'Comment rate'],
  ['retention', 'Retention'],
  ['saves', 'Saves'],
  ['gatekeeper', 'Gatekeeper score'],
];

export default async function Library({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const db = getDb();
  const filters: LibraryFilters = {
    q: sp.q,
    from: sp.from,
    to: sp.to,
    franchise: sp.franchise,
    guest: sp.guest,
    topic: sp.topic,
    hook: sp.hook,
    label: sp.label,
    duration: sp.duration,
    outcome: sp.outcome === 'winners' || sp.outcome === 'losers' ? sp.outcome : undefined,
    experiment: sp.experiment,
    violations: sp.violations === 'yes' ? 'yes' : undefined,
    sort: (SORTS.find(([k]) => k === sp.sort)?.[0] ?? 'newest') as LibraryFilters['sort'],
  };
  const { rows, total } = libraryQuery(db, filters);
  const options = filterOptions(db);
  const page = Math.max(1, Number(sp.page ?? 1));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const qs = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter((e): e is [string, string] => Boolean(e[1])));
    return `/content?${next.toString()}`;
  };
  const sel = (name: string, value: string | undefined, children: React.ReactNode, label: string) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <select name={name} defaultValue={value ?? ''} className="select">
        <option value="">All</option>
        {children}
      </select>
    </label>
  );

  return (
    <>
      <PageHead kicker="Content Library" title="Everything BBO has posted" lede={<>{total.toLocaleString()} posts match. Every score is relative to comparable BBO posts — <em>1.0 is expected</em>.</>} />

      <form className="card filters rise" method="get" action="/content">
        <label className="field" style={{ gridColumn: 'span 2' }}>
          <span className="field-label">Search caption or title</span>
          <input className="input" name="q" defaultValue={sp.q ?? ''} placeholder="e.g. cheating, marketing, Nicki" />
        </label>
        <label className="field">
          <span className="field-label">From</span>
          <input className="input" type="date" name="from" defaultValue={sp.from ?? ''} />
        </label>
        <label className="field">
          <span className="field-label">To</span>
          <input className="input" type="date" name="to" defaultValue={sp.to ?? ''} />
        </label>
        {sel(
          'franchise',
          sp.franchise,
          <>
            <option value="unclassified">Unclassified</option>
            {options.franchises.map((f) => (
              <option key={f.slug} value={f.slug}>
                {f.name} ({f.n})
              </option>
            ))}
          </>,
          'Franchise'
        )}
        {sel('topic', sp.topic, options.topics.map((t) => <option key={t.slug} value={t.slug}>{`${t.name} (${t.n})`}</option>), 'Topic')}
        {sel('guest', sp.guest, options.guests.slice(0, 150).map((g) => <option key={g.id} value={g.id}>{`${g.name} (${g.n})`}</option>), 'Guest')}
        {sel('hook', sp.hook, options.hooks.map((h) => <option key={h.value} value={h.value}>{`${h.value.replace(/_/g, ' ')} (${h.n})`}</option>), 'Hook type')}
        {sel('label', sp.label, LABELS.map((l) => <option key={l} value={l}>{l.replace(/_/g, ' ')}</option>), 'Classification')}
        {sel('duration', sp.duration, DURATIONS.map((d) => <option key={d} value={d}>{d}</option>), 'Length')}
        {sel(
          'outcome',
          sp.outcome,
          <>
            <option value="winners">Winners</option>
            <option value="losers">Losers</option>
          </>,
          'Winner / loser'
        )}
        {sel('experiment', sp.experiment, options.experiments.map((e) => <option key={e.code} value={e.code}>{e.code}</option>), 'Experiment')}
        {sel('violations', sp.violations, <option value="yes">Breaks an active rule</option>, 'Rule violation')}
        <label className="field">
          <span className="field-label">Sort by</span>
          <select name="sort" defaultValue={filters.sort} className="select">
            {SORTS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <button className="btn btn-primary" type="submit">
            Apply
          </button>
          <Link href="/content" className="btn btn-ghost">
            Reset
          </Link>
        </div>
      </form>

      <div className="table-wrap section rise rise-2">
        <table className="data">
          <thead>
            <tr>
              <th />
              <th>Post</th>
              <th>Franchise</th>
              <th>Published</th>
              <th className="num">Score</th>
              <th>Class</th>
              <th className="num">Views</th>
              <th className="num">Reach</th>
              <th className="num">Share rate</th>
              <th className="num">Comment rate</th>
              <th className="num">Saves</th>
              <th className="num">Retention</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.contentId}>
                <td style={{ width: 52 }}>
                  <Link href={`/content/${r.contentId}`}>
                    <Thumb contentId={r.contentId} hasThumb={Boolean(r.thumbPath)} title={r.title} small />
                  </Link>
                </td>
                <td style={{ minWidth: 260, maxWidth: 380 }}>
                  <Link href={`/content/${r.contentId}`} className="stack-xs">
                    <span className="white clamp-2">{r.title}</span>
                    <span className="row-tight xs muted">
                      {r.format}
                      {r.durationS ? ` · ${Math.round(r.durationS)}s` : ''}
                      {r.attrs.hook_type ? ` · ${r.attrs.hook_type.replace(/_/g, ' ')}` : ''}
                      {r.topics[0] ? ` · ${r.topics[0].name}` : ''}
                    </span>
                  </Link>
                </td>
                <td className="small">{r.franchiseName ?? <span className="muted">—</span>}</td>
                <td className="small nowrap">{fmtDate(r.publishedAt, true)}</td>
                <td className={`num ${r.score !== null && r.score >= 1.15 ? 'up' : r.score !== null && r.score <= 0.85 ? 'down' : ''}`}>{r.score?.toFixed(2) ?? '—'}</td>
                <td>
                  <LabelChip label={r.label} />
                </td>
                <td className="num">{fmtNum(r.raw.views)}</td>
                <td className="num">{fmtNum(r.raw.reach)}</td>
                <td className="num">{fmtPct(r.rates.share_rate)}</td>
                <td className="num">{fmtPct(r.rates.comment_rate)}</td>
                <td className="num">{fmtNum(r.raw.saves)}</td>
                <td className="num">{r.rates.retention !== undefined ? `${Math.round(r.rates.retention * 100)}%` : '—'}</td>
                <td>
                  <span className="row-tight">
                    {r.isDemo ? <DemoFlag /> : null}
                    {r.violations.map((v) => (
                      <span key={v.code} className="chip chip-red" title={v.text}>
                        {v.code}
                      </span>
                    ))}
                    {r.experiments.map((e) => (
                      <span key={e} className="chip chip-pink">
                        {e}
                      </span>
                    ))}
                    {r.hasTranscript ? <span className="chip chip-muted">transcript</span> : null}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length ? <div className="empty" style={{ border: 0 }}>No posts match these filters.</div> : null}
      </div>

      {total > PAGE ? (
        <div className="spread section">
          <span className="small muted">
            {(page - 1) * PAGE + 1}–{Math.min(page * PAGE, total)} of {total.toLocaleString()}
          </span>
          <div className="row">
            {page > 1 ? (
              <Link className="btn btn-sm" href={qs({ page: String(page - 1) })}>
                ← Previous
              </Link>
            ) : null}
            {page * PAGE < total ? (
              <Link className="btn btn-sm" href={qs({ page: String(page + 1) })}>
                Next →
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

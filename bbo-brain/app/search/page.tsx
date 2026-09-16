import Link from 'next/link';
import { Empty, PageHead } from '@/components/ui';
import { all, getDb } from '@/lib/db/client';
import { search } from '@/lib/intel/search';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Search' };

const LABEL: Record<string, string> = { content: 'Content & transcripts', analysis: 'AI analyses', person: 'People', topic: 'Topics', lesson: 'Lessons', rule: 'Rules', experiment: 'Experiments' };

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { q = '' } = await searchParams;
  const db = getDb();
  const hits = q ? search(db, q, { limit: 120 }) : [];
  const topicSlugs = new Map(all<{ id: number; slug: string }>(db, 'SELECT id, slug FROM topics').map((t) => [String(t.id), t.slug]));
  const href = (type: string, id: string) =>
    ({ content: `/content/${id}`, analysis: `/content/${id}`, person: `/people/${id}`, topic: `/topics/${topicSlugs.get(id) ?? ''}`, lesson: `/lessons/${id}`, rule: `/rules/${id}`, experiment: `/experiments/${id}` })[type] ?? '/';
  const groups = new Map<string, typeof hits>();
  for (const h of hits) groups.set(h.entityType, [...(groups.get(h.entityType) ?? []), h]);

  return (
    <>
      <PageHead kicker="Search" title={q ? `“${q}”` : 'Search'} lede={q ? `${hits.length} matches across content, transcripts, people, topics, lessons, rules, experiments and analyses.` : undefined} />
      <form action="/search" className="card row" style={{ marginBottom: '1.5rem' }}>
        <input className="input" name="q" defaultValue={q} placeholder="Search everything BBO BRAIN knows" style={{ flex: 1 }} autoFocus />
        <button className="btn btn-primary" type="submit">
          Search
        </button>
      </form>
      {q && !hits.length ? <Empty title="No matches">Search matches word prefixes. If the index is stale, rebuild it in Settings.</Empty> : null}
      <div className="grid-2">
        {[...groups.entries()].map(([type, list]) => (
          <section key={type} className="card stack-sm">
            <div className="kicker">
              {LABEL[type] ?? type} · {list.length}
            </div>
            {list.slice(0, 20).map((h) => (
              <Link key={`${type}${h.entityId}`} href={href(type, h.entityId)} className="stack-xs">
                <span className="white small">{h.title}</span>
                <span className="xs muted clamp-2">
                  {h.snippet.split(/⟪|⟫/).map((part, i) => (i % 2 ? <mark key={i} style={{ background: 'var(--pink-ink)', color: 'var(--pink-soft)' }}>{part}</mark> : part))}
                </span>
              </Link>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}

import Link from 'next/link';
import { GraphView } from '@/components/graph-view';
import { JobButton } from '@/components/client';
import { Empty, PageHead, Section } from '@/components/ui';
import { all, getDb } from '@/lib/db/client';
import { graphStats, neighbors, overviewSubgraph, type NodeType } from '@/lib/intel/graph';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Knowledge Graph' };

const TYPES: NodeType[] = ['franchise', 'topic', 'person', 'rule', 'lesson', 'experiment', 'platform', 'skill', 'content'];

const href = (type: string, id: string) =>
  ({ content: `/content/${id}`, person: `/people/${id}`, lesson: `/lessons/${id}`, rule: `/rules/${id}`, experiment: `/experiments/${id}` })[type] ?? `/graph?type=${type}&id=${id}`;

export default async function Graph({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const db = getDb();
  const stats = graphStats(db);
  const type = TYPES.includes(sp.type as NodeType) ? (sp.type as NodeType) : null;
  const id = sp.id ?? null;
  const rel = sp.rel || undefined;
  const edges = type && id ? neighbors(db, type, id, rel, 300) : [];
  const overview = overviewSubgraph(db, 70);
  const pickers = {
    franchise: all<{ id: number; name: string }>(db, 'SELECT id, name FROM franchises ORDER BY name'),
    topic: all<{ id: number; name: string }>(db, 'SELECT id, name FROM topics ORDER BY name'),
    person: all<{ id: number; name: string }>(db, `SELECT p.id, p.canonical_name AS name FROM people p JOIN content_people cp ON cp.person_id = p.id AND cp.role = 'guest' GROUP BY p.id HAVING COUNT(*) >= 2 ORDER BY COUNT(*) DESC LIMIT 60`),
    rule: all<{ id: number; name: string }>(db, `SELECT r.id, r.code || ' ' || substr(rv.text, 1, 40) AS name FROM rules r JOIN rule_versions rv ON rv.id = r.current_version_id ORDER BY r.code`),
  };
  const grouped = new Map<string, typeof edges>();
  for (const e of edges) {
    const key = `${e.rel} · ${e.src.type === type && e.src.id === id ? `→ ${e.dst.type}` : `← ${e.src.type}`}`;
    grouped.set(key, [...(grouped.get(key) ?? []), e]);
  }

  return (
    <>
      <PageHead
        kicker="Knowledge graph"
        title="How it all connects"
        lede={<>Content, people, topics, franchises, experiments, lessons, rules and skills — stored as queryable relationships first, drawn second.</>}
        actions={<JobButton kind="graph" label="Rebuild graph" className="btn" />}
      />

      {!stats.length ? (
        <Empty title="Graph not built yet">Rebuild after content and lessons exist.</Empty>
      ) : (
        <>
          <Section title="Query" note="pick a node to see every relationship">
            <form className="card filters" method="get" action="/graph">
              {(Object.keys(pickers) as Array<keyof typeof pickers>).map((t) => (
                <label key={t} className="field">
                  <span className="field-label">{t}</span>
                  <select className="select" name={`pick_${t}`} defaultValue={type === t ? id ?? '' : ''} disabled>
                    <option value="">—</option>
                  </select>
                </label>
              )).slice(0, 0)}
              <label className="field">
                <span className="field-label">Node type</span>
                <select className="select" name="type" defaultValue={type ?? 'topic'}>
                  {TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ gridColumn: 'span 2' }}>
                <span className="field-label">Node</span>
                <select className="select" name="id" defaultValue={id ?? ''}>
                  {(Object.entries(pickers) as Array<[string, Array<{ id: number; name: string }>]>).map(([t, list]) => (
                    <optgroup key={t} label={t}>
                      {list.map((n) => (
                        <option key={`${t}${n.id}`} value={n.id}>
                          {n.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Relationship</span>
                <select className="select" name="rel" defaultValue={rel ?? ''}>
                  <option value="">Any</option>
                  {[...new Set(stats.map((s) => s.rel))].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              <button type="submit" className="btn btn-primary">
                Query
              </button>
            </form>
            <p className="xs muted" style={{ marginTop: '.4rem' }}>
              Pick the node type that matches the node (franchise, topic, person or rule). Content, lesson and experiment nodes are reachable from their own pages.
            </p>
          </Section>

          {type && id ? (
            <Section title={`${edges.length} relationships`} note={`${type} #${id}${rel ? ` · ${rel}` : ''}`}>
              {edges.length ? (
                <div className="grid-2">
                  {[...grouped.entries()].map(([key, list]) => (
                    <div key={key} className="card stack-xs">
                      <div className="kicker">
                        {key} ({list.length})
                      </div>
                      {list.slice(0, 25).map((e, i) => {
                        const other = e.src.type === type && e.src.id === id ? e.dst : e.src;
                        return (
                          <Link key={i} href={href(other.type, other.id)} className="spread xs">
                            <span className="clamp-2">{other.label}</span>
                            {e.weight !== null ? <span className="mono muted">{e.weight.toFixed(1)}</span> : null}
                          </Link>
                        );
                      })}
                      {list.length > 25 ? <span className="xs muted">+{list.length - 25} more</span> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <Empty title="No relationships for this node" />
              )}
            </Section>
          ) : null}

          <Section title="Map" note="most-connected people, topics, franchises, rules and lessons · click to query">
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <GraphView nodes={overview.nodes} links={overview.links} />
            </div>
          </Section>

          <Section title="Relationship inventory">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>From</th>
                    <th>Relationship</th>
                    <th>To</th>
                    <th className="num">Edges</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s, i) => (
                    <tr key={i}>
                      <td className="small">{s.src_type}</td>
                      <td className="mono small pink">{s.rel}</td>
                      <td className="small">{s.dst_type}</td>
                      <td className="num">{s.n.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </>
  );
}

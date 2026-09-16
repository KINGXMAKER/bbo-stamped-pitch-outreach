import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Confidence, PageHead, PostRow, Section } from '@/components/ui';
import { getDb } from '@/lib/db/client';
import { METRIC_DEFS } from '@/lib/intel/dataset';
import { topicDetail } from '@/lib/intel/queries';

export const dynamic = 'force-dynamic';

export default async function TopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = topicDetail(getDb(), slug);
  if (!d) notFound();
  const score = d.comparisons.find((c) => c.metric === 'performance_score')?.comparison;

  return (
    <>
      <PageHead
        kicker={`Topic${d.parent ? ` · under ${d.parent.name}` : ''}`}
        title={d.topic.name}
        lede={
          score && score.verdict !== 'insufficient'
            ? score.verdict === 'no_difference'
              ? `${d.topic.name} performs in line with other BBO content (${score.effect?.toFixed(2)}x across ${score.nGroup} scored posts).`
              : `${d.topic.name} content is associated with ${score.verdict === 'positive' ? 'stronger' : 'weaker'} performance: ${score.effect?.toFixed(2)}x other posts across ${score.nGroup} scored posts.`
            : `Only ${score?.nGroup ?? 0} scored posts — not enough to judge yet.`
        }
      />
      <div className="split">
        <div className="stack">
          <Section title="Versus other topics">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th className="num">Posts</th>
                    <th className="num">This topic</th>
                    <th className="num">Everything else</th>
                    <th className="num">Effect</th>
                    <th>Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {d.comparisons.map(({ metric, comparison: c }) => (
                    <tr key={metric}>
                      <td className="small">{METRIC_DEFS[metric].label}</td>
                      <td className="num">{c.nGroup}</td>
                      <td className="num">{c.medianGroup !== null ? (METRIC_DEFS[metric].kind === 'rate' ? `${(c.medianGroup * 100).toFixed(2)}%` : c.medianGroup.toFixed(2)) : '—'}</td>
                      <td className="num">{c.medianRest !== null ? (METRIC_DEFS[metric].kind === 'rate' ? `${(c.medianRest * 100).toFixed(2)}%` : c.medianRest.toFixed(2)) : '—'}</td>
                      <td className={`num ${c.effect && c.effect >= 1.25 ? 'up' : c.effect && c.effect <= 0.8 ? 'down' : ''}`}>{c.effect ? `${c.effect.toFixed(2)}x` : '—'}</td>
                      <td>
                        <Confidence label={c.confidence} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <div className="grid-2">
            <Breakdown title="By franchise" rows={d.byFranchise} />
            <Breakdown title="By hook style" rows={d.byHook} />
            <Breakdown title="By guest gender" rows={d.byGuestGender} note="unknown until set on People pages or coded by AI" />
            <Breakdown title="By guest" rows={d.byGuest} />
          </div>
          <Section title="Posts" note={`${d.posts.length}`}>
            <div className="card stack-sm">
              {d.posts.slice(0, 40).map((f) => (
                <PostRow key={f.contentId} fact={f} />
              ))}
            </div>
          </Section>
        </div>
        <aside className="stack">
          <Section title="Hierarchy">
            <div className="card stack-xs small">
              {d.parent ? (
                <Link href={`/topics/${d.parent.slug}`}>↑ {d.parent.name}</Link>
              ) : (
                <span className="muted">Top-level topic</span>
              )}
              {d.children.map((c) => (
                <Link key={c.slug} href={`/topics/${c.slug}`}>
                  ↳ {c.name}
                </Link>
              ))}
            </div>
          </Section>
          <Section title="Aliases">
            <div className="card row-tight">
              {d.aliases.map((a) => (
                <span key={a.alias} className="chip">
                  {a.alias}
                </span>
              ))}
            </div>
          </Section>
        </aside>
      </div>
    </>
  );
}

function Breakdown({ title, rows, note }: { title: string; rows: Array<{ value: string; n: number; medianScore: number | null }>; note?: string }) {
  return (
    <Section title={title} note={note}>
      <div className="card stack-xs">
        {rows.length ? (
          rows.map((r) => (
            <div key={r.value} className="spread small">
              <span>{r.value}</span>
              <span className="mono">
                <span className={r.medianScore && r.medianScore >= 1.15 ? 'up' : r.medianScore && r.medianScore <= 0.85 ? 'down' : ''}>{r.medianScore?.toFixed(2) ?? '—'}</span> <span className="muted xs">n={r.n}</span>
              </span>
            </div>
          ))
        ) : (
          <span className="xs muted">No data.</span>
        )}
      </div>
    </Section>
  );
}

import { Section, Stat } from '@/components/ui';
import { all, type Db } from '@/lib/db/client';
import type { ContentFact } from '@/lib/intel/dataset';
import { accountAttention, contentQuality, previousWeek, weekOf } from '@/lib/intel/quality';

const percent = (n: number | null) => n === null ? 'Unavailable' : `${(n * 100).toFixed(2)}%`;
const count = (n: number | null) => n === null ? 'Unavailable' : n.toLocaleString('en-US');
const date = (s: string) => s.slice(0, 10);
const scopes = { CORE_INTERVIEW_CONTENT: 'Interviews', BBO_STAMPED: 'BBO Stamped', OTHER_IGNORE: 'Other', UNCLASSIFIED: 'Unclassified' };
export function QualityMetrics({ db, facts, sp, threshold }: { db: Db; facts: ContentFact[]; sp: Record<string, string | undefined>; threshold: number }) {
  const scope = sp.scope && sp.scope in scopes ? sp.scope as keyof typeof scopes : 'CORE_INTERVIEW_CONTENT';
  const fallback = previousWeek(new Date().toISOString());
  const weeks = [...new Set([fallback, ...facts.map(f => weekOf(f.publishedAt))])].sort().reverse();
  const week = sp.week === 'all' || (sp.week && weeks.includes(sp.week)) ? sp.week : fallback;
  const scoped = facts.filter(f => (f.attrs.content_bucket || 'UNCLASSIFIED') === scope);
  const selected = week === 'all' ? scoped : scoped.filter(f => weekOf(f.publishedAt) === week);
  const q = contentQuality(selected, threshold);
  const a = accountAttention(db);
  const coverage = (n: number) => `${n} of ${q.posts} posts with paired inputs`;
  const fresh = all<{ first: string | null; last: string | null }>(db, `SELECT MIN(observed_at) AS first, MAX(observed_at) AS last FROM content_metric_latest WHERE platform_post_id IN (SELECT primary_post_id FROM content WHERE is_demo = 0)`)[0];
  const weekly = weeks.slice(0, 12).map(w => ({ week: w, ...contentQuality(scoped.filter(f => weekOf(f.publishedAt) === w), threshold) }));
  return <>
    <Section title="Attention · Instagram account" note="Account scope · separate from the post filters below">
      <div className="grid-4">
        <Stat label="Total reach · unique accounts" value={count(a.reach?.value ?? null)} sub={a.reach ? `${date(a.reach.period_start)} → ${date(a.reach.period_end)} · observed ${date(a.reach.observed_at)}` : 'No dated account-reach snapshot available'} />
        <Stat label="Followers" value={count(a.latest?.value ?? null)} sub={a.latest ? `Snapshot ${date(a.latest.period_end)}` : 'No follower-count snapshot'} />
        <Stat label="Follower growth · net" value={a.followerGrowth === null ? 'Unavailable' : `${a.followerGrowth >= 0 ? '+' : ''}${count(a.followerGrowth)}`} sub={a.latest && a.earliest ? `${date(a.earliest.period_end)} → ${date(a.latest.period_end)} · count difference, not gross new follows` : 'Needs two follower-count snapshots'} />
        <Stat label="Returning viewers" value="Unavailable" sub="Not supplied by the current data source" />
      </div>
    </Section>
    <Section title="Weekly attention & content quality" id="quality" note={`${scopes[scope]} · ${q.posts} posts`}>
      <form action="/performance#quality" className="row" style={{ flexWrap: 'wrap', marginBottom: '1rem' }}>
        <label className="small">Content <select className="input" name="scope" defaultValue={scope}>{Object.entries(scopes).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="small">Published week <select className="input" name="week" defaultValue={week}><option value="all">All stored posts</option>{weeks.map(w => <option key={w} value={w}>Week of {w}</option>)}</select></label>
        <button className="btn" type="submit">Apply</button>
      </form>
      <p className="small muted">Monday–Sunday in New York. These are lifetime results for posts published in the selected week, not activity earned during that week. Stored post snapshots span {fresh?.first ? date(fresh.first) : '—'} to {fresh?.last ? date(fresh.last) : '—'}. Missing inputs stay unavailable.</p>
      <div className="grid-4" style={{ marginTop: '1rem' }}>
        <Stat label="Total video views" value={count(q.videoViews)} sub={`${q.viewed} of ${q.videos} videos with views · includes repeat views`} />
        <Stat label="Average watch time" value={q.averageWatchSeconds === null ? 'Unavailable' : `${q.averageWatchSeconds.toFixed(2)}s`} sub={`Mean of ${q.watched} available video averages · equal weight per video`} />
        <Stat label="Completion rate" value="Unavailable" sub="Full-video completions are not supplied. Average watch ÷ duration is retention, not completion." />
        <Stat label="Hit rate" value={percent(q.hitRate)} sub={`${q.hits} / ${q.scored} mature scored posts · score ≥ ${threshold} (Winner or Breakout)`} />
        <Stat label="Share rate" value={percent(q.share.value)} sub={`Σ shares ÷ Σ reach · ${coverage(q.share.n)}`} />
        <Stat label="Save rate" value={percent(q.save.value)} sub={`Σ saves ÷ Σ reach · ${coverage(q.save.n)}`} />
        <Stat label="Comment rate" value={percent(q.comment.value)} sub={`Σ comments ÷ Σ reach · ${coverage(q.comment.n)}`} />
        <Stat label="Follower conversion · profile visits" value={percent(q.conversionProfile.value)} sub={`Attributed follows ÷ profile visits · ${coverage(q.conversionProfile.n)}`} />
        <Stat label="Follower conversion · reach" value={percent(q.conversionReach.value)} sub={`Attributed follows ÷ reach · ${coverage(q.conversionReach.n)}`} />
      </div>
      <p className="xs muted" style={{ marginTop: '.75rem' }}>Rates use the same eligible posts in numerator and denominator. Summed post reach is not unique account reach. Conversion denominators stay separate; net follower change is never substituted for new follows. Guest labels are not required.</p>
      <details className="disclose card" style={{ marginTop: '1rem' }}><summary>Last 12 publication weeks · {scopes[scope]}</summary>
        <div className="table-wrap"><table className="data"><thead><tr><th>Week</th><th>Posts</th><th>Share rate</th><th>Save rate</th><th>Comment rate</th><th>Hit rate</th></tr></thead><tbody>{weekly.map(w => <tr key={w.week}><td>{w.week}</td><td>{w.posts}</td><td>{percent(w.share.value)} · n={w.share.n}</td><td>{percent(w.save.value)} · n={w.save.n}</td><td>{percent(w.comment.value)} · n={w.comment.n}</td><td>{percent(w.hitRate)} · {w.hits}/{w.scored}</td></tr>)}</tbody></table></div>
      </details>
    </Section>
  </>;
}

import { createScoreVersionAction } from '@/app/actions';
import { ScoreHistogram, TrendLine } from '@/components/charts';
import { JobButton, SubmitButton } from '@/components/client';
import { Notice } from '@/components/notice';
import { fmtDate, fmtX, PageHead, Section, Stat } from '@/components/ui';
import { all, getDb } from '@/lib/db/client';
import { comparable, loadFacts, type ContentFact } from '@/lib/intel/dataset';
import { median } from '@/lib/intel/stats';
import { activeScoreVersion, scoreVersions } from '@/lib/scoring/engine';
import { COMPONENT_LABELS, type ComponentKey } from '@/lib/scoring/formula';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Performance' };

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

export default async function Performance({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const db = getDb();
  const version = activeScoreVersion(db);
  const facts = comparable(loadFacts(db));
  const labels = all<{ label: string; n: number }>(db, 'SELECT label, COUNT(*) AS n FROM performance_scores WHERE score_version_id = ? GROUP BY label', version.id);
  const labelN = (l: string) => labels.find((x) => x.label === l)?.n ?? 0;

  const months = new Map<string, ContentFact[]>();
  for (const f of facts) months.set(monthKey(f.publishedAt), [...(months.get(monthKey(f.publishedAt)) ?? []), f]);
  const lastMonths = [...months.keys()].sort().slice(-18);
  const trend = lastMonths.map((m) => ({ label: m.slice(2), value: median(months.get(m)!.map((f) => f.score as number)), n: months.get(m)!.length }));
  const shareTrend = lastMonths.map((m) => ({ label: m.slice(2), value: median(months.get(m)!.map((f) => f.rates.deep_action_rate).filter((v): v is number => typeof v === 'number')), n: months.get(m)!.length }));

  const byFranchise = new Map<string, ContentFact[]>();
  for (const f of facts) byFranchise.set(f.franchiseName ?? 'Unclassified', [...(byFranchise.get(f.franchiseName ?? 'Unclassified') ?? []), f]);
  const rel = (list: ContentFact[], k: 'share_rel' | 'comment_rel' | 'save_rel' | 'retention_rel') => median(list.map((f) => f.rates[k]).filter((v): v is number => typeof v === 'number'));

  const followers = all<{ period_end: string; value: number }>(
    db,
    `SELECT period_end, value FROM account_metrics a WHERE metric = 'net_follower_change' AND observed_at = (SELECT MAX(observed_at) FROM account_metrics b WHERE b.metric = a.metric AND b.period_end = a.period_end) ORDER BY period_end DESC LIMIT 30`
  ).reverse();
  const gender = all<{ breakdown_json: string; observed_at: string }>(db, `SELECT breakdown_json, observed_at FROM account_metrics WHERE metric = 'follower_demographics_gender' ORDER BY observed_at DESC LIMIT 1`)[0];
  const genderMix = gender ? (JSON.parse(gender.breakdown_json) as Record<string, number>) : null;
  const versions = scoreVersions(db);
  const tone = (v: number | null) => (v === null ? '' : v >= 1.15 ? 'up' : v <= 0.85 ? 'down' : '');

  return (
    <>
      <Notice searchParams={sp as Record<string, string>} />
      <PageHead
        kicker={`Performance · score ${version.version}`}
        title="Relative, not raw"
        lede={<>A score of <em>1.0 is what BBO normally gets</em> from comparable posts published around the same time. Views alone never decide it — shares, comments, saves and retention carry most of the weight.</>}
        actions={<JobButton kind="score" label="Recompute scores" className="btn" />}
      />

      <div className="grid-4">
        <Stat label="Scored posts" value={facts.length.toLocaleString()} />
        <Stat label="Breakout + winner" value={(labelN('BREAKOUT') + labelN('WINNER')).toLocaleString()} sub={`${Math.round(((labelN('BREAKOUT') + labelN('WINNER')) / Math.max(1, facts.length)) * 100)}% of scored`} tone="up" />
        <Stat label="Loser" value={labelN('LOSER').toLocaleString()} sub={`${Math.round((labelN('LOSER') / Math.max(1, facts.length)) * 100)}% of scored`} tone="down" />
        <Stat label="Median score" value={median(facts.map((f) => f.score as number))?.toFixed(2) ?? '—'} sub="all scored posts" />
      </div>

      <div className="grid-2 section">
        <Section title="Score distribution">
          <div className="card">
            <ScoreHistogram scores={facts.map((f) => f.score as number)} />
          </div>
        </Section>
        <Section title="Median score by month" note="dot size = posts">
          <div className="card">
            <TrendLine points={trend} />
          </div>
        </Section>
      </div>

      <div className="grid-2 section">
        <Section title="Deep action rate by month" note="(shares+saves+comments) ÷ reach · raw">
          <div className="card">
            <TrendLine points={shareTrend} baseline={null} format={(v) => `${(v * 100).toFixed(2)}%`} />
          </div>
        </Section>
        <Section title="Net follower change" note={`account-level · last ${followers.length} days`}>
          <div className="card stack-sm">
            <TrendLine points={followers.map((f) => ({ label: f.period_end.slice(5, 10), value: f.value, n: 1 }))} baseline={0} format={(v) => `${v >= 0 ? '+' : ''}${Math.round(v)}`} />
            <span className="xs muted">Instagram exposes net daily change only — no follows/unfollows split, and not per post.</span>
            {genderMix ? (
              <span className="xs muted">
                Follower gender (lifetime, {fmtDate(gender!.observed_at, true)}): {Object.entries(genderMix).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(' · ')}
              </span>
            ) : null}
          </div>
        </Section>
      </div>

      <Section title="By franchise" note="medians of peer ratios">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Franchise</th>
                <th className="num">Posts</th>
                <th className="num">Median score</th>
                <th className="num">Shares</th>
                <th className="num">Comments</th>
                <th className="num">Saves</th>
                <th className="num">Retention</th>
              </tr>
            </thead>
            <tbody>
              {[...byFranchise.entries()]
                .sort((a, b) => b[1].length - a[1].length)
                .map(([name, list]) => {
                  const ms = median(list.map((f) => f.score as number));
                  return (
                    <tr key={name}>
                      <td className="small white">{name}</td>
                      <td className="num">{list.length}</td>
                      <td className={`num ${tone(ms)}`}>{ms?.toFixed(2) ?? '—'}</td>
                      <td className={`num ${tone(rel(list, 'share_rel'))}`}>{fmtX(rel(list, 'share_rel'))}</td>
                      <td className={`num ${tone(rel(list, 'comment_rel'))}`}>{fmtX(rel(list, 'comment_rel'))}</td>
                      <td className={`num ${tone(rel(list, 'save_rel'))}`}>{fmtX(rel(list, 'save_rel'))}</td>
                      <td className={`num ${tone(rel(list, 'retention_rel'))}`}>{fmtX(rel(list, 'retention_rel'))}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <p className="xs muted" style={{ marginTop: '.5rem' }}>
          Franchise comes from caption signals and AI coding; “Unclassified” shrinks as media is analysed.
        </p>
      </Section>

      <div className="split section">
        <Section title={`How score ${version.version} is built`}>
          <div className="card stack-sm">
            <p className="small">
              Weighted geometric mean of each post&apos;s ratio to its peer-group median (same platform and format; trailing {version.formula.baseline.trailingDays} days, widening if fewer than {version.formula.baseline.minPeers} peers). Ratios are capped at {version.formula.ratioFloor}–{version.formula.ratioCap}x. Posts under {version.formula.maturityHours}h are not classified. A post needs {Math.round(version.formula.minCoverage * 100)}% of the weighted components to be scored.
            </p>
            {(Object.entries(version.formula.weights) as Array<[ComponentKey, number]>).map(([k, w]) => (
              <div key={k} className="stack-xs">
                <div className="spread xs">
                  <span>{COMPONENT_LABELS[k]}</span>
                  <span className="mono">{Math.round(w * 100)}%</span>
                </div>
                <div className="bar">
                  <span style={{ width: `${w * 100 * 3}%` }} />
                </div>
              </div>
            ))}
            <div className="xs muted">
              Labels: BREAKOUT ≥ {version.thresholds.BREAKOUT} · WINNER ≥ {version.thresholds.WINNER} · ABOVE ≥ {version.thresholds.ABOVE_AVERAGE} · AVERAGE &gt; {version.thresholds.AVERAGE_FLOOR} · LOSER ≤ {version.thresholds.LOSER_CEILING}
            </div>
            {version.notes ? <div className="xs gold">{version.notes}</div> : null}
          </div>
        </Section>
        <Section title="Versions">
          <div className="stack-sm">
            {versions.map((v) => (
              <div key={v.id} className="card stack-xs">
                <div className="spread">
                  <span className="mono white">{v.version}</span>
                  <span className={`chip ${v.is_active ? 'chip-green' : 'chip-muted'}`}>{v.is_active ? 'active' : 'inactive'}</span>
                </div>
                <span className="xs muted">{fmtDate(v.created_at, true)}</span>
              </div>
            ))}
            <details className="disclose card">
              <summary>Create a new score version</summary>
              <form action={createScoreVersionAction} className="stack-sm" style={{ marginTop: '.6rem' }}>
                <input className="input" name="version" placeholder="v2" required />
                <textarea className="textarea mono xs" name="formula" defaultValue={JSON.stringify(version.formula, null, 2)} style={{ minHeight: '12rem' }} />
                <textarea className="textarea mono xs" name="thresholds" defaultValue={JSON.stringify(version.thresholds, null, 2)} style={{ minHeight: '7rem' }} />
                <input className="input" name="notes" placeholder="Why this version exists" required />
                <label className="row-tight small">
                  <input type="checkbox" name="activate" /> Activate and rescore now
                </label>
                <SubmitButton className="btn btn-primary">Save version</SubmitButton>
                <span className="xs muted">Formulas are never edited in place. Scores for every version stay reproducible.</span>
              </form>
            </details>
          </div>
        </Section>
      </div>
    </>
  );
}

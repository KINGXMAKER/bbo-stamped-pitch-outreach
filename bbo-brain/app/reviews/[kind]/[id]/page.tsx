import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fmtPct, PageHead, Section } from '@/components/ui';
import { get, getDb, parseJson } from '@/lib/db/client';
import type { PostRef, ReviewEvidence } from '@/lib/intel/reviews';

export const dynamic = 'force-dynamic';

const WEEKLY: Array<[string, string]> = [
  ['what_worked', 'What worked'],
  ['what_failed', 'What failed'],
  ['what_changed', 'What changed'],
  ['new_pattern', 'New pattern'],
  ['early_signal', 'Early signal'],
  ['strongest_lesson', 'Strongest lesson'],
  ['experiment_for_this_week', 'Experiment for this week'],
  ['rule_change_proposed', 'Rule change proposed'],
  ['what_to_make_next', 'What BBO should make next'],
  ['topics_to_revisit', 'Topics to revisit'],
  ['topics_to_pause', 'Topics to pause'],
  ['guests_to_revisit', 'Guests to revisit'],
];

const MONTHLY: Array<[string, string]> = [
  ['what_bbo_learned', 'What BBO learned this month'],
  ['strongest_content', 'Strongest content'],
  ['weakest_content', 'Weakest content'],
  ['biggest_changes', 'Biggest performance changes'],
  ['emerging_topic', 'Strongest emerging topic'],
  ['declining_topic', 'Declining topic'],
  ['best_hook_type', 'Best hook type'],
  ['weak_hook_type', 'Weak hook type'],
  ['guest_insights', 'Guest insights'],
  ['duration_insights', 'Duration insights'],
  ['editing_insights', 'Editing insights'],
  ['caption_insights', 'Caption insights'],
  ['platform_differences', 'Platform differences'],
  ['rules_added', 'Rules added'],
  ['rules_challenged', 'Rules challenged'],
  ['experiments_completed', 'Experiments completed'],
  ['experiments_running', 'Experiments still running'],
  ['next_moves', 'Recommended next moves'],
];

const METRICS: Array<[keyof ReviewEvidence['medians']['current'], string, boolean]> = [
  ['performance_score', 'Median score', false],
  ['reach', 'Median reach', false],
  ['share_rate', 'Share rate', true],
  ['comment_rate', 'Comment rate', true],
  ['save_rate', 'Save rate', true],
  ['retention', 'Retention', false],
  ['deep_action_rate', 'Deep action rate', true],
];

export default async function ReviewDetail({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (kind !== 'weekly' && kind !== 'monthly') notFound();
  const table = kind === 'weekly' ? 'weekly_reviews' : 'monthly_reviews';
  const db = getDb();
  const row = get<{ id: number; period_start: string; period_end: string; evidence_json: string; narrative_json: string; ai_run_id: number | null; created_at: string }>(db, `SELECT * FROM ${table} WHERE id = ?`, Number(id));
  if (!row) notFound();
  const previous = get<{ id: number; period_start: string }>(db, `SELECT id, period_start FROM ${table} WHERE period_end < ? ORDER BY period_end DESC LIMIT 1`, row.period_start);
  const n = parseJson<Record<string, string>>(row.narrative_json, {});
  const e = parseJson<ReviewEvidence>(row.evidence_json, null as never);
  const sections = kind === 'weekly' ? WEEKLY : MONTHLY;
  const fmt = (v: number | null | undefined, pct: boolean) => (typeof v !== 'number' ? '—' : pct ? fmtPct(v) : v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(2));

  return (
    <>
      <PageHead
        kicker={`${kind} review · ${row.period_start} → ${row.period_end}`}
        title={kind === 'weekly' ? 'Weekly review' : 'Monthly intelligence'}
        lede={n.what_worked ?? n.what_bbo_learned}
        actions={
          <>
            <span className={`chip ${n.source === 'ai' ? 'chip-gold' : 'chip-muted'}`}>{n.source === 'ai' ? 'AI-written from evidence' : 'calculated'}</span>
            {row.ai_run_id ? (
              <Link href={`/runs/${row.ai_run_id}`} className="btn btn-sm">
                AI run
              </Link>
            ) : null}
            {previous ? (
              <Link href={`/reviews/${kind}/${previous.id}`} className="btn btn-sm">
                ← Previous {kind === 'weekly' ? 'week' : 'month'}
              </Link>
            ) : null}
          </>
        }
      />
      {n.aiError ? <div className="callout callout-amber xs" style={{ marginBottom: '1rem' }}>AI narrative unavailable ({n.aiError}) — sections below are calculated directly from the evidence.</div> : null}

      <div className="split">
        <div className="stack">
          {sections.map(([key, label], i) =>
            n[key] ? (
              <section key={key} className={`card stack-xs rise ${i < 3 ? 'card-hero' : ''}`} aria-label={label}>
                <div className="kicker">{label}</div>
                <div className={i < 3 ? 'serif white' : 'small'} style={i < 3 ? { fontSize: '1.2rem', lineHeight: 1.35 } : undefined}>
                  {n[key]}
                </div>
              </section>
            ) : null
          )}
        </div>

        {e ? (
          <aside className="stack">
            <Section title="This period vs last" note={`${e.counts.mature} vs ${e.counts.previousMature} mature posts`}>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th className="num">Now</th>
                      <th className="num">Before</th>
                      <th className="num">All-time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {METRICS.map(([k, label, pct]) => {
                      const now = e.medians.current[k];
                      const before = e.medians.previous[k];
                      const tone = typeof now === 'number' && typeof before === 'number' ? (now > before * 1.05 ? 'up' : now < before * 0.95 ? 'down' : '') : '';
                      return (
                        <tr key={k}>
                          <td className="small">{label}</td>
                          <td className={`num ${tone}`}>{fmt(now, pct)}</td>
                          <td className="num">{fmt(before, pct)}</td>
                          <td className="num muted">{fmt(e.medians.history[k], pct)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {e.counts.immature ? <p className="xs muted">{e.counts.immature} posts under 48h are excluded from rankings.</p> : null}
            </Section>
            <RefList title="Top 3 · shares" refs={e.top.shares} />
            <RefList title="Top 3 · retention" refs={e.top.retention} pct />
            <RefList title="Top 3 · comments" refs={e.top.comments} />
            <RefList title="Top 3 · performance score" refs={e.top.score} />
            <RefList title="Bottom 3 · retention" refs={e.bottom.retention} pct tone="down" />
            <RefList title="Bottom 3 · performance score" refs={e.bottom.score} tone="down" />
            {e.differences.length ? (
              <Section title="Winners vs losers" note="top third vs bottom third">
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Dimension</th>
                        <th className="num">Winners</th>
                        <th className="num">Losers</th>
                      </tr>
                    </thead>
                    <tbody>
                      {e.differences.map((d, i) => (
                        <tr key={i}>
                          <td className="small">
                            {d.dimension}: <span className="white">{d.value}</span>
                          </td>
                          <td className="num up">{d.winners}</td>
                          <td className="num down">{d.losers}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="xs muted">Counts within one period — a prompt for attention, not a pattern.</p>
              </Section>
            ) : null}
          </aside>
        ) : null}
      </div>
    </>
  );
}

function RefList({ title, refs, pct, tone }: { title: string; refs: PostRef[]; pct?: boolean; tone?: 'down' }) {
  if (!refs.length) return null;
  return (
    <Section title={title}>
      <div className="card stack-xs">
        {refs.map((r) => (
          <Link key={r.contentId} href={`/content/${r.contentId}`} className="spread small">
            <span className="clamp-2" style={{ flex: 1 }}>
              {r.title}
            </span>
            <span className={`mono ${tone ?? 'up'}`}>{typeof r.value === 'number' ? (pct ? `${Math.round(r.value * 100)}%` : r.value >= 100 ? Math.round(r.value).toLocaleString() : r.value.toFixed(2)) : '—'}</span>
          </Link>
        ))}
      </div>
    </Section>
  );
}

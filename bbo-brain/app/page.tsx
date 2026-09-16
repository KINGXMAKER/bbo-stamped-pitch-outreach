import Link from 'next/link';
import { JobButton } from '@/components/client';
import { Notice } from '@/components/notice';
import { Confidence, Empty, fmtDate, PageHead, PostRow, Section, Stat, StatusChip } from '@/components/ui';
import { getDb, parseJson } from '@/lib/db/client';
import { comparable, loadFacts } from '@/lib/intel/dataset';
import { commandCenter } from '@/lib/intel/queries';
import { performanceContext } from '@/lib/scoring/context';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Command Center' };

export default async function CommandCenter({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const db = getDb();
  const c = commandCenter(db);
  const mature = comparable(loadFacts(db));
  const top = c.opportunities[0];
  const weekly = c.weekly ? parseJson<Record<string, string>>(c.weekly.narrative_json, {}) : null;

  const headline: string[] = [];
  if (c.proposals.length) headline.push(`${c.proposals.length} rule proposal${c.proposals.length > 1 ? 's' : ''} waiting on you`);
  if (c.challenges.length) headline.push(`${c.challenges.length} rule${c.challenges.length > 1 ? 's' : ''} challenged by new data`);
  if (c.breakouts.length) headline.push(`${c.breakouts.length} winner${c.breakouts.length > 1 ? 's' : ''} in the last 30 days`);
  if (c.losers.length) headline.push(`${c.losers.length} unexpected loser${c.losers.length > 1 ? 's' : ''}`);

  if (!c.totals.content) {
    return (
      <>
        <PageHead kicker="Command Center" title="Nothing in memory yet" lede="BBO BRAIN learns from what BBO has already posted. Start by pulling the history in." />
        <div className="card card-pink card-hero stack">
          <p className="serif" style={{ fontSize: '1.25rem', color: 'var(--white)' }}>Run the backfill: audit archive, real Instagram history, metrics and scoring.</p>
          <div className="row">
            <JobButton kind="import-archive" label="1 · Import audit archive" className="btn" />
            <JobButton kind="instagram-content" label="2 · Sync Instagram content" className="btn" />
            <JobButton kind="instagram-metrics" params={{ all: true }} label="3 · Pull all metrics" className="btn" />
            <JobButton kind="score" label="4 · Score" className="btn btn-primary" />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Notice searchParams={sp} />
      <PageHead
        kicker={`Command Center · ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`}
        title="What needs your attention"
        lede={headline.length ? <>{headline.join(' · ')}.</> : <>Nothing is waiting on a decision. The loop is running.</>}
        actions={<JobButton kind="daily" label="Run daily loop" className="btn btn-primary" note="Sync → score → analyse → learn → propose → challenge → opportunities" />}
      />

      <div className="grid-4 rise rise-2">
        <Stat label="Posts in memory" value={c.totals.content.toLocaleString()} sub={`${fmtDate(c.totals.firstPost, true)} → ${fmtDate(c.totals.lastPost, true)}`} />
        <Stat label="Scored vs peers" value={c.totals.scored.toLocaleString()} sub="mature posts with a baseline" />
        <Stat label="Lessons" value={c.totals.lessons} sub="first-class, evidence-tracked" />
        <Stat label="Active rules" value={c.totals.activeRules} sub="loaded into AI workflows" tone="pink" />
      </div>

      <div className="split section">
        <div className="stack">
          {top ? (
            <Link href="/next" className="card card-pink card-hero card-link stack-sm">
              <div className="kicker">What BBO should make next</div>
              <div className="display" style={{ fontSize: 'clamp(1.9rem, 1.3rem + 2vw, 3rem)' }}>
                {top.title}
              </div>
              <p className="serif" style={{ fontSize: '1.15rem', color: 'var(--text)' }}>
                {top.why}
              </p>
              <div className="row">
                <Confidence label={top.confidence_label} />
                <span className="xs muted">n = {top.sample_size}</span>
                {top.recommendation.format ? <span className="chip">{top.recommendation.format}</span> : null}
                {top.recommendation.hookStyle ? <span className="chip">hook: {top.recommendation.hookStyle}</span> : null}
                {top.recommendation.lengthRange ? <span className="chip">{top.recommendation.lengthRange}</span> : null}
              </div>
            </Link>
          ) : (
            <div className="card stack-sm">
              <div className="kicker">What BBO should make next</div>
              <p className="muted small">No opportunity batch yet.</p>
              <JobButton kind="opportunities" label="Calculate opportunities" />
            </div>
          )}

          <Section title="Breakout content" note="last 30 days · mature posts">
            {c.breakouts.length ? (
              <div className="grid-2">
                {c.breakouts.map((f) => (
                  <div key={f.contentId} className="card card-green">
                    <PostRow fact={f} extra={<ContextLine lines={performanceContext(f, mature).slice(0, 2).map((l) => l.text)} />} />
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="No winners in the last 30 days">Winners are posts scoring ≥1.5x comparable BBO posts.</Empty>
            )}
          </Section>

          <Section title="Unexpected losers" note="≤0.5x comparable posts">
            {c.losers.length ? (
              <div className="grid-2">
                {c.losers.map((f) => (
                  <div key={f.contentId} className="card card-red">
                    <PostRow fact={f} extra={<ContextLine lines={performanceContext(f, mature).slice(0, 2).map((l) => l.text)} />} />
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="No losers in the last 30 days" />
            )}
          </Section>

          <Section title="Recent performance" note={<Link href="/content">library →</Link>}>
            <div className="card stack-sm">
              {c.recent.map((f) => (
                <PostRow key={f.contentId} fact={f} />
              ))}
            </div>
          </Section>
        </div>

        <aside className="stack">
          <Section title="Rule proposals" note={<Link href="/proposals">review →</Link>}>
            {c.proposals.length ? (
              <div className="stack-sm">
                {c.proposals.map((p) => (
                  <Link key={p.id} href={`/proposals#p${p.id}`} className="card card-link card-gold stack-xs">
                    <div className="kicker kicker-gold">Waiting for approval</div>
                    <div className="small white">{p.proposed_text}</div>
                    <div className="row">
                      <Confidence label={p.confidence_label} />
                      <span className="xs muted">n = {p.sample_size ?? '?'}</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty title="None waiting">Proposals appear when a lesson is supported across repeated evaluations.</Empty>
            )}
          </Section>

          <Section title="Rules challenged" note={<Link href="/rules">rules →</Link>}>
            {c.challenges.length ? (
              <div className="stack-sm">
                {c.challenges.map((ch) => (
                  <Link key={ch.id} href={`/rules#c${ch.id}`} className="card card-link stack-xs" style={{ borderColor: 'rgba(255,181,71,.35)' }}>
                    <div className="row">
                      <span className="chip chip-amber">{ch.code}</span>
                      <Confidence label={ch.confidence_label} />
                    </div>
                    <div className="small">{ch.summary}</div>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty title="No open challenges" />
            )}
          </Section>

          <Section title="New lessons" note={<Link href="/lessons">all →</Link>}>
            {c.newLessons.length ? (
              <div className="card stack-sm">
                {c.newLessons.map((l, i) => (
                  <Link key={`${l.id}-${i}`} href={`/lessons/${l.id}`} className="stack-xs">
                    <div className="row-tight">
                      <span className="mono xs muted">{l.code}</span>
                      <StatusChip status={l.to_status} />
                      <Confidence label={l.to_confidence} />
                    </div>
                    <div className="small clamp-2">{l.text}</div>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty title="No lesson movement in 14 days" />
            )}
          </Section>

          <Section title="Experiments" note={<Link href="/experiments">all →</Link>}>
            {c.experiments.length ? (
              <div className="card stack-sm">
                {c.experiments.map((e) => (
                  <Link key={e.id} href={`/experiments/${e.id}`} className="stack-xs">
                    <div className="row-tight">
                      <span className="mono xs muted">{e.code}</span>
                      <StatusChip status={e.status} />
                    </div>
                    <div className="small clamp-2">{e.name}</div>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty title="No experiments" />
            )}
          </Section>

          <Section title="AI analysis queue">
            <div className="card stack-sm">
              <div className="spread">
                <Stat label="Ready" value={c.analysisQueue.readyCount} />
                <Stat label="Need media" value={c.analysisQueue.waitingCount} />
                <Stat label="Analysed" value={c.analysisQueue.analysed} />
              </div>
              <div className="row">
                <JobButton kind="analyze" label="Analyse winners & losers" className="btn btn-sm btn-gold" />
                <JobButton kind="media-transcripts" label="Fetch media + transcripts" />
              </div>
            </div>
          </Section>

          {c.gatekeeperFailures.length ? (
            <Section title="Gatekeeper failures" note={<Link href="/edit-lab">edit lab →</Link>}>
              <div className="card stack-sm">
                {c.gatekeeperFailures.map((g) => (
                  <Link key={g.id} href={`/edit-lab/${g.id}`} className="spread small">
                    <span>{g.title}</span>
                    <span className="mono down">{g.final_total ?? '—'}/60</span>
                  </Link>
                ))}
              </div>
            </Section>
          ) : null}

          {weekly ? (
            <Section title="Weekly review" note={<Link href={`/reviews/weekly/${c.weekly!.id}`}>open →</Link>}>
              <div className="card stack-sm">
                <div className="kicker kicker-muted">
                  {c.weekly!.period_start} → {c.weekly!.period_end}
                </div>
                <div className="sowhat sowhat-gold">
                  <div className="serif white" style={{ fontSize: '1.05rem' }}>
                    {weekly.strongest_lesson}
                  </div>
                </div>
                <div className="small muted clamp-3">{weekly.what_to_make_next}</div>
              </div>
            </Section>
          ) : null}

          <Section title="System">
            <div className="card stack-xs xs">
              {c.entityReviews ? (
                <Link href="/settings/entities" className="spread">
                  <span>Entity matches to review</span>
                  <span className="nav-count">{c.entityReviews}</span>
                </Link>
              ) : null}
              {c.syncHealth.slice(0, 8).map((j) => (
                <div key={j.kind} className="spread">
                  <span className="mono">{j.kind}</span>
                  <span className="row-tight">
                    <StatusChip status={j.status} />
                    <span className="muted">{j.finished_at ? fmtDate(j.finished_at) : ''}</span>
                  </span>
                </div>
              ))}
            </div>
          </Section>
        </aside>
      </div>
    </>
  );
}

function ContextLine({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return <div className="xs gold">{lines.join(' · ')}</div>;
}

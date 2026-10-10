import Link from 'next/link';
import { notFound } from 'next/navigation';
import { analyzeContentAction, assignContentAction, setAttributeAction } from '@/app/actions';
import { MetricCurve } from '@/components/charts';
import { JobButton, SubmitButton } from '@/components/client';
import { Notice } from '@/components/notice';
import { Confidence, DemoFlag, Empty, fmtDate, fmtNum, fmtPct, fmtX, PageHead, PostRow, RatioBar, ScoreBadge, Section, SourceChip, StatusChip } from '@/components/ui';
import { all, getDb } from '@/lib/db/client';
import { contentDetail } from '@/lib/intel/queries';
import { formatTranscript } from '@/lib/intel/analysis';
import { COMPONENT_LABELS } from '@/lib/scoring/formula';
import { ATTRIBUTE_DEFINITIONS } from '@/lib/seed/reference';

export const dynamic = 'force-dynamic';

const ts = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const toSeconds = (t: string | null | undefined) => {
  const m = t?.match(/(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export default async function ContentDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const db = getDb();
  const d = contentDetail(db, Number(id));
  if (!d) notFound();
  const { fact } = d;
  const analysis = d.analyses[0];
  const hotTimes = new Set([analysis?.strongestMoment?.timestamp, analysis?.strongestOpening?.timestamp, analysis?.strongestStandalone?.timestamp].map(toSeconds).filter((v): v is number => v !== null));
  const reachSeries = d.history.filter((h) => h.metric === 'reach').map((h) => ({ at: h.observed_at, value: h.value }));
  const experiments = all<{ id: number; code: string; name: string }>(db, `SELECT id, code, name FROM experiments WHERE status IN ('proposed','running') ORDER BY id`);
  const editable = ATTRIBUTE_DEFINITIONS.filter((a) => (a.type === 'enum' || a.type === 'boolean') && a.group !== 'audit' && a.key !== 'format');
  const current = new Map(d.attributes.map((a) => [a.key, a]));

  return (
    <>
      <Notice searchParams={sp} />
      <PageHead
        kicker={`${fact.franchiseName ?? 'Unclassified'} · ${fact.platform} · ${fmtDate(fact.publishedAt, true)}`}
        title={fact.title.length > 70 ? `${fact.title.slice(0, 67)}…` : fact.title}
        lede={
          d.context.length ? (
            <>{d.context.map((c) => c.text).join(' · ')}.</>
          ) : fact.isMature ? (
            'No comparable baseline yet.'
          ) : (
            <>Under 48 hours old — metrics are still accruing, so it is not compared yet.</>
          )
        }
        actions={
          <>
            {fact.isDemo ? <DemoFlag /> : null}
            <ScoreBadge score={fact.score} label={fact.label} />
            {fact.url ? (
              <a href={fact.url} target="_blank" rel="noreferrer" className="btn btn-sm">
                Open on {fact.platform} ↗
              </a>
            ) : null}
          </>
        }
      />

      <div className="split">
        <div className="stack">
          <Section title="Media & content">
            <div className="card">
              <div className="row" style={{ alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ width: 170, flexShrink: 0 }}>
                  <div className="thumb">{fact.thumbPath ? <img src={`/api/media/${fact.contentId}`} alt="Opening frame" /> : <div className="thumb-mono">{fact.title.charAt(0)}</div>}</div>
                </div>
                <div className="stack-sm" style={{ flex: 1, minWidth: 0 }}>
                  <div className="kicker kicker-muted">Caption</div>
                  <p className="small" style={{ whiteSpace: 'pre-wrap' }}>
                    {fact.caption || <span className="muted">No caption.</span>}
                  </p>
                  <div className="row-tight">
                    {fact.format ? <span className="chip">{fact.format}</span> : null}
                    {fact.durationS ? <span className="chip">{Math.round(fact.durationS)}s</span> : null}
                    {fact.topics.map((t) => (
                      <Link key={t.slug} href={`/topics/${t.slug}`} className="chip chip-pink">
                        {t.name}
                      </Link>
                    ))}
                    {fact.people.map((p) => (
                      <Link key={`${p.id}${p.role}`} href={`/people/${p.id}`} className="chip">
                        {p.role}: {p.name}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Section>

          <Section title="Transcript" note={d.transcript ? `${d.transcript.model ?? ''} · speakers not identified` : undefined}>
            {d.transcript ? (
              <div className="card">
                <div className="transcript">
                  {d.transcript.segments.map((s, i) => (
                    <div key={i} className={`transcript-line ${[...hotTimes].some((t) => t >= s.start - 0.3 && t < s.end + 0.3) ? 'hot' : ''}`}>
                      <time>{ts(s.start)}</time>
                      <span>{s.text}</span>
                    </div>
                  ))}
                </div>
                <details className="disclose" style={{ marginTop: '.6rem' }}>
                  <summary>Copy-ready transcript for the Edit Lab</summary>
                  <pre className="xs muted" style={{ whiteSpace: 'pre-wrap', marginTop: '.5rem' }}>
                    {formatTranscript(JSON.stringify(d.transcript.segments))}
                  </pre>
                </details>
              </div>
            ) : (
              <Empty title="No transcript yet">
                <div className="stack-sm" style={{ justifyItems: 'center' }}>
                  <span>BBO rule R-003: analyse the real footage before deciding what a post is about.</span>
                  <JobButton kind="media-transcripts" params={{ contentId: fact.contentId, limit: 1 }} label="Fetch media + transcript" />
                </div>
              </Empty>
            )}
          </Section>

          <Section title="AI intelligence" note={analysis ? `${analysis.evidence_basis} · ${analysis.confidence} confidence · ${fmtDate(analysis.created_at as string)}` : undefined}>
            {analysis ? (
              <div className="stack">
                <div className={`card ${analysis.outcome === 'winner' ? 'card-green' : analysis.outcome === 'loser' ? 'card-red' : 'card-gold'} stack-sm`}>
                  <div className="row">
                    <span className="kicker kicker-gold">AI · {analysis.outcome === 'winner' ? 'Why it won' : analysis.outcome === 'loser' ? 'Why it lost' : 'Why it behaved this way'}</span>
                    {analysis.triggers.map((t) => (
                      <span key={t} className="chip chip-muted">
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="sowhat sowhat-gold">
                    <div className="sowhat-text">{analysis.outcome_explanation as string}</div>
                  </div>
                </div>
                <div className="grid-2">
                  <Field label="Actual topic" value={analysis.actual_topic as string} />
                  <Field label="Underlying debate" value={analysis.underlying_debate as string} />
                  <Field label="Hook mechanics" value={analysis.hook_mechanics as string} />
                  <Field label="Emotional trigger" value={analysis.emotional_trigger as string} />
                  <Field label="Tension" value={analysis.tension as string} />
                  <Field label="Payoff" value={analysis.payoff as string} />
                  <Field label="Comment trigger" value={analysis.comment_trigger as string} />
                  <Field label="Share trigger" value={analysis.share_trigger as string} />
                  <Field label="Curiosity trigger" value={analysis.curiosity_trigger as string} />
                  <Field label="Dead setup / unnecessary context" value={analysis.dead_setup as string} />
                  <Field label="Reaction timing" value={analysis.reaction_timing as string} />
                  <Field label="Speaker dynamics" value={analysis.speaker_dynamics as string} />
                </div>
                <div className="grid-3">
                  <Moment label="Strongest moment" m={analysis.strongestMoment} />
                  <Moment label={`Strongest opening${analysis.strongestOpening?.is_current_opening === false ? ' (not the current one)' : ''}`} m={analysis.strongestOpening} />
                  <Moment label="Strongest standalone" m={analysis.strongestStandalone} />
                </div>
                <div className="grid-3">
                  <ListCard title="Retention strengths" items={analysis.retentionStrengths} tone="up" />
                  <ListCard title="Retention weaknesses" items={analysis.retentionWeaknesses} tone="down" />
                  <ListCard title="Editing opportunities" items={analysis.editingOpportunities} tone="gold" />
                </div>
                <Link href={`/runs?content=${fact.contentId}`} className="xs muted">
                  View the AI run (model, prompt, skill and rule versions) →
                </Link>
              </div>
            ) : (
              <div className="card stack-sm">
                <p className="small muted">
                  {fact.label && ['BREAKOUT', 'WINNER', 'LOSER'].includes(fact.label)
                    ? 'This post crossed an analysis trigger and has not been analysed yet.'
                    : 'Average posts are not deep-analysed by default — they stay comparison data. You can still analyse it.'}
                </p>
                {d.transcript || fact.thumbPath ? (
                  <form action={analyzeContentAction}>
                    <input type="hidden" name="contentId" value={fact.contentId} />
                    <SubmitButton className="btn btn-gold" pendingText="Analysing (30–90s)…">
                      Run AI analysis
                    </SubmitButton>
                  </form>
                ) : (
                  <span className="xs warn">Needs a transcript or frames first.</span>
                )}
              </div>
            )}
          </Section>

          <Section title="What to do with this">
            <div className="grid-3">
              <ListCard title="Repeat" items={[...(analysis?.retentionStrengths ?? []).slice(0, 2), ...d.lessons.filter((l) => l.relation === 'supporting').slice(0, 2).map((l) => `${l.code}: ${l.text}`)]} tone="up" empty="Nothing proven to repeat yet." />
              <ListCard title="Don't repeat" items={[...(analysis?.retentionWeaknesses ?? []).slice(0, 2), ...d.violations.map((v) => `Broke ${v.code}: ${v.text}`)]} tone="down" empty="No weaknesses recorded." />
              <ListCard title="Test next" items={[analysis?.experiment?.hypothesis, analysis?.reusable_lesson as string | undefined].filter((x): x is string => Boolean(x))} tone="gold" empty="No test suggested yet." />
            </div>
          </Section>

          <Section title="Similar content" note="shared franchise, guests, topics, hook, length, wording">
            <div className="grid-2">
              <div className="card stack-sm">
                <div className="kicker" style={{ color: 'var(--green)' }}>
                  Similar winners
                </div>
                {d.similar.winners.length ? d.similar.winners.map((s) => <PostRow key={s.fact.contentId} fact={s.fact} extra={<span className="xs muted">{s.shared.slice(0, 3).join(' · ')}</span>} />) : <span className="small muted">None found.</span>}
              </div>
              <div className="card stack-sm">
                <div className="kicker" style={{ color: 'var(--red)' }}>
                  Similar losers
                </div>
                {d.similar.losers.length ? d.similar.losers.map((s) => <PostRow key={s.fact.contentId} fact={s.fact} extra={<span className="xs muted">{s.shared.slice(0, 3).join(' · ')}</span>} />) : <span className="small muted">None found.</span>}
              </div>
            </div>
          </Section>
        </div>

        <aside className="stack">
          <Section title="Performance" note={`score ${d.scoreVersion}`}>
            <div className="card stack-sm">
              <div className="grid-2">
                <div className="stack-xs">
                  <span className="stat-label">Views</span>
                  <span className="mono white">{fmtNum(fact.raw.views)}</span>
                </div>
                <div className="stack-xs">
                  <span className="stat-label">Reach</span>
                  <span className="mono white">{fmtNum(fact.raw.reach)}</span>
                </div>
                <div className="stack-xs">
                  <span className="stat-label">Shares · saves</span>
                  <span className="mono white">
                    {fmtNum(fact.raw.shares)} · {fmtNum(fact.raw.saves)}
                  </span>
                </div>
                <div className="stack-xs">
                  <span className="stat-label">Comments · likes</span>
                  <span className="mono white">
                    {fmtNum(fact.raw.comments)} · {fmtNum(fact.raw.likes)}
                  </span>
                </div>
                <div className="stack-xs">
                  <span className="stat-label">Avg watch</span>
                  <span className="mono white">{fact.raw.avg_watch_time_ms ? `${(fact.raw.avg_watch_time_ms / 1000).toFixed(1)}s` : '—'}</span>
                </div>
                <div className="stack-xs">
                  <span className="stat-label">Deep action rate</span>
                  <span className="mono white">{fmtPct(fact.rates.deep_action_rate)}</span>
                </div>
              </div>
              <div className="divider" />
              <div className="kicker kicker-muted">vs peer median · {fact.baselineGroup ?? 'no baseline'}</div>
              {fact.components.length ? (
                fact.components.map((c) => (
                  <div key={c.key} className="stack-xs">
                    <div className="spread xs">
                      <span>{COMPONENT_LABELS[c.key]}</span>
                      <span className={`mono ${c.ratio >= 1.15 ? 'up' : c.ratio <= 0.85 ? 'down' : ''}`}>{fmtX(c.ratio)}</span>
                    </div>
                    <RatioBar ratio={c.ratio} />
                  </div>
                ))
              ) : (
                <span className="xs muted">No component ratios.</span>
              )}
              <div className="divider" />
              <div className="kicker kicker-muted">Reach over time · {reachSeries.length} snapshots</div>
              <MetricCurve series={reachSeries} />
              <span className="xs muted">Follows and profile visits are not exposed per Reel by Instagram.</span>
            </div>
          </Section>

          <Section title="Learning">
            <div className="card stack-sm">
              <div className="kicker kicker-muted">Lessons this post is evidence for</div>
              {d.lessons.length ? (
                d.lessons.map((l) => (
                  <Link key={`${l.id}${l.relation}`} href={`/lessons/${l.id}`} className="stack-xs">
                    <span className="row-tight">
                      <span className="mono xs muted">{l.code}</span>
                      <span className={`chip ${l.relation === 'contradicting' ? 'chip-red' : l.relation === 'supporting' ? 'chip-green' : 'chip-gold'}`}>{l.relation}</span>
                      <Confidence label={l.confidence_label} />
                    </span>
                    <span className="small clamp-2">{l.text}</span>
                  </Link>
                ))
              ) : (
                <span className="small muted">Not linked to any lesson yet.</span>
              )}
              <div className="divider" />
              <div className="kicker kicker-muted">Rule violations</div>
              {d.violations.length ? (
                d.violations.map((v) => (
                  <div key={v.code} className="small">
                    <span className="chip chip-red">{v.code}</span> {v.text}
                  </div>
                ))
              ) : (
                <span className="small muted">None detected against testable rules.</span>
              )}
              <details className="disclose">
                <summary>{d.rules.length} rules an editor would receive for this post</summary>
                <ul className="stack-xs xs" style={{ listStyle: 'none', marginTop: '.5rem' }}>
                  {d.rules.map((r) => (
                    <li key={r.code}>
                      <span className="mono muted">
                        {r.code} v{r.version}
                      </span>{' '}
                      {r.text}
                    </li>
                  ))}
                </ul>
              </details>
              <div className="divider" />
              <div className="kicker kicker-muted">Experiments</div>
              {d.experiments.map((e) => (
                <Link key={e.id} href={`/experiments/${e.id}`} className="row-tight small">
                  <span className="chip chip-pink">{e.code}</span> {e.arm} · <StatusChip status={e.status} />
                </Link>
              ))}
              {experiments.length ? (
                <form action={assignContentAction} className="row-tight">
                  <input type="hidden" name="contentId" value={fact.contentId} />
                  <input type="hidden" name="back" value={`/content/${fact.contentId}`} />
                  <select name="experimentId" className="select" style={{ flex: 2, minWidth: 0 }}>
                    {experiments.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.code} {e.name.slice(0, 40)}
                      </option>
                    ))}
                  </select>
                  <select name="arm" className="select" style={{ flex: 1, minWidth: 0 }}>
                    <option value="variant">variant</option>
                    <option value="control">control</option>
                  </select>
                  <SubmitButton className="btn btn-sm">Assign</SubmitButton>
                </form>
              ) : null}
            </div>
          </Section>

          <Section title="Attributes" note="human > measured > AI > audit > heuristic">
            <div className="card stack-xs">
              {editable.map((def) => {
                const cur = current.get(def.key);
                return (
                  <form key={def.key} action={setAttributeAction} className="spread xs" style={{ gap: '.4rem' }}>
                    <input type="hidden" name="contentId" value={fact.contentId} />
                    <input type="hidden" name="key" value={def.key} />
                    <span className="muted" style={{ flex: '1 1 7rem' }}>
                      {def.label}
                    </span>
                    <span className="row-tight" style={{ flex: '2 1 11rem', justifyContent: 'flex-end' }}>
                      {cur ? <SourceChip source={cur.source} /> : null}
                      <select name="value" defaultValue={cur?.value_text ?? ''} className="select" style={{ width: 'auto', minWidth: '8rem', padding: '.2rem 1.6rem .2rem .45rem', fontSize: 'var(--text-xs)' }}>
                        <option value="">—</option>
                        {(def.type === 'boolean' ? ['true', 'false'] : def.values ?? []).map((v) => (
                          <option key={v} value={v}>
                            {v.replace(/_/g, ' ')}
                          </option>
                        ))}
                      </select>
                      <SubmitButton className="btn btn-sm btn-ghost">Save</SubmitButton>
                    </span>
                  </form>
                );
              })}
              {d.attributes
                .filter((a) => !editable.some((e) => e.key === a.key))
                .map((a) => (
                  <div key={a.key} className="spread xs">
                    <span className="muted">{a.label}</span>
                    <span className="row-tight">
                      <SourceChip source={a.source} />
                      <span className="clamp-2" style={{ maxWidth: '14rem' }}>
                        {a.value_text}
                      </span>
                    </span>
                  </div>
                ))}
            </div>
          </Section>

          <Section title="Comments" note={`${d.commentTotal} stored`}>
            {d.comments.length ? (
              <div className="card stack-xs">
                {d.comments.map((c, i) => (
                  <p key={i} className="xs">
                    “{c.text}”
                  </p>
                ))}
              </div>
            ) : (
              <Empty title="No comment text">Comment text is only pulled for posts in the last 30 days, and Instagram sometimes limits it.</Empty>
            )}
          </Section>
        </aside>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="card stack-xs">
      <div className="kicker kicker-muted">{label}</div>
      <div className="small">{value}</div>
    </div>
  );
}

function Moment({ label, m }: { label: string; m: { timestamp: string | null; quote: string; why: string } | null }) {
  if (!m || !m.quote) return null;
  return (
    <div className="card card-gold stack-xs">
      <div className="kicker kicker-gold">
        {label}
        {m.timestamp ? ` · ${m.timestamp}` : ''}
      </div>
      <div className="serif white" style={{ fontSize: '1.1rem', lineHeight: 1.25 }}>
        “{m.quote}”
      </div>
      <div className="xs muted">{m.why}</div>
    </div>
  );
}

function ListCard({ title, items, tone, empty }: { title: string; items: string[]; tone: 'up' | 'down' | 'gold'; empty?: string }) {
  return (
    <div className="card stack-xs">
      <div className="kicker" style={{ color: tone === 'up' ? 'var(--green)' : tone === 'down' ? 'var(--red)' : 'var(--gold)' }}>
        {title}
      </div>
      {items.length ? (
        <ul className="stack-xs small" style={{ listStyle: 'none' }}>
          {items.map((it, i) => (
            <li key={i}>— {it}</li>
          ))}
        </ul>
      ) : (
        <span className="xs muted">{empty ?? 'None.'}</span>
      )}
    </div>
  );
}

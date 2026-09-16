import Link from 'next/link';
import { notFound } from 'next/navigation';
import { reviewCodingAction } from '@/app/actions';
import { SubmitButton } from '@/components/client';
import { Notice } from '@/components/notice';
import { Confidence, DemoFlag, Empty, fmtDate, PageHead, ScoreBadge, Section, SourceChip } from '@/components/ui';
import { all, get, getDb, parseJson } from '@/lib/db/client';
import { contentDetail } from '@/lib/intel/queries';
import { corpusClass } from '@/lib/sync/media-queue';
import { REVIEW_KEYS } from '@/lib/intel/validation';
import { ATTRIBUTE_DEFINITIONS } from '@/lib/seed/reference';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Review coding' };

const ts = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const GROUP_LABEL: Record<string, string> = { hook: 'Hook & opening', substance: 'Substance & triggers', edit: 'Edit & reaction', structure: 'Structure' };
/** Numbers and quotes the AI produced: context for the judgement, not fields to re-type. */
const EVIDENCE_KEYS = ['opening_line', 'time_to_understandable_s', 'time_to_tension_s', 'time_to_payoff_s', 'dead_setup_s', 'strongest_opening_quote', 'strongest_moment_quote', 'opening_is_strongest'];

export default async function ReviewCoding({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const db = getDb();
  const contentId = Number(id);
  const d = contentDetail(db, contentId);
  const row = get<{ frames_json: string | null; coded_at: string | null; coding_validation_status: string }>(db, 'SELECT frames_json, coded_at, coding_validation_status FROM content WHERE id = ?', contentId);
  if (!d || !row) notFound();
  const { fact } = d;
  const frames = parseJson<Array<{ atS: number; path: string }>>(row.frames_json, []);
  const current = new Map(d.attributes.map((a) => [a.key, a]));
  const aiValues = new Map(
    all<{ key: string; value_text: string; confidence: number | null }>(db, `SELECT key, value_text, confidence FROM content_attributes WHERE content_id = ? AND source = 'ai'`, contentId).map((a) => [a.key, a])
  );
  const priorReviews = all<{ status: string; note: string | null; changed_json: string; reviewed_at: string }>(db, 'SELECT status, note, changed_json, reviewed_at FROM coding_reviews WHERE content_id = ? ORDER BY id DESC', contentId);
  const editable = ATTRIBUTE_DEFINITIONS.filter((a) => REVIEW_KEYS.includes(a.key as (typeof REVIEW_KEYS)[number]) && (a.type === 'enum' || a.type === 'boolean'));
  const groups = [...new Set(editable.map((a) => a.group))];
  const evidence = EVIDENCE_KEYS.map((key) => ({ def: ATTRIBUTE_DEFINITIONS.find((d2) => d2.key === key)!, value: current.get(key)?.value_text ?? null })).filter((e) => e.value !== null);
  const analysis = d.analyses[0];
  const codedBy = get<{ provider: string | null; model: string | null }>(
    db,
    `SELECT r.provider, r.model FROM content_attributes a JOIN ai_runs r ON r.id = a.ai_run_id WHERE a.content_id = ? AND a.source = 'ai' ORDER BY a.created_at DESC LIMIT 1`,
    contentId
  );
  const escalation = get<{ outcome: string; reason: string; base_model: string | null; escalated_model: string | null; disagreements_json: string }>(
    db,
    'SELECT outcome, reason, base_model, escalated_model, disagreements_json FROM coding_escalations WHERE content_id = ? ORDER BY id DESC LIMIT 1',
    contentId
  );

  return (
    <>
      <Notice searchParams={sp} />
      <PageHead
        kicker={`${fact.franchiseName ?? 'Unclassified'} · ${fmtDate(fact.publishedAt, true)} · ${corpusClass(fact)} in the corpus`}
        title={fact.title.length > 70 ? `${fact.title.slice(0, 67)}…` : fact.title}
        lede={<>Watch it, read what was actually said, then judge the AI&rsquo;s labels. Corrections are stored as human values and outrank the AI everywhere else in BBO BRAIN.</>}
        actions={
          <>
            {fact.isDemo ? <DemoFlag /> : null}
            <ScoreBadge score={fact.score} label={fact.label} />
            {fact.url ? (
              <a href={fact.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-gold">
                Watch on {fact.platform} ↗
              </a>
            ) : null}
            <Link href={`/content/${contentId}`} className="btn btn-sm">
              Full post page →
            </Link>
            <Link href="/validation" className="btn btn-sm">
              Back to queue
            </Link>
          </>
        }
      />

      <div className="split">
        <div className="stack">
          <Section title="What the opening actually looks like" note={frames.length ? `${frames.length} frames from the first seconds` : 'no frames captured'}>
            {frames.length ? (
              <div className="frame-strip">
                {frames.map((f, i) => (
                  <figure key={f.path} className="frame">
                    {/* Local files served by our own route; next/image adds no value for on-disk JPEGs. */}
                    <img src={`/api/media/${contentId}?frame=${i}`} alt={`Frame at ${f.atS}s`} loading="lazy" />
                    <figcaption className="mono xs muted">{ts(f.atS)}</figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <Empty title="No frames stored">Media has not been fetched for this post, so the visual coding is transcript-only.</Empty>
            )}
          </Section>

          <Section title="Transcript" note={d.transcript ? (d.transcript.model ?? undefined) : 'not transcribed'}>
            {d.transcript ? (
              <div className="transcript" style={{ maxHeight: '26rem', overflowY: 'auto' }}>
                {d.transcript.segments.map((s, i) => (
                  <div key={i} className={`transcript-line ${s.end <= 10 ? 'hot' : ''}`}>
                    <time>{ts(s.start)}</time>
                    <span>{s.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="No transcript">The AI coded this from caption and metrics only — weigh its labels accordingly.</Empty>
            )}
          </Section>

          {evidence.length ? (
            <Section title="What the AI measured" note="numbers and quotes behind the labels">
              <div className="card stack-xs">
                {evidence.map((e) => (
                  <div key={e.def.key} className="spread xs" style={{ alignItems: 'flex-start', gap: '1rem' }}>
                    <span className="muted" style={{ flex: '0 0 12rem' }}>
                      {e.def.label}
                    </span>
                    <span className="white" style={{ textAlign: 'right' }}>
                      {e.def.type === 'number' ? `${e.value}s` : e.value}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          {analysis ? (
            <Section title="AI's read of the clip" note="written from the evidence above">
              <div className="card stack-xs small">
                {([['Hook mechanics', analysis.hook_mechanics], ['Tension', analysis.tension], ['Payoff', analysis.payoff], ['Dead setup', analysis.dead_setup], ['Why it performed this way', analysis.outcome_explanation]] as Array<[string, string | null]>)
                  .filter(([, v]) => v)
                  .map(([label, v]) => (
                    <div key={label} className="stack-xs">
                      <span className="xs muted">{label}</span>
                      <span>{v}</span>
                    </div>
                  ))}
              </div>
            </Section>
          ) : null}
        </div>

        <aside className="stack">
          <Section title="AI coding" note={row.coded_at ? `coded ${fmtDate(row.coded_at, true)}${codedBy?.model ? ` · ${codedBy.provider}/${codedBy.model}` : ''}` : 'not coded yet'}>
            {escalation ? (
              <div className={`callout xs ${escalation.outcome === 'human_review' ? 'callout-pink' : ''}`} style={{ marginBottom: '.6rem' }}>
                <strong className="white">{escalation.outcome === 'human_review' ? 'Two models disagreed.' : 'Escalated to a stronger model.'}</strong> {escalation.reason}: {escalation.base_model} →{' '}
                {escalation.escalated_model}.{' '}
                {parseJson<string[]>(escalation.disagreements_json, []).length
                  ? `Differed on ${parseJson<string[]>(escalation.disagreements_json, []).map((x) => x.replace(/_/g, ' ')).join('; ')}.`
                  : 'They agreed.'}
              </div>
            ) : null}
            <form action={reviewCodingAction} className="stack-sm">
              <input type="hidden" name="contentId" value={contentId} />
              {groups.map((group) => (
                <div key={group} className="card stack-xs">
                  <div className="card-title">{GROUP_LABEL[group] ?? group}</div>
                  {editable
                    .filter((def) => def.group === group)
                    .map((def) => {
                      const cur = current.get(def.key);
                      const ai = aiValues.get(def.key);
                      const corrected = cur?.source === 'human' && ai && ai.value_text !== cur.value_text;
                      return (
                        <div key={def.key} className="stack-xs">
                          <div className="spread xs">
                            <label htmlFor={`v_${def.key}`} className="muted">
                              {def.label}
                            </label>
                            <span className="row-tight">
                              {cur ? <SourceChip source={cur.source} /> : null}
                              {ai?.confidence != null ? <Confidence label={ai.confidence >= 0.75 ? 'high' : ai.confidence >= 0.5 ? 'medium' : 'low'} /> : null}
                            </span>
                          </div>
                          <select id={`v_${def.key}`} name={`v_${def.key}`} defaultValue={cur?.value_text ?? ''} className="select">
                            <option value="">— not coded —</option>
                            {(def.type === 'boolean' ? ['true', 'false'] : (def.values ?? [])).map((v) => (
                              <option key={v} value={v}>
                                {v.replace(/_/g, ' ')}
                              </option>
                            ))}
                          </select>
                          {corrected ? <span className="xs gold">AI said “{ai.value_text.replace(/_/g, ' ')}” — already corrected.</span> : null}
                        </div>
                      );
                    })}
                </div>
              ))}

              <div className="field">
                <label className="field-label" htmlFor="note">
                  Note (optional)
                </label>
                <textarea id="note" name="note" rows={3} placeholder="What the AI missed, or why this one is hard to code…" />
              </div>

              <div className="row-tight" style={{ flexWrap: 'wrap', gap: '.5rem' }}>
                <SubmitButton className="btn btn-gold" name="status" value="APPROVED" pendingText="Saving…">
                  Approve as coded
                </SubmitButton>
                <SubmitButton className="btn" name="status" value="EDITED" pendingText="Saving…">
                  Save corrections
                </SubmitButton>
                <SubmitButton className="btn" name="status" value="REJECTED" pendingText="Saving…">
                  Reject & re-analyse
                </SubmitButton>
              </div>
              <p className="xs muted">
                Approve keeps the AI values. Save corrections writes only the fields you changed as human values and counts the rest as agreement. Reject clears the coding
                entirely and puts the post back in the queue.
              </p>
            </form>
          </Section>

          {priorReviews.length ? (
            <Section title="Review history">
              <div className="card stack-xs">
                {priorReviews.map((r, i) => (
                  <div key={i} className="stack-xs">
                    <div className="spread xs">
                      <span className="white">{r.status.toLowerCase()}</span>
                      <span className="mono muted">{fmtDate(r.reviewed_at, true)}</span>
                    </div>
                    {parseJson<string[]>(r.changed_json, []).length ? <span className="xs muted">corrected: {parseJson<string[]>(r.changed_json, []).join(', ').replace(/_/g, ' ')}</span> : null}
                    {r.note ? <span className="xs">{r.note}</span> : null}
                  </div>
                ))}
              </div>
            </Section>
          ) : null}
        </aside>
      </div>
    </>
  );
}

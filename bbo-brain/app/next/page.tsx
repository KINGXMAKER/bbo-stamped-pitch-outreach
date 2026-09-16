import Link from 'next/link';
import { opportunityStatusAction, refreshOpportunitiesAction } from '@/app/actions';
import { SubmitButton } from '@/components/client';
import { Notice } from '@/components/notice';
import { Confidence, Empty, fmtDate, PageHead, PostRow, Section, StatusChip } from '@/components/ui';
import { all, getDb } from '@/lib/db/client';
import { comparable, loadFacts } from '@/lib/intel/dataset';
import { latestOpportunities } from '@/lib/intel/opportunities';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'What Should BBO Make Next?' };

const KIND_LABEL: Record<string, string> = {
  topic_revival: 'Topic revival',
  topic_momentum: 'Topic momentum',
  format_transfer: 'Format transfer',
  guest_revisit: 'Guest revisit',
  duration_sweet_spot: 'Length',
  hook_pattern: 'Packaging pattern',
  experiment_needed: 'Experiment needs posts',
};

export default async function MakeNext({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const db = getDb();
  const { batchId, items } = latestOpportunities(db);
  const facts = new Map(loadFacts(db).map((f) => [f.contentId, f]));
  const scored = comparable([...facts.values()]).length;
  const running = all<{ id: number; code: string; name: string; hypothesis: string; result_summary: string | null }>(db, `SELECT id, code, name, hypothesis, result_summary FROM experiments WHERE status = 'running'`);
  const [top, ...rest] = items;

  return (
    <>
      <Notice searchParams={sp as Record<string, string>} />
      <PageHead
        kicker="Future content"
        title="What should BBO make next?"
        lede={<>Ranked from {scored.toLocaleString()} scored posts: topic, guest and format performance, what&apos;s gone quiet, what&apos;s saturated, and what BBO is still testing.</>}
        actions={
          <form action={refreshOpportunitiesAction}>
            <SubmitButton className="btn" pendingText="Recalculating…">
              Recalculate
            </SubmitButton>
          </form>
        }
      />

      {!top ? (
        <Empty title="No opportunities yet">Recalculate once content is synced and scored. Opportunities need at least 10 scored posts.</Empty>
      ) : (
        <>
          <article className="card card-pink card-hero rise" aria-label="Top priority idea">
            <div className="split" style={{ alignItems: 'stretch' }}>
              <div className="stack">
                <div className="row">
                  <span className="kicker">01 · Top priority idea</span>
                  <span className="chip chip-pink">{KIND_LABEL[top.kind] ?? top.kind}</span>
                </div>
                <h2 className="display" style={{ fontSize: 'clamp(2.2rem, 1.4rem + 3vw, 4rem)' }}>
                  {top.title}
                </h2>
                <p className="serif" style={{ fontSize: 'clamp(1.2rem, 1rem + 0.6vw, 1.55rem)', color: 'var(--white)', lineHeight: 1.3 }}>
                  {top.recommendation.nextContent}
                </p>
                <div className="sowhat">
                  <div className="kicker kicker-muted">02 · Why now</div>
                  <p style={{ marginTop: '.3rem' }}>{top.why}</p>
                </div>
                <div className="grid-4">
                  <Spec n="03" label="Best format" value={top.recommendation.format} />
                  <Spec n="04" label="Best hook style" value={top.recommendation.hookStyle} />
                  <Spec n="05" label="Ideal length" value={top.recommendation.lengthRange} />
                  <Spec n="06" label="Caption direction" value={top.recommendation.captionDirection} />
                </div>
              </div>
              <div className="stack">
                <div className="stack-sm">
                  <div className="kicker kicker-muted">07 · Supporting historical posts</div>
                  {top.supporting.length ? (
                    top.supporting.map((s) => (facts.get(s.contentId) ? <PostRow key={s.contentId} fact={facts.get(s.contentId)!} /> : null))
                  ) : (
                    <span className="small muted">No single posts — this is about filling a test.</span>
                  )}
                </div>
                <div className="stack-xs">
                  <div className="kicker kicker-muted">08 · Confidence</div>
                  <div className="row">
                    <Confidence label={top.confidence_label} />
                    <span className="xs muted">n = {top.sample_size}</span>
                  </div>
                  <span className="xs muted">Associational: this is what BBO&apos;s history favors, not a guarantee.</span>
                </div>
                <div className="stack-xs">
                  <div className="kicker kicker-muted">09 · What we are testing</div>
                  {top.experiment ? <p className="small gold">{top.experiment.hypothesis}</p> : null}
                  {running.length ? (
                    running.map((e) => (
                      <Link key={e.id} href={`/experiments/${e.id}`} className="small">
                        <span className="chip chip-pink">{e.code}</span> {e.name}
                      </Link>
                    ))
                  ) : (
                    <span className="small muted">No experiment is running. Start one in Experiments.</span>
                  )}
                </div>
                <OppActions id={top.id} status={top.status} />
              </div>
            </div>
          </article>

          <Section title="Ranked opportunities" note={`batch ${fmtDate(batchId)} · ${items.length} ideas`}>
            <div className="stack-sm">
              {rest.map((o, i) => (
                <article key={o.id} className="card" aria-label={o.title}>
                  <div className="split" style={{ gridTemplateColumns: 'minmax(0,1.8fr) minmax(0,1fr)' }}>
                    <div className="stack-xs">
                      <div className="row-tight">
                        <span className="mono xs muted">{String(i + 2).padStart(2, '0')}</span>
                        <span className="chip">{KIND_LABEL[o.kind] ?? o.kind}</span>
                        <Confidence label={o.confidence_label} />
                        <span className="xs muted">n = {o.sample_size}</span>
                        {o.status !== 'open' ? <StatusChip status={o.status} /> : null}
                      </div>
                      <h3 className="card-title" style={{ fontSize: '1.1rem' }}>
                        {o.title}
                      </h3>
                      <p className="small">{o.why}</p>
                      <p className="small serif italic white">{o.recommendation.nextContent}</p>
                      <div className="row-tight xs muted">
                        {[o.recommendation.format, o.recommendation.hookStyle && `hook: ${o.recommendation.hookStyle}`, o.recommendation.lengthRange, o.recommendation.captionDirection && `caption: ${o.recommendation.captionDirection}`].filter(Boolean).join(' · ')}
                      </div>
                      {o.experiment ? <div className="xs gold">Test: {o.experiment.hypothesis}</div> : null}
                    </div>
                    <div className="stack-sm">
                      {o.supporting.slice(0, 2).map((s) => (facts.get(s.contentId) ? <PostRow key={s.contentId} fact={facts.get(s.contentId)!} /> : null))}
                      <OppActions id={o.id} status={o.status} />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </Section>
        </>
      )}
    </>
  );
}

function Spec({ n, label, value }: { n: string; label: string; value: string | null }) {
  return (
    <div className="panel stack-xs">
      <div className="kicker kicker-muted">
        {n} · {label}
      </div>
      <div className="small white">{value ?? <span className="muted">not enough data</span>}</div>
    </div>
  );
}

function OppActions({ id, status }: { id: number; status: string }) {
  return (
    <form action={opportunityStatusAction} className="row-tight">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="back" value="/next" />
      {status !== 'accepted' ? <SubmitButton className="btn btn-sm btn-green" name="status" value="accepted">Accept</SubmitButton> : null}
      {status !== 'made' ? <SubmitButton className="btn btn-sm" name="status" value="made">Made it</SubmitButton> : null}
      <SubmitButton className="btn btn-sm btn-ghost" name="status" value="dismissed">Dismiss</SubmitButton>
    </form>
  );
}

import Link from 'next/link';
import { buildReviewAction } from '@/app/actions';
import { SubmitButton } from '@/components/client';
import { Notice } from '@/components/notice';
import { Empty, PageHead, Section } from '@/components/ui';
import { getDb } from '@/lib/db/client';
import { reviewList } from '@/lib/intel/reviews';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Weekly Review' };

export default async function Reviews({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const db = getDb();
  const weekly = reviewList(db, 'weekly_reviews');
  const monthly = reviewList(db, 'monthly_reviews');

  return (
    <>
      <Notice searchParams={sp as Record<string, string>} />
      <PageHead
        kicker="Reviews"
        title="What BBO learned this week"
        lede={<>Every review is saved, so this week can be read against last week, and this month against the last.</>}
        actions={
          <>
            <form action={buildReviewAction}>
              <input type="hidden" name="kind" value="weekly" />
              <SubmitButton className="btn btn-primary" pendingText="Writing weekly review…">
                Generate weekly
              </SubmitButton>
            </form>
            <form action={buildReviewAction}>
              <input type="hidden" name="kind" value="monthly" />
              <SubmitButton className="btn" pendingText="Writing monthly review…">
                Generate monthly
              </SubmitButton>
            </form>
          </>
        }
      />

      <div className="grid-2">
        <Section title="Weekly" note={`${weekly.length} saved`}>
          {weekly.length ? (
            <div className="stack-sm">
              {weekly.map((r) => (
                <Link key={r.id} href={`/reviews/weekly/${r.id}`} className="card card-link stack-xs">
                  <div className="spread">
                    <span className="kicker">
                      {r.period_start} → {r.period_end}
                    </span>
                    <span className={`chip ${r.narrative.source === 'ai' ? 'chip-gold' : 'chip-muted'}`}>{r.narrative.source === 'ai' ? 'AI-written' : 'calculated'}</span>
                  </div>
                  <div className="serif white" style={{ fontSize: '1.1rem' }}>
                    {r.narrative.what_worked}
                  </div>
                  <div className="xs muted clamp-2">{r.narrative.what_to_make_next}</div>
                  <div className="xs muted">
                    {r.evidence?.counts?.posts ?? 0} posts · {r.evidence?.counts?.mature ?? 0} mature
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <Empty title="No weekly reviews yet" />
          )}
        </Section>
        <Section title="Monthly" note={`${monthly.length} saved`}>
          {monthly.length ? (
            <div className="stack-sm">
              {monthly.map((r) => (
                <Link key={r.id} href={`/reviews/monthly/${r.id}`} className="card card-link stack-xs">
                  <div className="spread">
                    <span className="kicker">
                      {r.period_start} → {r.period_end}
                    </span>
                    <span className={`chip ${r.narrative.source === 'ai' ? 'chip-gold' : 'chip-muted'}`}>{r.narrative.source === 'ai' ? 'AI-written' : 'calculated'}</span>
                  </div>
                  <div className="serif white" style={{ fontSize: '1.1rem' }}>
                    {r.narrative.what_bbo_learned}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <Empty title="No monthly reviews yet" />
          )}
        </Section>
      </div>
    </>
  );
}

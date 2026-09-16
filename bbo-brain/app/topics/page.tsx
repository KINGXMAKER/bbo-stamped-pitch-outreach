import Link from 'next/link';
import { Empty, fmtDate, fmtX, PageHead, Section } from '@/components/ui';
import { getDb } from '@/lib/db/client';
import { topicIndex, type TopicFlag } from '@/lib/intel/queries';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Topics' };

const FLAGS: Array<{ flag: TopicFlag; title: string; note: string; tone: string }> = [
  { flag: 'dormant_strong', title: 'Strong topics gone quiet', note: 'median ≥1.15, unused 30+ days', tone: 'card-pink' },
  { flag: 'shares_driver', title: 'Share drivers', note: 'share rate ≥1.3x BBO median', tone: 'card-green' },
  { flag: 'comments_not_retention', title: 'Comments but weak retention', note: 'argue, then leave', tone: '' },
  { flag: 'oversaturated', title: 'Oversaturated', note: '4+ posts in 14 days, below baseline', tone: 'card-red' },
  { flag: 'underperforming', title: 'Underperforming', note: 'median <0.85 across 5+ posts', tone: 'card-red' },
];

export default function Topics() {
  const topics = topicIndex(getDb()).filter((t) => t.posts > 0);
  const tone = (v: number | null) => (v === null ? '' : v >= 1.15 ? 'up' : v <= 0.85 ? 'down' : '');

  return (
    <>
      <PageHead kicker="Topic intelligence" title="Topics" lede={<>Which subjects outperform, which start arguments but lose viewers, and which strong topics BBO has stopped using.</>} />
      {!topics.length ? <Empty title="No topics tagged yet">Topics come from caption keywords first, then transcript-grounded AI coding.</Empty> : null}

      <div className="grid-auto">
        {FLAGS.map(({ flag, title, note, tone: cardTone }) => {
          const list = topics.filter((t) => t.flags.includes(flag));
          return (
            <div key={flag} className={`card stack-sm ${list.length ? cardTone : ''}`}>
              <div className="kicker">{title}</div>
              <div className="xs muted">{note}</div>
              {list.length ? (
                list.map((t) => (
                  <Link key={t.slug} href={`/topics/${t.slug}`} className="spread small">
                    <span className="white">{t.name}</span>
                    <span className="mono xs">
                      {t.medianScore?.toFixed(2) ?? '—'} · n={t.scored}
                    </span>
                  </Link>
                ))
              ) : (
                <span className="xs muted">None right now.</span>
              )}
            </div>
          );
        })}
      </div>

      <Section title="All topics" note="ratios vs the BBO median">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Topic</th>
                <th>Parent</th>
                <th className="num">Posts</th>
                <th className="num">Median score</th>
                <th className="num">Shares</th>
                <th className="num">Comments</th>
                <th className="num">Retention</th>
                <th className="num">Last 14d</th>
                <th>Last used</th>
              </tr>
            </thead>
            <tbody>
              {topics
                .sort((a, b) => (b.medianScore ?? 0) - (a.medianScore ?? 0))
                .map((t) => (
                  <tr key={t.slug}>
                    <td>
                      <Link href={`/topics/${t.slug}`} className="white">
                        {t.name}
                      </Link>
                    </td>
                    <td className="small muted">{t.parent_name ?? '—'}</td>
                    <td className="num">{t.posts}</td>
                    <td className={`num ${tone(t.medianScore)}`}>{t.medianScore?.toFixed(2) ?? '—'}</td>
                    <td className={`num ${tone(t.shareRatio)}`}>{fmtX(t.shareRatio)}</td>
                    <td className={`num ${tone(t.commentRatio)}`}>{fmtX(t.commentRatio)}</td>
                    <td className={`num ${tone(t.retentionRatio)}`}>{fmtX(t.retentionRatio)}</td>
                    <td className="num">{t.last14}</td>
                    <td className="small nowrap">{fmtDate(t.lastUsed, true)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="xs muted" style={{ marginTop: '.6rem' }}>
          Caption-keyword tags are low confidence; AI tags from transcripts replace them as media is ingested.
        </p>
      </Section>
    </>
  );
}

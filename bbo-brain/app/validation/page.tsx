import Link from 'next/link';
import { Notice } from '@/components/notice';
import { Empty, fmtDate, LabelChip, PageHead, ScoreBadge, Section, Stat, Thumb } from '@/components/ui';
import { all, getDb } from '@/lib/db/client';
import { codedRows, codingAccuracy, currentValidationBatch, validationReport, validationSample, type ValidationStatus } from '@/lib/intel/validation';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Coding Validation' };

const CLASS_LABEL: Record<string, string> = { winner: 'Winner', loser: 'Loser', average: 'Average', unusual: 'Unusual', other: 'Other' };
const STATUS_TONE: Record<ValidationStatus, string> = { UNREVIEWED: 'chip-muted', APPROVED: 'chip-green', EDITED: 'chip-gold', REJECTED: 'chip-red' };

export default async function Validation({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const db = getDb();
  const size = Math.min(60, Math.max(5, Number(sp.size) || 25));
  const frozen = currentValidationBatch(db);
  // A frozen batch is the queue until it is finished; after that, a rolling sample.
  const sample = frozen && frozen.reviewed < frozen.rows.length ? frozen.rows : validationSample(db, size);
  const reviewed = codedRows(db).filter((r) => r.status !== 'UNREVIEWED');
  const accuracy = codingAccuracy(db);
  const thumbs = new Set(all<{ id: number }>(db, 'SELECT id FROM content WHERE thumb_path IS NOT NULL').map((r) => r.id));
  const counts = { APPROVED: 0, EDITED: 0, REJECTED: 0 } as Record<string, number>;
  for (const r of reviewed) counts[r.status]++;
  const worst = accuracy.attributes.filter((a) => a.agreement !== null && a.agreement < 0.8);
  const report = validationReport(db);
  const sampleMix = sample.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.corpusClass]: (acc[r.corpusClass] ?? 0) + 1 }), {});
  const [topClass, topCount] = Object.entries(sampleMix).sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  const skewed = sample.length >= 8 && topCount / sample.length > 0.5;

  const Row = ({ r }: { r: (typeof sample)[number] }) => (
    <tr>
      <td>
        <Link href={`/validation/${r.contentId}`} className="row-tight" style={{ gap: '.6rem' }}>
          <Thumb contentId={r.contentId} hasThumb={thumbs.has(r.contentId)} title={r.title} small />
          <span className="small white">{r.title.length > 64 ? `${r.title.slice(0, 61)}…` : r.title}</span>
        </Link>
      </td>
      <td>
        <span className="chip chip-muted">{CLASS_LABEL[r.corpusClass]}</span>
      </td>
      <td>
        <span className="row-tight">
          <ScoreBadge score={r.score} label={r.label} />
        </span>
      </td>
      <td className="small muted">{r.franchise ?? 'Unclassified'}</td>
      <td className="small muted">{r.topics.slice(0, 2).join(', ') || '—'}</td>
      <td className="small muted">{fmtDate(r.publishedAt, true)}</td>
      <td>
        <span className={`chip ${STATUS_TONE[r.status]}`}>{r.status.toLowerCase()}</span>
      </td>
    </tr>
  );

  return (
    <>
      <Notice searchParams={sp} />
      <PageHead
        kicker="Trust the labels"
        title="Coding Validation"
        lede={
          <>
            AI labels feed pattern mining, and pattern mining feeds rule proposals. Before any of that is trusted, a human watches a <em>stratified</em> sample — winners,
            losers, averages, several franchises — and every correction is kept so the AI&rsquo;s accuracy is measured, not assumed.
          </>
        }
        actions={
          <>
            <Link href="/validation/buckets" className="btn btn-sm btn-gold">
              Label content buckets →
            </Link>
            <Link href="/coverage" className="btn btn-sm">
              Data coverage →
            </Link>
          </>
        }
      />

      <div className="grid-4">
        <Stat label="Awaiting review" value={codedRows(db, { status: 'UNREVIEWED' }).length} sub={`sample of ${sample.length} below`} tone="pink" />
        <Stat label="Approved" value={counts.APPROVED} sub="AI coding kept as-is" />
        <Stat label="Edited" value={counts.EDITED} sub="human corrected at least one field" />
        <Stat label="Rejected" value={counts.REJECTED} sub="sent back for re-analysis" />
      </div>

      {worst.length ? (
        <div className="callout callout-pink xs" style={{ marginTop: '1.2rem' }}>
          <strong className="white">Watch these attributes.</strong> On reviewed posts the AI disagrees with a human most often on{' '}
          {worst
            .slice(0, 3)
            .map((a) => `${a.key.replace(/_/g, ' ')} (${Math.round((a.agreement ?? 0) * 100)}% agreement)`)
            .join(', ')}
          . Any lesson resting mainly on those fields deserves a harder look.
        </div>
      ) : null}

      {skewed ? (
        <div className="callout xs" style={{ marginTop: '1.2rem' }}>
          <strong className="white">This sample is skewed.</strong> {Math.round((topCount / sample.length) * 100)}% of it is {CLASS_LABEL[topClass]?.toLowerCase() ?? topClass} posts — the
          quota asks for a spread, but only what has been coded can be sampled. Agreement rates measured from it are provisional until the corpus is balanced.
        </div>
      ) : null}

      {report.reviewed ? (
        <Section
          title="What your review says the AI understands"
          note={`${report.reviewed} posts · ${report.overall.compared} labels compared${report.batchSize ? ` · batch ${report.batchReviewed}/${report.batchSize}` : ''}`}
        >
          <div className="grid-4">
            <Stat label="Overall agreement" value={report.overall.rate === null ? '—' : `${Math.round(report.overall.rate * 100)}%`} sub={`${report.overall.agreed}/${report.overall.compared} labels`} tone="pink" />
            <Stat label="Hook type" value={`${Math.round((report.fields.find((f) => f.key === 'hook_type')?.rate ?? 0) * 100)}%`} sub={`${report.fields.find((f) => f.key === 'hook_type')?.compared ?? 0} compared`} />
            <Stat label="Opening type" value={`${Math.round((report.fields.find((f) => f.key === 'opening_type')?.rate ?? 0) * 100)}%`} sub={`${report.fields.find((f) => f.key === 'opening_type')?.compared ?? 0} compared`} />
            <Stat
              label="Topics"
              value={report.unverified.includes('topics') ? 'Not verified' : report.topics.rate === null ? '—' : `${Math.round(report.topics.rate * 100)}%`}
              sub={report.unverified.includes('topics') ? 'held from mining' : `${report.topics.compared} posts`}
            />
          </div>
          <div className="split" style={{ marginTop: '1rem' }}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th className="num">Agreement</th>
                    <th className="num">Compared</th>
                    <th>Most common confusions (AI → you)</th>
                  </tr>
                </thead>
                <tbody>
                  {report.fields.map((f) => (
                    <tr key={f.key}>
                      <td className="small white">{f.key.replace(/_/g, ' ')}</td>
                      <td className={`num ${f.rate >= 0.8 ? 'up' : f.rate < 0.6 ? 'down' : ''}`}>{Math.round(f.rate * 100)}%</td>
                      <td className="num">{f.compared}</td>
                      <td className="xs muted">{f.confusions.map((c) => `${c.from} → ${c.to} (${c.n})`).join('; ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <aside className="stack">
              <div className="card stack-xs xs">
                <span className="card-title">By what the model could see</span>
                {report.byMedia.map((m) => (
                  <div key={m.input} className="spread">
                    <span className="muted">{m.input}</span>
                    <span className="mono">
                      {Math.round(m.rate * 100)}% <span className="muted">of {m.compared}</span>
                    </span>
                  </div>
                ))}
                <div className="divider" />
                <span className="card-title">By model</span>
                {report.byModel.map((m) => (
                  <div key={m.model} className="spread">
                    <span className="muted clamp-2" style={{ maxWidth: '11rem' }}>
                      {m.model}
                    </span>
                    <span className="mono">
                      {Math.round(m.rate * 100)}% <span className="muted">of {m.compared}</span>
                    </span>
                  </div>
                ))}
              </div>
              <div className={`callout xs ${report.unreliable.length ? 'callout-red' : ''}`}>
                {report.unreliable.length ? (
                  <>
                    <strong className="white">Excluded from lesson mining:</strong> {report.unreliable.join(', ')}. Below 60% agreement on 10+ reviews, so these fields no longer count as evidence.
                  </>
                ) : (
                  <>No field is below 60% agreement on 10+ reviews, so none is excluded from lesson mining.</>
                )}
              </div>
              {report.unverified.length ? (
                <div className="callout xs">
                  <strong className="white">Not verified by you:</strong> {report.unverified.map((k) => k.replace(/_/g, ' ')).join(', ')}. Your approvals didn&apos;t cover these, so
                  they&apos;re left out of the agreement figures and held out of lesson mining until they&apos;re checked.
                </div>
              ) : null}
            </aside>
          </div>
        </Section>
      ) : null}

      <Section
        title={frozen && frozen.reviewed < frozen.rows.length ? 'Validation batch' : 'Review queue'}
        note={
          frozen && frozen.reviewed < frozen.rows.length
            ? `${frozen.reviewed} of ${frozen.rows.length} reviewed · frozen ${fmtDate(frozen.batch.createdAt, true)} · balanced across outcome, franchise, topic and hook type`
            : `${sample.length} posts · balanced across outcome, franchise and topic`
        }
      >
        {sample.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Post</th>
                  <th>Corpus class</th>
                  <th>Outcome</th>
                  <th>Franchise</th>
                  <th>Topics</th>
                  <th>Published</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sample.map((r) => (
                  <Row key={r.contentId} r={r} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nothing waiting">
            Every coded post has been reviewed. Code more posts from <Link href="/coverage" className="pink">Data Coverage</Link> and a fresh sample appears here.
          </Empty>
        )}
      </Section>

      {reviewed.length ? (
        <Section title="Already reviewed" note={`${reviewed.length} posts`}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Post</th>
                  <th>Corpus class</th>
                  <th>Outcome</th>
                  <th>Franchise</th>
                  <th>Topics</th>
                  <th>Published</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {reviewed.slice(0, 40).map((r) => (
                  <Row key={r.contentId} r={r} />
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}
    </>
  );
}

import Link from 'next/link';
import { labelBucketsAction } from '@/app/actions';
import { SubmitButton } from '@/components/client';
import { Notice } from '@/components/notice';
import { Empty, fmtDate, PageHead, Section, Thumb } from '@/components/ui';
import { all, get, getDb, parseJson } from '@/lib/db/client';
import { brainConfig } from '@/lib/config';
import { bucketBenchmarkReport, bucketBenchmarkSample, bucketGate, humanBucketLabels } from '@/lib/intel/buckets';
import { BUCKET_DEFINITIONS, CONTENT_BUCKETS } from '@/lib/seed/reference';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Label content buckets' };

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

export default async function BucketLabelling({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const db = getDb();
  const cfg = brainConfig();
  // Label exactly the posts the candidate models were benchmarked on.
  const latest = get<{ params_json: string }>(db, `SELECT params_json FROM benchmark_runs WHERE task_class = 'content_bucket' ORDER BY id DESC LIMIT 1`);
  const ids = parseJson<{ contentIds?: number[] }>(latest?.params_json, {}).contentIds ?? bucketBenchmarkSample(db, 40);
  const posts = ids.length
    ? all<{ id: number; title: string; caption: string | null; media_type: string | null; published_at: string; url: string | null; thumb_path: string | null }>(
        db,
        `SELECT c.id, c.title, pp.caption, pp.media_type, pp.published_at, pp.source_url AS url, c.thumb_path
         FROM content c JOIN platform_posts pp ON pp.id = c.primary_post_id WHERE c.id IN (${ids.map(() => '?').join(',')})`,
        ...ids
      ).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
    : [];
  const human = humanBucketLabels(db);
  const labelled = posts.filter((p) => human.has(p.id)).length;
  const report = bucketBenchmarkReport(db);
  const gate = bucketGate(db);
  const chosen = report.filter((r) => r.model === cfg.bucketModel).sort((a, b) => b.humanLabelled - a.humanLabelled)[0];

  return (
    <>
      <Notice searchParams={sp} />
      <PageHead
        kicker="Content buckets"
        title="Label the benchmark sample"
        lede={
          <>
            The bucket decides what BBO BRAIN analyses at all, so the classifier is scored against <em>your</em> labels before it touches the catalogue. Pick the bucket for each post —
            model guesses are hidden so they cannot anchor you.
          </>
        }
        actions={
          <Link href="/validation" className="btn btn-sm">
            Coding validation →
          </Link>
        }
      />

      <div className={`callout xs ${gate.passed ? '' : 'callout-pink'}`} style={{ marginBottom: '1.2rem' }}>
        <strong className="white">{gate.passed ? 'Classifier cleared for rollout.' : 'Classifier held.'}</strong> {gate.reason.charAt(0).toUpperCase() + gate.reason.slice(1)}. Rollout needs {cfg.bucketGateMinLabels}+ human labels, accuracy ≥{' '}
        {Math.round(cfg.bucketGateMinAccuracy * 100)}% and core-interview recall ≥ {Math.round(cfg.bucketGateMinCoreRecall * 100)}%. {labelled} of {posts.length} labelled.
      </div>

      {report.some((r) => r.humanLabelled > 0) ? (
        <Section title="Candidates scored against your labels" note="human labels only">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="num">Labelled</th>
                  <th className="num">Accuracy</th>
                  <th className="num">Core recall</th>
                  <th className="num">Core precision</th>
                  <th className="num">Format</th>
                  <th className="num">Valid</th>
                  <th className="num">Median</th>
                  <th className="num">$/100</th>
                </tr>
              </thead>
              <tbody>
                {report.map((r) => (
                  <tr key={r.benchmarkRunId}>
                    <td className="small white">{r.label}</td>
                    <td className="num">{r.humanLabelled}</td>
                    <td className="num">{pct(r.accuracy)}</td>
                    <td className="num">{pct(r.coreRecall)}</td>
                    <td className="num">{pct(r.corePrecision)}</td>
                    <td className="num">{pct(r.formatAccuracy)}</td>
                    <td className="num">{pct(r.validRate)}</td>
                    <td className="num">{(r.medianLatencyMs / 1000).toFixed(1)}s</td>
                    <td className="num">{r.costPer100Usd.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {chosen && Object.keys(chosen.confusion).length ? (
            <div className="card stack-xs xs" style={{ marginTop: '.8rem' }}>
              <span className="card-title">Where {chosen.model} goes wrong (your label → its label)</span>
              {Object.entries(chosen.confusion).flatMap(([truth, predicted]) =>
                Object.entries(predicted)
                  .filter(([p]) => p !== truth)
                  .map(([p, n]) => (
                    <span key={`${truth}-${p}`}>
                      {BUCKET_DEFINITIONS[truth as keyof typeof BUCKET_DEFINITIONS]?.label ?? truth} → {BUCKET_DEFINITIONS[p as keyof typeof BUCKET_DEFINITIONS]?.label ?? p}: {n}
                    </span>
                  ))
              )}
            </div>
          ) : null}
        </Section>
      ) : null}

      <Section title="Posts to label" note={`${posts.length} posts · stratified across every bucket`}>
        {posts.length ? (
          <form action={labelBucketsAction} className="stack-sm">
            {posts.map((p) => {
              const current = human.get(p.id);
              return (
                <article key={p.id} className="card" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '.9rem', alignItems: 'start' }}>
                  <Thumb contentId={p.id} hasThumb={Boolean(p.thumb_path)} title={p.title} small />
                  <div className="stack-xs">
                    <div className="spread xs">
                      <span className="muted">
                        #{p.id} · {p.media_type === 'CAROUSEL_ALBUM' ? 'carousel' : (p.media_type ?? '').toLowerCase()} · {fmtDate(p.published_at, true)}
                      </span>
                      {p.url ? (
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="pink">
                          Open on Instagram ↗
                        </a>
                      ) : null}
                    </div>
                    <p className="small white clamp-2">{(p.caption ?? p.title).slice(0, 260) || '(no caption)'}</p>
                    <fieldset className="row-tight" style={{ flexWrap: 'wrap', gap: '.8rem', border: 0, padding: 0, margin: 0 }}>
                      <legend className="sr-only">Content bucket for post {p.id}</legend>
                      {CONTENT_BUCKETS.map((b) => (
                        <label key={b} className="xs row-tight" style={{ gap: '.3rem' }}>
                          <input type="radio" name={`b_${p.id}`} value={b} defaultChecked={current?.bucket === b} />
                          {BUCKET_DEFINITIONS[b].label}
                        </label>
                      ))}
                      <label className="xs row-tight" style={{ gap: '.3rem' }}>
                        format
                        <select name={`f_${p.id}`} defaultValue={current?.format ?? ''} className="select" style={{ width: 'auto', padding: '.15rem 1.4rem .15rem .4rem', fontSize: 'var(--text-xs)' }}>
                          <option value="">—</option>
                          <option value="podcast">podcast</option>
                          <option value="street_interview">street interview</option>
                        </select>
                      </label>
                    </fieldset>
                  </div>
                </article>
              );
            })}
            <div className="row-tight">
              <SubmitButton className="btn btn-gold" pendingText="Saving…">
                Save labels
              </SubmitButton>
              <span className="xs muted">Format only applies to core interview content.</span>
            </div>
          </form>
        ) : (
          <Empty title="No benchmark sample yet">Run the bucket benchmark job first.</Empty>
        )}
      </Section>
    </>
  );
}

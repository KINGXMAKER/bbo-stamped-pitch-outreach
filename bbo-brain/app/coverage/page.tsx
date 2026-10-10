import Link from 'next/link';
import { JobButton } from '@/components/client';
import { Empty, PageHead, Section, Stat } from '@/components/ui';
import { getDb } from '@/lib/db/client';
import { accuracyByModel, codingAccuracy, coverageStats } from '@/lib/intel/validation';
import { corpusStatus } from '@/lib/sync/media-queue';
import { all } from '@/lib/db/client';
import { BUCKET_DEFINITIONS, CONTENT_BUCKETS } from '@/lib/seed/reference';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Data Coverage' };

function Bar({ value, total, tone = 'var(--pink)' }: { value: number; total: number; tone?: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="stack-xs">
      <div className="spread xs">
        <span className="mono white">
          {value.toLocaleString()} <span className="muted">/ {total.toLocaleString()}</span>
        </span>
        <span className="mono muted">{pct}%</span>
      </div>
      <div className="bar">
        <span style={{ width: `${pct}%`, background: tone }} />
      </div>
    </div>
  );
}

export default function Coverage() {
  const db = getDb();
  const c = coverageStats(db);
  const corpus = corpusStatus(db);
  const accuracy = codingAccuracy(db);
  const bucketRows = all<{ bucket: string | null; source: string | null; n: number }>(
    db,
    `SELECT a.value_text AS bucket, a.source, COUNT(*) AS n FROM content c
     LEFT JOIN content_attribute_current a ON a.content_id = c.id AND a.key = 'content_bucket'
     WHERE c.is_demo = 0 GROUP BY a.value_text, a.source`
  );
  const unbucketed = bucketRows.filter((r) => r.bucket === null).reduce((a, r) => a + r.n, 0);
  const modelRows = accuracyByModel(db);
  const byModel = Object.values(
    modelRows.reduce<Record<string, { model: string; reviewed: number; agreed: number }>>((acc, r) => {
      const cur = acc[r.model] ?? { model: r.model, reviewed: 0, agreed: 0 };
      acc[r.model] = { model: r.model, reviewed: cur.reviewed + r.reviewed, agreed: cur.agreed + r.agreed };
      return acc;
    }, {})
  );
  const classes = [
    ['winner', 'Breakouts & winners'],
    ['loser', 'Losers & below average'],
    ['average', 'Average controls'],
    ['unusual', 'Unusual share/comment/retention'],
  ] as const;

  return (
    <>
      <PageHead
        kicker="Data quality"
        title="How much does BBO BRAIN understand?"
        lede={<>Performance data covers everything. <em>Understanding</em> covers only what has been watched, transcribed and coded — this is that gap, honestly.</>}
        actions={
          <>
            <JobButton kind="media-transcripts" label="Fetch media (priority order)" className="btn" />
            <JobButton kind="ai-enrich" label="Code content" className="btn btn-gold" />
          </>
        }
      />

      <div className="grid-4">
        <Stat label="Content records" value={c.total.toLocaleString()} sub="posts with performance data" />
        <Stat label="Media analysed" value={c.mediaAnalyzed} sub={`${Math.round((c.mediaAnalyzed / Math.max(1, c.total)) * 100)}% of catalogue`} tone="pink" />
        <Stat label="Structurally coded" value={c.coded} sub={`${c.analysed} with deep analysis`} />
        <Stat label="Human validated" value={c.humanValidated} sub={`${c.unreviewed} awaiting review`} />
      </div>

      <Section title="Content buckets" note={`${unbucketed} of ${c.total} posts not yet bucketed`}>
        <div className="grid-4">
          {CONTENT_BUCKETS.map((b) => {
            const rows = bucketRows.filter((r) => r.bucket === b);
            const n = rows.reduce((a, r) => a + r.n, 0);
            return (
              <div key={b} className="card stack-xs">
                <span className="card-title">{BUCKET_DEFINITIONS[b].label}</span>
                <span className="mono white">{n.toLocaleString()}</span>
                <span className="xs muted">{rows.map((r) => `${r.n} ${r.source}`).join(' · ') || 'none yet'}</span>
                <span className="xs muted">{BUCKET_DEFINITIONS[b].analysed ? `priority ${BUCKET_DEFINITIONS[b].priority} · analysed` : 'not analysed'}</span>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="First intelligence corpus" note={`${corpus.coded} / ${corpus.target} coded · balanced by design`}>
        <div className="grid-2">
          {classes.map(([key, label]) => {
            const s = corpus.classes[key];
            return (
              <div key={key} className="card stack-sm">
                <div className="spread">
                  <span className="card-title">{label}</span>
                  <span className="chip chip-muted">{s.total.toLocaleString()} in catalogue</span>
                </div>
                <Bar value={s.coded} total={s.target} tone={s.coded >= s.target ? 'var(--green)' : 'var(--pink)'} />
                <span className="xs muted">
                  {s.withMedia.toLocaleString()} have media · {s.remaining} still needed for the corpus target
                </span>
              </div>
            );
          })}
        </div>
      </Section>

      <div className="split">
        <Section title="Attribute coverage" note="of all content records">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Attribute</th>
                  <th className="num">Coded</th>
                  <th className="num">AI</th>
                  <th className="num">Human</th>
                  <th style={{ width: '32%' }}>Coverage</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="small white">Transcripts</td>
                  <td className="num">{c.transcripts}</td>
                  <td className="num muted">—</td>
                  <td className="num muted">—</td>
                  <td>
                    <Bar value={c.transcripts} total={c.total} />
                  </td>
                </tr>
                <tr>
                  <td className="small white">Topics</td>
                  <td className="num">{c.topicsCoded}</td>
                  <td className="num gold">{c.topicsAi}</td>
                  <td className="num muted">—</td>
                  <td>
                    <Bar value={c.topicsCoded} total={c.total} />
                  </td>
                </tr>
                {c.fields.map((f) => (
                  <tr key={f.key}>
                    <td className="small white">{f.label}</td>
                    <td className="num">{f.coded}</td>
                    <td className="num gold">{f.ai || ''}</td>
                    <td className="num pink">{f.human || ''}</td>
                    <td>
                      <Bar value={f.coded} total={c.total} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="xs muted" style={{ marginTop: '.5rem' }}>
            Caption type, CTA and duration come from measurement and caption parsing, so they cover far more of the catalogue than video-derived attributes.
          </p>
        </Section>

        <aside className="stack">
          <Section title="AI coding accuracy" note={accuracy.reviewed ? `${accuracy.reviewed} posts reviewed` : 'no reviews yet'}>
            {accuracy.reviewed ? (
              <div className="card stack-xs">
                {accuracy.attributes.map((a) => (
                  <div key={a.key} className="spread xs">
                    <span>{a.key.replace(/_/g, ' ')}</span>
                    <span className="mono">
                      <span className={a.agreement !== null && a.agreement >= 0.8 ? 'up' : a.agreement !== null && a.agreement < 0.6 ? 'down' : ''}>
                        {a.agreement === null ? '—' : `${Math.round(a.agreement * 100)}%`}
                      </span>{' '}
                      <span className="muted">
                        {a.corrected}/{a.aiCoded} corrected
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="Not measured yet">
                Review a sample in <Link href="/validation" className="pink">Coding Validation</Link> and agreement per attribute appears here.
              </Empty>
            )}
          </Section>
          {byModel.length ? (
            <Section title="Agreement by coding model" note="human-reviewed labels only">
              <div className="card stack-xs">
                {byModel.map((m) => (
                  <div key={m.model} className="spread xs">
                    <span className="mono clamp-2" style={{ maxWidth: '13rem' }}>
                      {m.model}
                    </span>
                    <span className="mono">
                      {Math.round((m.agreed / Math.max(1, m.reviewed)) * 100)}% <span className="muted">of {m.reviewed} labels</span>
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}
          <div className="callout xs">
            <strong className="white">Why this page exists.</strong> Pattern mining runs on these attributes and can end in a rule proposal. If an attribute is coded on 30 posts, any lesson about it rests on 30 posts — the coverage number is the honest ceiling on what BBO BRAIN can claim.
          </div>
        </aside>
      </div>
    </>
  );
}

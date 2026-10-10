import Link from 'next/link';
import { JobButton } from '@/components/client';
import { Empty, fmtDate, PageHead, PostRow, Section } from '@/components/ui';
import { all, get, getDb } from '@/lib/db/client';
import { analysisQueue } from '@/lib/intel/analysis';
import { loadFacts } from '@/lib/intel/dataset';
import { getSetting } from '@/lib/seed';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Content Intelligence' };

export default function Intelligence() {
  const db = getDb();
  const queue = analysisQueue(db);
  const triggers = getSetting<{ scoreHigh: number; scoreLow: number; componentHigh: number; retentionLow: number; maxPerRun: number }>(db, 'analysis_triggers');
  const analyses = all<{ id: number; content_id: number; outcome: string; actual_topic: string | null; outcome_explanation: string | null; confidence: string | null; evidence_basis: string; created_at: string }>(
    db,
    'SELECT id, content_id, outcome, actual_topic, outcome_explanation, confidence, evidence_basis, created_at FROM content_analyses ORDER BY id DESC LIMIT 20'
  );
  const facts = new Map(loadFacts(db, { contentIds: analyses.map((a) => a.content_id) }).map((f) => [f.contentId, f]));
  const coverage = all<{ key: string; label: string; attr_group: string; human: number; measured: number; ai: number; audit: number; heuristic: number; total: number }>(
    db,
    `SELECT d.key, d.label, d.attr_group,
            SUM(CASE WHEN a.source = 'human' THEN 1 ELSE 0 END) AS human,
            SUM(CASE WHEN a.source = 'measured' THEN 1 ELSE 0 END) AS measured,
            SUM(CASE WHEN a.source = 'ai' THEN 1 ELSE 0 END) AS ai,
            SUM(CASE WHEN a.source = 'audit_v2' THEN 1 ELSE 0 END) AS audit,
            SUM(CASE WHEN a.source = 'heuristic' THEN 1 ELSE 0 END) AS heuristic,
            (SELECT COUNT(*) FROM content_attribute_current c WHERE c.key = d.key) AS total
     FROM attribute_definitions d LEFT JOIN content_attributes a ON a.key = d.key
     GROUP BY d.key ORDER BY d.attr_group, total DESC`
  );
  const media = get<{ content: number; transcripts: number; thumbs: number; videos: number }>(
    db,
    `SELECT (SELECT COUNT(*) FROM content WHERE status = 'published') AS content,
            (SELECT COUNT(DISTINCT content_id) FROM transcripts) AS transcripts,
            (SELECT COUNT(*) FROM content WHERE thumb_path IS NOT NULL) AS thumbs,
            (SELECT COUNT(*) FROM content WHERE format IN ('reel','video')) AS videos`
  )!;

  return (
    <>
      <PageHead
        kicker="Content Intelligence"
        title="Where AI attention goes"
        lede={<>Deep analysis is reserved for unusual outcomes. Average posts stay searchable comparison data. Every analysis is grounded in the transcript and hook frames — never a filename or a caption alone.</>}
        actions={
          <>
            <JobButton kind="media-transcripts" label="Fetch media + transcripts" className="btn" />
            <JobButton kind="ai-enrich" label="AI attribute coding" className="btn btn-gold" />
            <JobButton kind="analyze" label="Analyse queue" className="btn btn-primary" />
          </>
        }
      />

      <div className="grid-4">
        <div className="card stack-xs">
          <span className="stat-label">Ready to analyse</span>
          <span className="stat-value pink">{queue.ready.length}</span>
        </div>
        <div className="card stack-xs">
          <span className="stat-label">Waiting for media</span>
          <span className="stat-value">{queue.waitingForMedia.length}</span>
        </div>
        <div className="card stack-xs">
          <span className="stat-label">Transcribed</span>
          <span className="stat-value">{media.transcripts}</span>
          <span className="stat-sub">of {media.videos} videos</span>
        </div>
        <div className="card stack-xs">
          <span className="stat-label">Analysed</span>
          <span className="stat-value">{queue.analysed}</span>
        </div>
      </div>

      <div className="callout xs section">
        <strong className="white">Triggers</strong> (edit in <Link href="/settings" className="pink">Settings</Link>): score ≥ {triggers.scoreHigh} or ≤ {triggers.scoreLow}; shares, comments or retention ≥ {triggers.componentHigh}x peers; retention ≤ {triggers.retentionLow}x peers. Up to {triggers.maxPerRun} analyses per run.
      </div>

      <div className="split section">
        <div className="stack">
          <Section title="Analysis queue" note="most unusual first">
            {queue.ready.length || queue.waitingForMedia.length ? (
              <div className="card stack-sm">
                {[...queue.ready.slice(0, 12), ...queue.waitingForMedia.slice(0, 12 - Math.min(12, queue.ready.length))].map((h) => (
                  <PostRow
                    key={h.fact.contentId}
                    fact={h.fact}
                    extra={
                      <span className="row-tight xs">
                        <span className={`chip ${h.outcome === 'winner' ? 'chip-green' : h.outcome === 'loser' ? 'chip-red' : 'chip-gold'}`}>{h.outcome}</span>
                        {queue.waitingForMedia.includes(h) ? <span className="chip chip-amber">needs media</span> : null}
                        <span className="muted">{h.reasons.join(' · ')}</span>
                      </span>
                    }
                  />
                ))}
              </div>
            ) : (
              <Empty title="Queue is empty" />
            )}
          </Section>

          <Section title="Recent analyses">
            {analyses.length ? (
              <div className="stack-sm">
                {analyses.map((a) => {
                  const f = facts.get(a.content_id);
                  return (
                    <Link key={a.id} href={`/content/${a.content_id}`} className={`card card-link stack-xs ${a.outcome === 'winner' ? 'card-green' : a.outcome === 'loser' ? 'card-red' : 'card-gold'}`}>
                      <div className="row-tight xs">
                        <span className="chip chip-gold">AI</span>
                        <span className="muted">
                          {a.evidence_basis} · {a.confidence} · {fmtDate(a.created_at)}
                        </span>
                      </div>
                      <div className="card-title">{f?.title ?? `Content ${a.content_id}`}</div>
                      <div className="small">
                        <span className="gold">{a.actual_topic}</span> — <span className="clamp-2">{a.outcome_explanation}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <Empty title="No analyses yet">Fetch media for the queue, then analyse.</Empty>
            )}
          </Section>
        </div>

        <aside className="stack">
          <Section title="Attribute coverage" note="the system learns which attributes matter">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Attribute</th>
                    <th className="num">Coded</th>
                    <th className="num">AI</th>
                    <th className="num">Human</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.map((c) => (
                    <tr key={c.key}>
                      <td className="small">
                        {c.label} <span className="xs muted">{c.attr_group}</span>
                      </td>
                      <td className="num">{c.total}</td>
                      <td className="num gold">{c.ai || ''}</td>
                      <td className="num pink">{c.human || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </aside>
      </div>
    </>
  );
}

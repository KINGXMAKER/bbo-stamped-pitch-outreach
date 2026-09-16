import Link from 'next/link';
import { JobButton } from '@/components/client';
import { Notice } from '@/components/notice';
import { Confidence, Empty, fmtDate, PageHead, Section, StatusChip } from '@/components/ui';
import { all, getDb, parseJson } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lessons' };

type LessonRow = {
  id: number;
  code: string;
  text: string;
  category: string;
  status: string;
  confidence_label: string;
  origin: string;
  sample_size: number | null;
  effect: number | null;
  direction: string | null;
  metrics_json: string | null;
  last_evaluated_at: string | null;
  updated_at: string;
};

const GROUPS: Array<{ title: string; statuses: string[]; note: string }> = [
  { title: 'Proven & promoted', statuses: ['PROMOTED_TO_RULE', 'SUPPORTED'], note: 'repeated, moderate-or-better evidence' },
  { title: 'Observing', statuses: ['NEW', 'OBSERVING'], note: 'signals, not yet rules' },
  { title: 'Weakened & contradicted', statuses: ['WEAKENED', 'CONTRADICTED'], note: 'beliefs newer data pushed back on' },
  { title: 'Archived', statuses: ['ARCHIVED'], note: 'retired' },
];

export default async function Lessons({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const db = getDb();
  const origin = sp.origin;
  const lessons = all<LessonRow>(db, `SELECT * FROM lessons ${origin ? 'WHERE origin = ?' : ''} ORDER BY CASE confidence_label WHEN 'STRONG_SIGNAL' THEN 0 WHEN 'MODERATE_SIGNAL' THEN 1 WHEN 'EARLY_SIGNAL' THEN 2 ELSE 3 END, updated_at DESC`, ...(origin ? [origin] : []));
  const events = all<{ lesson_id: number; code: string; from_status: string | null; to_status: string; note: string | null; occurred_at: string }>(
    db,
    'SELECT e.lesson_id, l.code, e.from_status, e.to_status, e.note, e.occurred_at FROM lesson_events e JOIN lessons l ON l.id = e.lesson_id ORDER BY e.occurred_at DESC, e.id DESC LIMIT 25'
  );
  const origins = all<{ origin: string; n: number }>(db, 'SELECT origin, COUNT(*) AS n FROM lessons GROUP BY origin');

  return (
    <>
      <Notice searchParams={sp as Record<string, string>} />
      <PageHead
        kicker="Learning system"
        title="Lessons"
        lede={<>A lesson is not a rule. It is an observation with its evidence, sample size and confidence — and it can <em>weaken or be contradicted</em> as BBO keeps posting.</>}
        actions={<JobButton kind="mine-lessons" label="Mine lessons now" className="btn btn-gold" />}
      />

      <div className="row" style={{ marginBottom: '1rem' }}>
        <Link href="/lessons" className={`chip ${!origin ? 'chip-pink' : ''}`}>
          All ({lessons.length && !origin ? lessons.length : origins.reduce((a, b) => a + b.n, 0)})
        </Link>
        {origins.map((o) => (
          <Link key={o.origin} href={`/lessons?origin=${o.origin}`} className={`chip ${origin === o.origin ? 'chip-pink' : ''}`}>
            {o.origin.replace(/_/g, ' ')} ({o.n})
          </Link>
        ))}
      </div>

      <div className="split">
        <div className="stack">
          {!lessons.length ? <Empty title="No lessons yet">Run lesson mining after content is scored.</Empty> : null}
          {GROUPS.map((g) => {
            const list = lessons.filter((l) => g.statuses.includes(l.status));
            if (!list.length) return null;
            return (
              <Section key={g.title} title={g.title} note={`${list.length} · ${g.note}`}>
                <div className="stack-sm">
                  {list.map((l) => {
                    const m = parseJson<{ nGroup?: number; nRest?: number; testsRunThisPass?: number; brainCheck?: { verdict?: string; effect?: number; nGroup?: number; nRest?: number } }>(l.metrics_json, {});
                    return (
                      <Link key={l.id} href={`/lessons/${l.id}`} className={`card card-link stack-xs ${l.status === 'PROMOTED_TO_RULE' ? 'card-gold' : l.status === 'CONTRADICTED' ? 'card-red' : ''}`}>
                        <div className="row-tight">
                          <span className="mono xs muted">{l.code}</span>
                          <StatusChip status={l.status} />
                          <Confidence label={l.confidence_label} />
                          <span className="chip chip-muted">{l.category}</span>
                          <span className="chip chip-muted">{l.origin.replace(/_/g, ' ')}</span>
                        </div>
                        <p className="white" style={{ lineHeight: 1.4 }}>
                          {l.text}
                        </p>
                        <div className="row-tight xs muted">
                          {m.nGroup !== undefined ? <span>{m.nGroup} vs {m.nRest} posts</span> : l.sample_size ? <span>n = {l.sample_size}</span> : null}
                          {l.effect ? <span>· {l.effect.toFixed(2)}x</span> : null}
                          {m.brainCheck ? (
                            <span className="gold">
                              · BBO BRAIN re-check: {m.brainCheck.verdict} {m.brainCheck.effect?.toFixed(2) ?? ''}x ({m.brainCheck.nGroup} vs {m.brainCheck.nRest})
                            </span>
                          ) : null}
                          {l.last_evaluated_at ? <span>· evaluated {fmtDate(l.last_evaluated_at)}</span> : null}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </Section>
            );
          })}
        </div>

        <aside className="stack">
          <Section title="Belief history" note="latest movements">
            <div className="card">
              <div className="timeline">
                {events.map((e, i) => (
                  <Link key={i} href={`/lessons/${e.lesson_id}`} className={`timeline-item stack-xs ${['WEAKENED', 'CONTRADICTED', 'ARCHIVED'].includes(e.to_status) ? '' : 'muted-dot'}`}>
                    <div className="row-tight xs">
                      <span className="mono muted">{fmtDate(e.occurred_at, true)}</span>
                      <span className="mono">{e.code}</span>
                      {e.from_status ? <span className="muted">{e.from_status.replace(/_/g, ' ').toLowerCase()} →</span> : null}
                      <StatusChip status={e.to_status} />
                    </div>
                    {e.note ? <div className="xs muted clamp-2">{e.note}</div> : null}
                  </Link>
                ))}
              </div>
            </div>
          </Section>
          <div className="callout xs">
            <strong className="white">Guardrails.</strong> No pattern from fewer than 5 posts per group. Strong signals need 15+ per group, a consistent direction, p ≤ 0.05 and agreement across both halves of the timeline. Lessons say “associated with”, never “caused”, unless an experiment backs them.
          </div>
        </aside>
      </div>
    </>
  );
}

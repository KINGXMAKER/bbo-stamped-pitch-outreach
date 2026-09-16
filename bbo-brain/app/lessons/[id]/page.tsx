import Link from 'next/link';
import { notFound } from 'next/navigation';
import { setLessonStatusAction } from '@/app/actions';
import { SubmitButton } from '@/components/client';
import { Notice } from '@/components/notice';
import { Confidence, Empty, fmtDate, PageHead, PostRow, Section, StatusChip } from '@/components/ui';
import { all, get, getDb, parseJson } from '@/lib/db/client';
import { loadFacts } from '@/lib/intel/dataset';
import { describePattern, loadLabels, parsePattern } from '@/lib/intel/patterns';

export const dynamic = 'force-dynamic';

type Evidence = {
  nGroup?: number;
  nRest?: number;
  medianGroup?: number | null;
  medianRest?: number | null;
  effect?: number | null;
  consistency?: number | null;
  pValue?: number | null;
  halvesAgree?: boolean | null;
  recentEffect?: number | null;
  verdict?: string;
  dateRange?: { from: string; to: string } | null;
  testsRunThisPass?: number;
  supportiveStreak?: number;
  evaluatedAt?: string;
};

export default async function LessonDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const db = getDb();
  const lesson = get<{
    id: number;
    code: string;
    text: string;
    category: string;
    status: string;
    confidence_label: string;
    origin: string;
    pattern_json: string | null;
    direction: string | null;
    comparison_group: string | null;
    sample_size: number | null;
    effect: number | null;
    metrics_json: string | null;
    evidence: string | null;
    caveat: string | null;
    next_test: string | null;
    related_experiment_id: number | null;
    related_rule_id: number | null;
    first_seen_at: string;
    last_evaluated_at: string | null;
  }>(db, 'SELECT * FROM lessons WHERE id = ?', Number(id));
  if (!lesson) notFound();

  const meta = parseJson<Evidence & { brainCheck?: Evidence; pattern?: unknown; median_outcomes?: unknown }>(lesson.metrics_json, {});
  const check: Evidence | undefined = lesson.origin === 'imported_audit' ? meta.brainCheck : meta;
  const pattern = parsePattern(lesson.pattern_json) ?? parsePattern(meta.pattern ? JSON.stringify(meta.pattern) : null);
  const labels = loadLabels(db);
  const links = all<{ content_id: number; relation: string }>(db, 'SELECT content_id, relation FROM lesson_content WHERE lesson_id = ?', lesson.id);
  const facts = new Map(loadFacts(db, { contentIds: links.map((l) => l.content_id) }).map((f) => [f.contentId, f]));
  const events = all<{ from_status: string | null; to_status: string; from_confidence: string | null; to_confidence: string; sample_size: number | null; effect: number | null; note: string | null; occurred_at: string }>(
    db,
    'SELECT * FROM lesson_events WHERE lesson_id = ? ORDER BY occurred_at, id',
    lesson.id
  );
  const experiment = lesson.related_experiment_id ? get<{ id: number; code: string; name: string; status: string }>(db, 'SELECT id, code, name, status FROM experiments WHERE id = ?', lesson.related_experiment_id) : null;
  const rule = lesson.related_rule_id ? get<{ id: number; code: string }>(db, 'SELECT id, code FROM rules WHERE id = ?', lesson.related_rule_id) : null;
  const proposal = get<{ id: number; status: string }>(db, 'SELECT id, status FROM rule_proposals WHERE lesson_id = ? ORDER BY id DESC LIMIT 1', lesson.id);

  return (
    <>
      <Notice searchParams={sp as Record<string, string>} />
      <PageHead
        kicker={`${lesson.code} · ${lesson.category} · ${lesson.origin.replace(/_/g, ' ')}`}
        title="Lesson"
        lede={lesson.text}
        actions={
          <>
            <StatusChip status={lesson.status} />
            <Confidence label={lesson.confidence_label} />
          </>
        }
      />

      <div className="split">
        <div className="stack">
          <Section title="Evidence" note={pattern ? describePattern(labels, pattern) : 'no machine-checkable pattern'}>
            {check && check.nGroup !== undefined ? (
              <div className="card stack-sm">
                {lesson.origin === 'imported_audit' ? <div className="kicker kicker-gold">BBO BRAIN re-check of the audit claim on its own data</div> : null}
                <div className="grid-4">
                  <Metric label="Group vs rest" value={`${check.nGroup} vs ${check.nRest}`} />
                  <Metric label="Effect (median ratio)" value={check.effect ? `${check.effect.toFixed(2)}x` : '—'} tone={check.effect && check.effect >= 1.25 ? 'up' : check.effect && check.effect <= 0.8 ? 'down' : undefined} />
                  <Metric label="Consistency" value={check.consistency !== null && check.consistency !== undefined ? `${Math.round(check.consistency * 100)}%` : '—'} />
                  <Metric label="p-value" value={check.pValue !== null && check.pValue !== undefined ? check.pValue.toFixed(3) : '—'} />
                  <Metric label="Median (group)" value={check.medianGroup?.toFixed(4) ?? '—'} />
                  <Metric label="Median (rest)" value={check.medianRest?.toFixed(4) ?? '—'} />
                  <Metric label="Holds in both halves" value={check.halvesAgree === null || check.halvesAgree === undefined ? 'n/a' : check.halvesAgree ? 'yes' : 'no'} />
                  <Metric label="Last 60 days" value={check.recentEffect ? `${check.recentEffect.toFixed(2)}x` : 'n/a'} />
                </div>
                <div className="xs muted">
                  {check.dateRange ? `${check.dateRange.from.slice(0, 10)} → ${check.dateRange.to.slice(0, 10)} · ` : ''}
                  verdict: {check.verdict} · {check.testsRunThisPass ? `${check.testsRunThisPass} comparisons ran in this pass (multiple-comparison context) · ` : ''}
                  {check.supportiveStreak !== undefined ? `supportive streak ${check.supportiveStreak} · ` : ''}
                  evaluated {fmtDate(check.evaluatedAt ?? lesson.last_evaluated_at, true)}
                </div>
              </div>
            ) : (
              <Empty title="No calculated evidence">{lesson.origin === 'ai_analysis' ? 'A hypothesis from one post analysis (n=1). It needs repeated evidence.' : 'This lesson has no pattern BBO BRAIN can re-test automatically.'}</Empty>
            )}
            {lesson.evidence ? (
              <div className="card stack-xs" style={{ marginTop: '1rem' }}>
                <div className="kicker kicker-muted">{lesson.origin === 'imported_audit' ? 'From the weekly audit (verbatim)' : 'Evidence notes'}</div>
                <div className="small prose" style={{ whiteSpace: 'pre-wrap' }}>
                  {lesson.evidence}
                </div>
              </div>
            ) : null}
            {lesson.caveat ? <div className="callout callout-amber xs" style={{ marginTop: '1rem' }}>{lesson.caveat}</div> : null}
          </Section>

          <div className="grid-2">
            <Section title="Supporting posts">
              <div className="card stack-sm">
                {links.filter((l) => l.relation !== 'contradicting').length ? (
                  links
                    .filter((l) => l.relation !== 'contradicting')
                    .map((l) => (facts.get(l.content_id) ? <PostRow key={l.content_id} fact={facts.get(l.content_id)!} extra={l.relation === 'source' ? <span className="chip chip-gold">source</span> : null} /> : null))
                ) : (
                  <span className="small muted">None linked.</span>
                )}
              </div>
            </Section>
            <Section title="Contradicting posts">
              <div className="card stack-sm">
                {links.filter((l) => l.relation === 'contradicting').length ? (
                  links.filter((l) => l.relation === 'contradicting').map((l) => (facts.get(l.content_id) ? <PostRow key={l.content_id} fact={facts.get(l.content_id)!} /> : null))
                ) : (
                  <span className="small muted">None linked.</span>
                )}
              </div>
            </Section>
          </div>
        </div>

        <aside className="stack">
          <Section title="Belief history">
            <div className="card">
              <div className="timeline">
                {events.map((e, i) => (
                  <div key={i} className="timeline-item stack-xs">
                    <div className="row-tight xs">
                      <span className="mono muted">{fmtDate(e.occurred_at, true)}</span>
                      <StatusChip status={e.to_status} />
                      <Confidence label={e.to_confidence} />
                    </div>
                    <div className="xs muted">
                      {e.note}
                      {e.sample_size ? ` (n=${e.sample_size}${e.effect ? `, ${e.effect.toFixed(2)}x` : ''})` : ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          <Section title="Connected">
            <div className="card stack-xs small">
              {rule ? (
                <Link href={`/rules/${rule.id}`}>
                  Rule <span className="chip chip-gold">{rule.code}</span>
                </Link>
              ) : null}
              {proposal ? (
                <Link href="/proposals">
                  Rule proposal <StatusChip status={proposal.status} />
                </Link>
              ) : null}
              {experiment ? (
                <Link href={`/experiments/${experiment.id}`}>
                  Experiment <span className="chip chip-pink">{experiment.code}</span> {experiment.name} <StatusChip status={experiment.status} />
                </Link>
              ) : null}
              {lesson.next_test ? <div className="gold">Next test: {lesson.next_test}</div> : null}
              {!rule && !proposal && !experiment && !lesson.next_test ? <span className="muted">Not connected to a rule or experiment yet.</span> : null}
            </div>
          </Section>

          <Section title="Your call">
            <form action={setLessonStatusAction} className="card stack-sm">
              <input type="hidden" name="id" value={lesson.id} />
              <input type="hidden" name="back" value={`/lessons/${lesson.id}`} />
              <label className="field">
                <span className="field-label">Set status</span>
                <select name="status" className="select" defaultValue={lesson.status}>
                  {['NEW', 'OBSERVING', 'SUPPORTED', 'WEAKENED', 'CONTRADICTED', 'ARCHIVED'].map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Why</span>
                <input className="input" name="note" placeholder="e.g. confounded with topic" />
              </label>
              <SubmitButton className="btn">Save</SubmitButton>
              <span className="xs muted">Promotion to a rule only happens through a proposal you approve.</span>
            </form>
          </Section>
        </aside>
      </div>
    </>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="stack-xs">
      <span className="stat-label">{label}</span>
      <span className={`mono white ${tone ?? ''}`}>{value}</span>
    </div>
  );
}

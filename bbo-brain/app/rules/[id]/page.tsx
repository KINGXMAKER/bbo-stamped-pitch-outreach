import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Confidence, Empty, fmtDate, PageHead, PostRow, Section, StatusChip } from '@/components/ui';
import { all, get, getDb, parseJson } from '@/lib/db/client';
import { comparable, loadFacts } from '@/lib/intel/dataset';
import { describePattern, evaluatePattern, loadLabels, parsePattern, valueLabel } from '@/lib/intel/patterns';

export const dynamic = 'force-dynamic';

export default async function RuleDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const rule = get<{ id: number; code: string; category: string; status: string; pattern_json: string | null; current_version_id: number | null; created_at: string }>(db, 'SELECT * FROM rules WHERE id = ?', Number(id));
  if (!rule) notFound();
  const labels = loadLabels(db);
  const versions = all<{ id: number; version: number; text: string; reason: string | null; scope: string; applies_to_json: string; evidence_summary: string | null; proposed_by: string; proposal_id: number | null; activated_at: string | null; deactivated_at: string | null; superseded_by_version_id: number | null }>(
    db,
    'SELECT * FROM rule_versions WHERE rule_id = ? ORDER BY version DESC',
    rule.id
  );
  const current = versions.find((v) => v.id === rule.current_version_id) ?? versions[0];
  const pattern = parsePattern(rule.pattern_json);
  const facts = comparable(loadFacts(db));
  const evaluation = pattern ? evaluatePattern(facts, pattern) : null;
  const links = all<{ content_id: number; relation: string }>(db, 'SELECT content_id, relation FROM rule_content WHERE rule_id = ?', rule.id);
  const linkFacts = new Map(loadFacts(db, { contentIds: links.map((l) => l.content_id) }).map((f) => [f.contentId, f]));
  const challenges = all<{ id: number; summary: string; status: string; confidence_label: string | null; created_at: string; decided_at: string | null; decision_note: string | null }>(db, 'SELECT * FROM rule_challenges WHERE rule_id = ? ORDER BY id DESC', rule.id);
  const runs = all<{ id: number; workflow: string; model: string | null; status: string; created_at: string; version: number }>(
    db,
    `SELECT r.id, r.workflow, r.model, r.status, r.created_at, v.version FROM ai_run_rules arr JOIN ai_runs r ON r.id = arr.ai_run_id JOIN rule_versions v ON v.id = arr.rule_version_id WHERE v.rule_id = ? ORDER BY r.id DESC LIMIT 12`,
    rule.id
  );
  const applies = parseJson<{ workflows?: string[]; franchises?: string[]; platforms?: string[] }>(current?.applies_to_json ?? '{}', {});
  const c = evaluation?.comparison;

  return (
    <>
      <PageHead
        kicker={`${rule.code} · ${rule.category} · v${current?.version ?? '?'}`}
        title="Rule"
        lede={current?.text}
        actions={<StatusChip status={rule.status} />}
      />
      <div className="split">
        <div className="stack">
          <Section title="Evidence right now" note={pattern ? describePattern(labels, pattern) : undefined}>
            {c ? (
              <div className="card stack-sm">
                <div className="sowhat">
                  <div className="sowhat-text">
                    {c.verdict === 'insufficient'
                      ? `Not enough posts to test this rule yet (${c.nGroup} vs ${c.nRest}).`
                      : c.verdict === 'no_difference'
                        ? `BBO's data shows no meaningful difference right now (${c.effect?.toFixed(2)}x across ${c.nGroup} vs ${c.nRest} posts).`
                        : `The group this rule targets is at ${c.effect?.toFixed(2)}x the comparison median (${c.nGroup} vs ${c.nRest} posts).`}
                  </div>
                </div>
                <div className="row">
                  <Confidence label={c.confidence} />
                  <span className="xs muted">
                    consistency {c.consistency !== null ? `${Math.round(c.consistency * 100)}%` : '—'} · p {c.pValue?.toFixed(3) ?? '—'} · halves agree {c.halvesAgree === null ? 'n/a' : c.halvesAgree ? 'yes' : 'no'} · last 60d {c.recentEffect?.toFixed(2) ?? 'n/a'}x
                  </span>
                </div>
              </div>
            ) : (
              <Empty title="A principle, not a metric">This rule guides AI workflows but has no machine-checkable pattern, so it cannot be challenged automatically.</Empty>
            )}
          </Section>

          <Section title="Version history">
            <div className="card">
              <div className="timeline">
                {versions.map((v) => (
                  <div key={v.id} className={`timeline-item stack-xs ${v.deactivated_at ? 'muted-dot' : ''}`}>
                    <div className="row-tight xs">
                      <span className="chip">v{v.version}</span>
                      <span className="mono muted">{v.proposed_by}</span>
                      <span className="muted">active {fmtDate(v.activated_at, true)}</span>
                      {v.deactivated_at ? <span className="down">retired {fmtDate(v.deactivated_at, true)}</span> : <span className="up">current</span>}
                    </div>
                    <div className={`serif ${v.deactivated_at ? 'muted' : 'white'}`} style={{ fontSize: '1.05rem' }}>
                      {v.text}
                    </div>
                    {v.reason ? <div className="xs muted">{v.reason}</div> : null}
                    {v.evidence_summary ? <div className="xs gold">{v.evidence_summary}</div> : null}
                  </div>
                ))}
              </div>
            </div>
          </Section>

          <div className="grid-2">
            <Section title="Supporting posts">
              <div className="card stack-sm">
                {links.filter((l) => l.relation === 'supporting').slice(0, 8).map((l) => (linkFacts.get(l.content_id) ? <PostRow key={l.content_id} fact={linkFacts.get(l.content_id)!} /> : null))}
                {!links.some((l) => l.relation === 'supporting') ? <span className="small muted">None linked.</span> : null}
              </div>
            </Section>
            <Section title="Contradicting posts">
              <div className="card stack-sm">
                {links.filter((l) => l.relation === 'contradicting').slice(0, 8).map((l) => (linkFacts.get(l.content_id) ? <PostRow key={l.content_id} fact={linkFacts.get(l.content_id)!} /> : null))}
                {!links.some((l) => l.relation === 'contradicting') ? <span className="small muted">None linked.</span> : null}
              </div>
            </Section>
          </div>
        </div>

        <aside className="stack">
          <Section title="Scope">
            <div className="card stack-xs small">
              <div>
                <span className="muted">Workflows:</span> {applies.workflows?.join(', ') ?? 'all'}
              </div>
              <div>
                <span className="muted">Franchises:</span> {applies.franchises?.length ? applies.franchises.map((f) => valueLabel(labels, 'franchise', f)).join(', ') : 'all'}
              </div>
              <div>
                <span className="muted">Platforms:</span> {applies.platforms?.join(', ') ?? 'all'}
              </div>
            </div>
          </Section>
          <Section title="Challenges">
            <div className="card stack-sm">
              {challenges.length ? (
                challenges.map((ch) => (
                  <div key={ch.id} className="stack-xs">
                    <div className="row-tight">
                      <StatusChip status={ch.status} />
                      <Confidence label={ch.confidence_label} />
                      <span className="xs muted">{fmtDate(ch.created_at, true)}</span>
                    </div>
                    <div className="xs">{ch.summary}</div>
                    {ch.decision_note ? <div className="xs gold">{ch.decision_note}</div> : null}
                  </div>
                ))
              ) : (
                <span className="small muted">Never challenged.</span>
              )}
            </div>
          </Section>
          <Section title="AI runs that used it">
            <div className="card stack-xs xs">
              {runs.length ? (
                runs.map((r) => (
                  <Link key={r.id} href={`/runs/${r.id}`} className="spread">
                    <span>
                      #{r.id} {r.workflow} <span className="muted">(v{r.version})</span>
                    </span>
                    <span className="muted">{fmtDate(r.created_at)}</span>
                  </Link>
                ))
              ) : (
                <span className="muted">No AI run has loaded this rule yet.</span>
              )}
            </div>
          </Section>
        </aside>
      </div>
    </>
  );
}

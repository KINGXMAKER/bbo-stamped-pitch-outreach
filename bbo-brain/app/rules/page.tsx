import Link from 'next/link';
import { decideChallengeAction } from '@/app/actions';
import { JobButton, SubmitButton } from '@/components/client';
import { Notice } from '@/components/notice';
import { Confidence, Empty, fmtDate, PageHead, Section, StatusChip } from '@/components/ui';
import { all, getDb, parseJson } from '@/lib/db/client';
import { describePattern, loadLabels, parsePattern, valueLabel } from '@/lib/intel/patterns';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'BBO Rules' };

type RuleRow = {
  id: number;
  code: string;
  category: string;
  status: string;
  pattern_json: string | null;
  version: number;
  text: string;
  applies_to_json: string;
  proposed_by: string;
  activated_at: string | null;
  supporting: number;
  contradicting: number;
  runs: number;
};

export default async function Rules({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const db = getDb();
  const labels = loadLabels(db);
  const rules = all<RuleRow>(
    db,
    `SELECT r.id, r.code, r.category, r.status, r.pattern_json, rv.version, rv.text, rv.applies_to_json, rv.proposed_by, rv.activated_at,
            (SELECT COUNT(*) FROM rule_content rc WHERE rc.rule_id = r.id AND rc.relation = 'supporting') AS supporting,
            (SELECT COUNT(*) FROM rule_content rc WHERE rc.rule_id = r.id AND rc.relation = 'contradicting') AS contradicting,
            (SELECT COUNT(DISTINCT arr.ai_run_id) FROM ai_run_rules arr JOIN rule_versions v ON v.id = arr.rule_version_id WHERE v.rule_id = r.id) AS runs
     FROM rules r JOIN rule_versions rv ON rv.id = r.current_version_id ORDER BY r.status, r.code`
  );
  const challenges = all<{ id: number; rule_id: number; code: string; text: string; summary: string; new_evidence_json: string; supporting_json: string; contradicting_json: string; sample_size: number | null; confidence_label: string | null; created_at: string }>(
    db,
    `SELECT c.id, c.rule_id, r.code, rv.text, c.summary, c.new_evidence_json, c.supporting_json, c.contradicting_json, c.sample_size, c.confidence_label, c.created_at
     FROM rule_challenges c JOIN rules r ON r.id = c.rule_id JOIN rule_versions rv ON rv.id = c.rule_version_id WHERE c.status = 'open' ORDER BY c.id DESC`
  );
  const franchises = all<{ slug: string; name: string }>(db, 'SELECT slug, name FROM franchises ORDER BY name');
  const active = rules.filter((r) => r.status === 'active');
  const inactive = rules.filter((r) => r.status !== 'active');
  const categories = [...new Set(active.map((r) => r.category))];

  return (
    <>
      <Notice searchParams={sp as Record<string, string>} />
      <PageHead
        kicker="Operating rules"
        title="BBO Rules"
        lede={<>Versioned, scoped, and challengeable. Every AI run records the exact rule versions it received. Mirrored to <span className="mono">knowledge/CONSTRAINTS.md</span>.</>}
        actions={<JobButton kind="rule-challenges" label="Check rules against new data" className="btn" />}
      />

      {challenges.length ? (
        <Section title="Rules being challenged" note="new evidence disagrees">
          <div className="stack">
            {challenges.map((ch) => {
              const ev = parseJson<{ recent?: { effect?: number; nGroup?: number; nRest?: number; verdict?: string; dateRange?: { from: string; to: string } }; fullHistory?: { effect?: number; nGroup?: number; nRest?: number; verdict?: string }; expected?: string; windowDays?: number }>(ch.new_evidence_json, {});
              const supporting = parseJson<Array<{ contentId: number; title: string }>>(ch.supporting_json, []);
              const contradicting = parseJson<Array<{ contentId: number; title: string }>>(ch.contradicting_json, []);
              return (
                <article key={ch.id} id={`c${ch.id}`} className="card card-hero stack" style={{ borderColor: 'rgba(255,181,71,.4)' }}>
                  <div className="row">
                    <span className="chip chip-amber">Rule challenge</span>
                    <span className="mono gold">{ch.code}</span>
                    <Confidence label={ch.confidence_label} />
                    <span className="xs muted">opened {fmtDate(ch.created_at, true)}</span>
                  </div>
                  <div className="grid-2">
                    <div className="panel stack-xs">
                      <div className="kicker kicker-muted">Current rule</div>
                      <div className="serif white" style={{ fontSize: '1.2rem' }}>
                        {ch.text}
                      </div>
                    </div>
                    <div className="panel stack-xs">
                      <div className="kicker kicker-muted">New evidence</div>
                      <div className="small">{ch.summary}</div>
                      <div className="xs mono muted">
                        last {ev.windowDays}d: {ev.recent?.verdict} {ev.recent?.effect?.toFixed(2)}x ({ev.recent?.nGroup} vs {ev.recent?.nRest}) · all history: {ev.fullHistory?.verdict} {ev.fullHistory?.effect?.toFixed(2)}x ({ev.fullHistory?.nGroup} vs {ev.fullHistory?.nRest})
                      </div>
                    </div>
                  </div>
                  <div className="grid-2">
                    <div className="panel stack-xs">
                      <div className="kicker" style={{ color: 'var(--green)' }}>
                        Supporting content
                      </div>
                      {supporting.map((s) => (
                        <Link key={s.contentId} href={`/content/${s.contentId}`} className="xs clamp-2">
                          {s.title}
                        </Link>
                      ))}
                    </div>
                    <div className="panel stack-xs">
                      <div className="kicker" style={{ color: 'var(--red)' }}>
                        Contradicting content
                      </div>
                      {contradicting.map((s) => (
                        <Link key={s.contentId} href={`/content/${s.contentId}`} className="xs clamp-2">
                          {s.title}
                        </Link>
                      ))}
                    </div>
                  </div>
                  <form action={decideChallengeAction} className="stack-sm">
                    <input type="hidden" name="id" value={ch.id} />
                    <input type="hidden" name="back" value="/rules" />
                    <details className="disclose">
                      <summary>Narrow or replace the rule</summary>
                      <div className="stack-sm" style={{ marginTop: '.6rem' }}>
                        <label className="field">
                          <span className="field-label">New wording (replace, or narrow with new text)</span>
                          <textarea name="text" className="textarea" defaultValue={ch.text} style={{ minHeight: '3.5rem' }} />
                        </label>
                        <div className="field">
                          <span className="field-label">Narrow to franchises</span>
                          <div className="row-tight">
                            {franchises.map((f) => (
                              <label key={f.slug} className="chip" style={{ cursor: 'pointer' }}>
                                <input type="checkbox" name="franchises" value={f.slug} /> {f.name}
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    </details>
                    <input className="input" name="note" placeholder="Decision note" />
                    <div className="row">
                      <SubmitButton className="btn btn-green" name="action" value="keep">Keep rule</SubmitButton>
                      <SubmitButton className="btn btn-gold" name="action" value="narrow">Narrow rule</SubmitButton>
                      <SubmitButton className="btn btn-primary" name="action" value="replace">Replace rule</SubmitButton>
                      <SubmitButton className="btn btn-red" name="action" value="deactivate">Deactivate rule</SubmitButton>
                      <SubmitButton className="btn btn-ghost" name="action" value="observe">Keep observing</SubmitButton>
                    </div>
                  </form>
                </article>
              );
            })}
          </div>
        </Section>
      ) : null}

      {categories.map((cat) => (
        <Section key={cat} title={cat} note={`${active.filter((r) => r.category === cat).length} active`}>
          <div className="grid-2">
            {active
              .filter((r) => r.category === cat)
              .map((r) => {
                const pattern = parsePattern(r.pattern_json);
                const applies = parseJson<{ workflows?: string[]; franchises?: string[] }>(r.applies_to_json, {});
                return (
                  <Link key={r.id} href={`/rules/${r.id}`} className="card card-link stack-sm">
                    <div className="spread">
                      <span className="row-tight">
                        <span className="mono pink">{r.code}</span>
                        <span className="chip chip-muted">v{r.version}</span>
                        <span className={`chip ${r.proposed_by === 'seed' ? 'chip-muted' : 'chip-gold'}`}>{r.proposed_by === 'seed' ? 'founding rule' : `${r.proposed_by}-proposed`}</span>
                      </span>
                      <span className="xs muted">{r.runs} AI runs</span>
                    </div>
                    <p className="serif white" style={{ fontSize: '1.12rem', lineHeight: 1.3 }}>
                      {r.text}
                    </p>
                    <div className="row-tight xs muted">
                      <span>{applies.workflows?.includes('*') || !applies.workflows ? 'all workflows' : applies.workflows.join(', ')}</span>
                      {applies.franchises?.length ? <span>· {applies.franchises.map((f) => valueLabel(labels, 'franchise', f)).join(', ')}</span> : null}
                    </div>
                    <div className="xs">{pattern ? <span className="gold">Testable: {describePattern(labels, pattern)}</span> : <span className="muted">Principle — not measurable from metrics.</span>}</div>
                    {r.supporting || r.contradicting ? (
                      <div className="xs">
                        <span className="up">{r.supporting} supporting</span> · <span className="down">{r.contradicting} contradicting</span>
                      </div>
                    ) : null}
                  </Link>
                );
              })}
          </div>
        </Section>
      ))}

      {inactive.length ? (
        <Section title="Deactivated">
          <div className="stack-sm">
            {inactive.map((r) => (
              <Link key={r.id} href={`/rules/${r.id}`} className="card card-link row">
                <span className="mono muted">{r.code}</span>
                <StatusChip status={r.status} />
                <span className="small muted">{r.text}</span>
              </Link>
            ))}
          </div>
        </Section>
      ) : null}

      {!rules.length ? <Empty title="No rules">Rules are seeded on first boot.</Empty> : null}
    </>
  );
}

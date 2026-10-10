import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fmtDate, PageHead, Section, StatusChip } from '@/components/ui';
import { all, get, getDb } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

const pretty = (raw: string | null) => {
  if (!raw) return '—';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
};

export default async function RunDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const r = get<{ id: number; workflow: string; status: string; provider: string | null; model: string | null; prompt_version_id: number | null; skill_version_id: number | null; score_version_id: number | null; input_json: string; output_json: string | null; confidence: string | null; approval_state: string | null; error: string | null; latency_ms: number | null; usage_json: string | null; parent_run_id: number | null; created_at: string }>(
    db,
    'SELECT * FROM ai_runs WHERE id = ?',
    Number(id)
  );
  if (!r) notFound();
  const prompt = r.prompt_version_id ? get<{ slug: string; version: number; template: string; schema_version: string; checksum: string }>(db, 'SELECT * FROM prompt_versions WHERE id = ?', r.prompt_version_id) : null;
  const skill = r.skill_version_id ? get<{ slug: string; version: number; checksum: string }>(db, 'SELECT s.slug, sv.version, sv.checksum FROM skill_versions sv JOIN skills s ON s.id = sv.skill_id WHERE sv.id = ?', r.skill_version_id) : null;
  const score = r.score_version_id ? get<{ version: string }>(db, 'SELECT version FROM performance_score_versions WHERE id = ?', r.score_version_id) : null;
  const rules = all<{ id: number; code: string; version: number; text: string }>(db, 'SELECT r.id, r.code, rv.version, rv.text FROM ai_run_rules arr JOIN rule_versions rv ON rv.id = arr.rule_version_id JOIN rules r ON r.id = rv.rule_id WHERE arr.ai_run_id = ? ORDER BY r.code', r.id);
  const children = all<{ id: number; workflow: string; status: string }>(db, 'SELECT id, workflow, status FROM ai_runs WHERE parent_run_id = ?', r.id);

  return (
    <>
      <PageHead kicker={`AI run #${r.id} · ${fmtDate(r.created_at, true)}`} title={r.workflow.replace(/_/g, ' ')} lede={r.error ?? undefined} actions={<StatusChip status={r.status} />} />
      <div className="split">
        <div className="stack">
          <Section title="Structured output">
            <div className="card">
              <pre className="xs" style={{ whiteSpace: 'pre-wrap', maxHeight: '40rem', overflowY: 'auto' }}>
                {pretty(r.output_json)}
              </pre>
            </div>
          </Section>
          <Section title="Inputs & evidence references">
            <div className="card">
              <pre className="xs muted" style={{ whiteSpace: 'pre-wrap' }}>
                {pretty(r.input_json)}
              </pre>
            </div>
          </Section>
          {prompt ? (
            <Section title={`Prompt template · ${prompt.slug} v${prompt.version}`} note={`schema ${prompt.schema_version} · ${prompt.checksum}`}>
              <div className="card">
                <pre className="xs muted" style={{ whiteSpace: 'pre-wrap' }}>
                  {prompt.template}
                </pre>
              </div>
            </Section>
          ) : null}
        </div>
        <aside className="stack">
          <Section title="Provenance">
            <div className="card stack-xs small">
              <div>
                <span className="muted">Model:</span> <span className="mono">{r.model ?? '—'}</span> ({r.provider ?? '—'})
              </div>
              <div>
                <span className="muted">Skill:</span> <span className="mono">{skill ? `${skill.slug} v${skill.version}` : '—'}</span>
              </div>
              <div>
                <span className="muted">Score version:</span> <span className="mono">{score?.version ?? '—'}</span>
              </div>
              <div>
                <span className="muted">Latency:</span> {r.latency_ms ? `${(r.latency_ms / 1000).toFixed(1)}s` : '—'}
              </div>
              <div>
                <span className="muted">Confidence:</span> {r.confidence ?? '—'}
              </div>
              <div>
                <span className="muted">Usage:</span> <span className="mono xs">{r.usage_json ?? 'not reported'}</span>
              </div>
              {r.parent_run_id ? (
                <Link href={`/runs/${r.parent_run_id}`} className="pink">
                  Parent run #{r.parent_run_id}
                </Link>
              ) : null}
              {children.map((c) => (
                <Link key={c.id} href={`/runs/${c.id}`} className="pink">
                  Child run #{c.id} {c.workflow} ({c.status})
                </Link>
              ))}
            </div>
          </Section>
          <Section title="Rule versions loaded" note={`${rules.length}`}>
            <div className="card stack-xs">
              {rules.length ? (
                rules.map((x) => (
                  <Link key={`${x.code}${x.version}`} href={`/rules/${x.id}`} className="xs">
                    <span className="mono pink">
                      {x.code} v{x.version}
                    </span>{' '}
                    {x.text}
                  </Link>
                ))
              ) : (
                <span className="xs muted">No rules were loaded for this workflow.</span>
              )}
            </div>
          </Section>
        </aside>
      </div>
    </>
  );
}

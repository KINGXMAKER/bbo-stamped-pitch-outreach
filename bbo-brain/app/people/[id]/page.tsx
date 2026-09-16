import { notFound } from 'next/navigation';
import { setPersonAction } from '@/app/actions';
import { SubmitButton } from '@/components/client';
import { Notice } from '@/components/notice';
import { Confidence, fmtDate, PageHead, PostRow, Section } from '@/components/ui';
import { getDb } from '@/lib/db/client';
import { personDetail } from '@/lib/intel/queries';

export const dynamic = 'force-dynamic';

export default async function PersonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const d = personDetail(getDb(), Number(id));
  if (!d) notFound();
  const c = d.comparison;

  return (
    <>
      <Notice searchParams={sp as Record<string, string>} />
      <PageHead
        kicker={`${d.person.type}${d.person.instagram_handle ? ` · @${d.person.instagram_handle}` : ''} · last seen ${fmtDate(d.lastAppearance, true)}`}
        title={d.person.canonical_name}
        lede={d.verdict.text}
        actions={
          d.person.instagram_handle ? (
            <a className="btn btn-sm" href={`https://www.instagram.com/${d.person.instagram_handle}/`} target="_blank" rel="noreferrer">
              Instagram ↗
            </a>
          ) : null
        }
      />
      <div className="split">
        <div className="stack">
          <Section title="Against BBO's baseline">
            <div className="card grid-4">
              <Metric label="Appearances" value={String(d.appearances.length)} />
              <Metric label="Median score" value={c.medianGroup?.toFixed(2) ?? '—'} tone={c.medianGroup && c.medianGroup >= 1.15 ? 'up' : c.medianGroup && c.medianGroup <= 0.85 ? 'down' : undefined} />
              <Metric label="vs everyone else" value={c.effect ? `${c.effect.toFixed(2)}x` : '—'} />
              <div className="stack-xs">
                <span className="stat-label">Signal</span>
                <Confidence label={c.confidence} />
              </div>
            </div>
          </Section>
          <div className="grid-3">
            <Breakdown title="Topics that work with them" rows={d.byTopic} />
            <Breakdown title="Hook styles" rows={d.byHook} />
            <Breakdown title="Franchises" rows={d.byFranchise} />
          </div>
          <div className="grid-2">
            <Section title="Strongest content">
              <div className="card stack-sm">{d.strongest.length ? d.strongest.map((f) => <PostRow key={f.contentId} fact={f} />) : <span className="small muted">No scored appearances.</span>}</div>
            </Section>
            <Section title="Weakest content">
              <div className="card stack-sm">{d.weakest.length ? d.weakest.map((f) => <PostRow key={f.contentId} fact={f} />) : <span className="small muted">No scored appearances.</span>}</div>
            </Section>
          </div>
          <Section title="Every appearance" note={`${d.appearances.length}`}>
            <div className="card stack-sm">
              {d.appearances.map((f) => (
                <PostRow key={f.contentId} fact={f} />
              ))}
            </div>
          </Section>
        </div>
        <aside className="stack">
          <Section title="Profile">
            <form action={setPersonAction} className="card stack-sm">
              <input type="hidden" name="id" value={d.person.id} />
              <label className="field">
                <span className="field-label">Canonical name</span>
                <input className="input" name="name" defaultValue={d.person.canonical_name} />
              </label>
              <div className="grid-2">
                <label className="field">
                  <span className="field-label">Type</span>
                  <select className="select" name="type" defaultValue={d.person.type}>
                    {['guest', 'host', 'cast', 'creator', 'editor', 'other'].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Gender</span>
                  <select className="select" name="gender" defaultValue={d.person.gender ?? ''}>
                    <option value="">unknown</option>
                    {['female', 'male', 'nonbinary'].map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="field">
                <span className="field-label">Notes</span>
                <textarea className="textarea" name="notes" defaultValue={d.person.notes ?? ''} style={{ minHeight: '4rem' }} />
              </label>
              <SubmitButton className="btn">Save</SubmitButton>
              <span className="xs muted">Gender powers questions like “which topics work when the guest is male?”.</span>
            </form>
          </Section>
          <Section title="Aliases">
            <div className="card row-tight">
              {d.aliases.map((a) => (
                <span key={a.alias} className="chip" title={a.source}>
                  {a.alias}
                </span>
              ))}
            </div>
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
      <span className={`stat-value ${tone ?? ''}`} style={{ fontSize: '2rem' }}>
        {value}
      </span>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: Array<{ value: string; n: number; medianScore: number | null }> }) {
  return (
    <Section title={title}>
      <div className="card stack-xs">
        {rows.length ? (
          rows.slice(0, 8).map((r) => (
            <div key={r.value} className="spread small">
              <span>{r.value}</span>
              <span className="mono">
                <span className={r.medianScore && r.medianScore >= 1.15 ? 'up' : r.medianScore && r.medianScore <= 0.85 ? 'down' : ''}>{r.medianScore?.toFixed(2) ?? '—'}</span> <span className="muted xs">n={r.n}</span>
              </span>
            </div>
          ))
        ) : (
          <span className="xs muted">No coded data.</span>
        )}
      </div>
    </Section>
  );
}

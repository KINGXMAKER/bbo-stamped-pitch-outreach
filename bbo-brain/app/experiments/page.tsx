import Link from 'next/link';
import { createExperimentAction } from '@/app/actions';
import { JobButton, SubmitButton } from '@/components/client';
import { Notice } from '@/components/notice';
import { Confidence, Empty, PageHead, Section, StatusChip } from '@/components/ui';
import { all, getDb } from '@/lib/db/client';
import { METRIC_DEFS } from '@/lib/intel/dataset';
import { ATTRIBUTE_DEFINITIONS } from '@/lib/seed/reference';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Experiments' };

type Row = { id: number; code: string; name: string; hypothesis: string; variable_key: string | null; control_value: string | null; variant_value: string | null; primary_metric: string; status: string; origin: string; result_summary: string | null; confidence_label: string | null; control_n: number; variant_n: number; min_sample_per_arm: number };

const ORDER = ['running', 'proposed', 'completed', 'abandoned'];

export default async function Experiments({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const db = getDb();
  const rows = all<Row>(
    db,
    `SELECT e.*, (SELECT COUNT(*) FROM experiment_content ec WHERE ec.experiment_id = e.id AND ec.arm = 'control') AS control_n,
            (SELECT COUNT(*) FROM experiment_content ec WHERE ec.experiment_id = e.id AND ec.arm = 'variant') AS variant_n
     FROM experiments e ORDER BY e.id DESC`
  );
  const variables = ATTRIBUTE_DEFINITIONS.filter((a) => (a.type === 'enum' || a.type === 'boolean') && a.group !== 'audit');
  const franchises = all<{ slug: string; name: string }>(db, 'SELECT slug, name FROM franchises ORDER BY name');
  const topics = all<{ slug: string; name: string }>(db, 'SELECT slug, name FROM topics ORDER BY name');

  return (
    <>
      <Notice searchParams={sp as Record<string, string>} />
      <PageHead
        kicker="Experiment engine"
        title="Experiments"
        lede={<>When a pattern is interesting but the evidence is thin, BBO tests it on purpose. Results become lessons; strong results can become rules.</>}
        actions={<JobButton kind="experiments" label="Re-evaluate running tests" className="btn" />}
      />

      <div className="split">
        <div className="stack">
          {!rows.length ? <Empty title="No experiments yet" /> : null}
          {ORDER.map((status) => {
            const list = rows.filter((r) => r.status === status);
            if (!list.length) return null;
            return (
              <Section key={status} title={status} note={`${list.length}`}>
                <div className="stack-sm">
                  {list.map((e) => (
                    <Link key={e.id} href={`/experiments/${e.id}`} className={`card card-link stack-xs ${status === 'running' ? 'card-pink' : ''}`}>
                      <div className="row-tight">
                        <span className="mono pink">{e.code}</span>
                        <StatusChip status={e.status} />
                        <span className="chip chip-muted">{e.origin.replace(/_/g, ' ')}</span>
                        {e.confidence_label ? <Confidence label={e.confidence_label} /> : null}
                      </div>
                      <div className="card-title">{e.name}</div>
                      <div className="small muted clamp-2">{e.hypothesis}</div>
                      <div className="row-tight xs">
                        {e.variable_key ? (
                          <span className="chip">
                            {e.variable_key.replace(/_/g, ' ')}: {e.control_value?.replace(/_/g, ' ')} → {e.variant_value?.replace(/_/g, ' ')}
                          </span>
                        ) : (
                          <span className="chip chip-amber">manual assignment</span>
                        )}
                        <span className="chip">{METRIC_DEFS[e.primary_metric as keyof typeof METRIC_DEFS]?.label ?? e.primary_metric}</span>
                        <span className="muted">
                          variant {e.variant_n}/{e.min_sample_per_arm} · control {e.control_n}/{e.min_sample_per_arm}
                        </span>
                      </div>
                      {e.result_summary ? <div className="xs gold">{e.result_summary}</div> : null}
                    </Link>
                  ))}
                </div>
              </Section>
            );
          })}
        </div>

        <aside className="stack">
          <Section title="New experiment">
            <form action={createExperimentAction} className="card stack-sm">
              <label className="field">
                <span className="field-label">Name</span>
                <input className="input" name="name" required placeholder="Guest-answer opening vs interviewer question" />
              </label>
              <label className="field">
                <span className="field-label">Hypothesis</span>
                <textarea className="textarea" name="hypothesis" required style={{ minHeight: '4rem' }} placeholder="Opening on the guest's answer holds viewers longer than opening on the question." />
              </label>
              <label className="field">
                <span className="field-label">Variable (auto-assigns by attribute)</span>
                <select className="select" name="variableKey" defaultValue="">
                  <option value="">Manual assignment</option>
                  {variables.map((v) => (
                    <option key={v.key} value={v.key}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid-2">
                <label className="field">
                  <span className="field-label">Control value</span>
                  <input className="input" name="controlValue" placeholder="interviewer" list="attr-values" />
                </label>
                <label className="field">
                  <span className="field-label">Variant value</span>
                  <input className="input" name="variantValue" placeholder="guest" list="attr-values" />
                </label>
              </div>
              <datalist id="attr-values">
                {[...new Set(variables.flatMap((v) => (v.type === 'boolean' ? ['true', 'false'] : v.values ?? [])))].map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
              <label className="field">
                <span className="field-label">Primary metric</span>
                <select className="select" name="primaryMetric" defaultValue="retention">
                  {Object.entries(METRIC_DEFS).map(([k, d]) => (
                    <option key={k} value={k}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid-2">
                <label className="field">
                  <span className="field-label">Franchise</span>
                  <select className="select" name="franchise" defaultValue="">
                    <option value="">Any</option>
                    {franchises.map((f) => (
                      <option key={f.slug} value={f.slug}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Topic</span>
                  <select className="select" name="topic" defaultValue="">
                    <option value="">Any</option>
                    {topics.map((t) => (
                      <option key={t.slug} value={t.slug}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="field">
                <span className="field-label">Posts needed per arm</span>
                <input className="input" type="number" name="minSamplePerArm" defaultValue={5} min={3} max={50} />
              </label>
              <SubmitButton className="btn btn-primary">Create experiment</SubmitButton>
            </form>
          </Section>
        </aside>
      </div>
    </>
  );
}

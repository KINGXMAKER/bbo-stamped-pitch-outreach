import Link from 'next/link';
import { saveTriggersAction } from '@/app/actions';
import { JobButton, SubmitButton } from '@/components/client';
import { Notice } from '@/components/notice';
import { fmtDate, PageHead, Section, StatusChip } from '@/components/ui';
import { all, get, getDb, parseJson } from '@/lib/db/client';
import { brainConfig } from '@/lib/config';
import { budgetStatus } from '@/lib/ai/budget';
import { candidatesFor, providerSummary } from '@/lib/ai/providers/registry';
import { TASK_CLASSES } from '@/lib/ai/providers/types';
import { getSetting } from '@/lib/seed';
import { DAILY_PIPELINE, JOBS } from '@/lib/sync/registry';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings & Integrations' };

export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const db = getDb();
  const cfg = brainConfig();
  const integrations = all<{ id: string; name: string; provider: string; status: string; account_ref: string | null; capabilities_json: string; limitations_json: string; last_sync_at: string | null; last_success_at: string | null; records_synced: number; last_error: string | null }>(
    db,
    `SELECT * FROM integrations ORDER BY CASE status WHEN 'needs_attention' THEN 0 WHEN 'connected' THEN 1 ELSE 2 END, name`
  );
  const jobs = all<{ id: number; kind: string; status: string; records_seen: number; records_written: number; error: string | null; started_at: string; finished_at: string | null; attempts: number }>(db, 'SELECT * FROM sync_jobs ORDER BY id DESC LIMIT 40');
  const triggers = getSetting<{ scoreHigh: number; scoreLow: number; componentHigh: number; retentionLow: number; requireMature: boolean; maxPerRun: number }>(db, 'analysis_triggers');
  const gate = getSetting<{ passMark: number; maxAutoRetries: number }>(db, 'gatekeeper');
  const pendingEntities = get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM entity_resolution_candidates WHERE status = 'pending'`)!.n;
  const env = [
    ['COMPOSIO_API_KEY', Boolean(cfg.composioApiKey)],
    ['GEMINI_API_KEY', Boolean(cfg.geminiApiKey)],
    ['OPENROUTER_API_KEY', Boolean(cfg.openRouterApiKey)],
    ['NVIDIA_API_KEY', Boolean(cfg.nvidiaApiKey)],
    ['BRAIN_ACCESS_PASSWORD', Boolean(cfg.accessPassword)],
  ] as const;
  const budget = budgetStatus(db);
  const providers = providerSummary();
  const routing = TASK_CLASSES.map((task) => ({ task, candidates: candidatesFor(task).slice(0, 3).map((c) => `${c.provider.providerName}/${c.model}`) }));
  const spendByModel = all<{ provider: string | null; model: string | null; runs: number; cost: number }>(
    db,
    `SELECT provider, model, COUNT(*) AS runs, SUM(estimated_cost_usd) AS cost FROM ai_runs
     WHERE created_at >= date('now','start of month') GROUP BY provider, model ORDER BY cost DESC, runs DESC LIMIT 8`
  );

  return (
    <>
      <Notice searchParams={sp as Record<string, string>} />
      <PageHead
        kicker="Settings / Integrations"
        title="The plumbing"
        lede={<>What is connected, what it can and cannot provide, and every sync job on the record. Limitations are listed plainly instead of being papered over.</>}
        actions={
          <>
            <JobButton kind="integration-check" label="Check connections" className="btn" />
            <JobButton kind="daily" label="Run daily loop" className="btn btn-primary" />
          </>
        }
      />

      <Section title="Integrations">
        <div className="grid-auto">
          {integrations.map((i) => (
            <article key={i.id} className={`card stack-sm ${i.status === 'connected' ? 'card-green' : i.status === 'needs_attention' ? 'card-red' : ''}`}>
              <div className="spread">
                <span className="card-title">{i.name}</span>
                <StatusChip status={i.status} />
              </div>
              {i.account_ref ? <div className="mono xs muted">{i.account_ref}</div> : null}
              <div className="xs">
                {parseJson<string[]>(i.capabilities_json, []).map((c) => (
                  <div key={c} className="up">
                    ✓ {c}
                  </div>
                ))}
                {parseJson<string[]>(i.limitations_json, []).map((c) => (
                  <div key={c} className="muted">
                    ✗ {c}
                  </div>
                ))}
              </div>
              <div className="xs muted">
                Last sync {fmtDate(i.last_sync_at, true)} · last success {fmtDate(i.last_success_at, true)} · {i.records_synced.toLocaleString()} records
              </div>
              {i.last_error ? <div className="xs down">{i.last_error}</div> : null}
            </article>
          ))}
        </div>
      </Section>

      <div className="split section">
        <div className="stack">
          <Section title="Sync engine" note={`daily: ${DAILY_PIPELINE.length} steps`}>
            <div className="card stack-sm">
              <div className="row-tight">
                {Object.entries(JOBS).map(([kind, def]) => (
                  <JobButton key={kind} kind={kind} label={def.label} note={def.description} />
                ))}
              </div>
              <p className="xs muted">
                Scheduling: <span className="mono">npm run job -- daily</span> from launchd or cron. Jobs are idempotent (dedupe on platform + post id, append-only metrics), retry transient failures, and one of each kind runs at a time.
              </p>
            </div>
          </Section>
          <Section title="Job log">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Job</th>
                    <th>Status</th>
                    <th className="num">Seen</th>
                    <th className="num">Written</th>
                    <th>Started</th>
                    <th>Summary / error</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id}>
                      <td className="mono small">{j.id}</td>
                      <td className="mono small">{j.kind}</td>
                      <td>
                        <StatusChip status={j.status} />
                      </td>
                      <td className="num">{j.records_seen.toLocaleString()}</td>
                      <td className="num">{j.records_written.toLocaleString()}</td>
                      <td className="small nowrap">{new Date(j.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                      <td className={`xs ${j.status === 'failed' ? 'down' : 'muted'}`}>{j.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>

        <aside className="stack">
          <Section title="Analysis & Gatekeeper">
            <form action={saveTriggersAction} className="card stack-sm">
              <div className="grid-2">
                <Num name="scoreHigh" label="Analyse when score ≥" value={triggers.scoreHigh} step="0.05" />
                <Num name="scoreLow" label="…or score ≤" value={triggers.scoreLow} step="0.05" />
                <Num name="componentHigh" label="Shares/comments/retention ≥ x peers" value={triggers.componentHigh} step="0.1" />
                <Num name="retentionLow" label="Retention ≤ x peers" value={triggers.retentionLow} step="0.05" />
                <Num name="maxPerRun" label="Max analyses per run" value={triggers.maxPerRun} step="1" />
                <label className="field">
                  <span className="field-label">Only mature posts</span>
                  <input type="checkbox" name="requireMature" defaultChecked={triggers.requireMature} />
                </label>
                <Num name="passMark" label="Gatekeeper pass mark /60" value={gate.passMark} step="1" />
                <Num name="maxAutoRetries" label="Automatic revisions" value={gate.maxAutoRetries} step="1" />
              </div>
              <SubmitButton className="btn btn-primary">Save</SubmitButton>
            </form>
          </Section>
          <Section title="More settings">
            <div className="card stack-sm">
              <Link href="/settings/entities" className="spread">
                <span>Entity resolution review</span>
                {pendingEntities ? <span className="nav-count">{pendingEntities}</span> : <span className="xs muted">clear</span>}
              </Link>
              <Link href="/settings/skills">Skills (versioned)</Link>
              <Link href="/performance">Performance score versions</Link>
              <Link href="/runs">AI agent runs</Link>
            </div>
          </Section>
          <Section title="AI providers" note={budget.paused ? 'BUDGET PAUSED' : `$${budget.dayUsd.toFixed(4)} today`}>
            <div className="card stack-xs xs">
              {providers.map((p) => (
                <div key={p.provider} className="spread">
                  <span className="mono">{p.provider}</span>
                  <span className={p.configured ? 'up' : 'muted'}>{p.configured ? p.models[0] ?? 'configured' : 'no key'}</span>
                </div>
              ))}
              <div className="divider" />
              {routing.map((r) => (
                <div key={r.task} className="stack-xs">
                  <span className="muted">{r.task}</span>
                  <span className="mono clamp-2">{r.candidates.join(' → ') || 'nothing configured'}</span>
                </div>
              ))}
            </div>
            <div className="card stack-xs xs" style={{ marginTop: '.6rem' }}>
              <div className="spread">
                <span className="muted">Today</span>
                <span className="mono">${budget.dayUsd.toFixed(4)} / ${budget.dayLimitUsd.toFixed(2)}</span>
              </div>
              <div className="spread">
                <span className="muted">This month</span>
                <span className="mono">${budget.monthUsd.toFixed(4)} / ${budget.monthLimitUsd.toFixed(2)}</span>
              </div>
              <div className="spread">
                <span className="muted">Per job ceiling</span>
                <span className="mono">${budget.jobLimitUsd.toFixed(2)}</span>
              </div>
              {budget.paused ? <span className="down">BUDGET PAUSED — {budget.reason}. Non-AI jobs keep running.</span> : null}
              {spendByModel.length ? (
                <>
                  <div className="divider" />
                  {spendByModel.map((m) => (
                    <div key={`${m.provider}:${m.model}`} className="spread">
                      <span className="mono clamp-2" style={{ maxWidth: '11rem' }}>
                        {m.provider ?? '—'}/{m.model ?? '—'}
                      </span>
                      <span className="muted">
                        {m.runs} runs · ${(m.cost ?? 0).toFixed(4)}
                      </span>
                    </div>
                  ))}
                </>
              ) : null}
            </div>
            <div className="row-tight" style={{ marginTop: '.6rem' }}>
              <JobButton kind="provider-health" label="Check providers" className="btn btn-sm" />
            </div>
          </Section>
          <Section title="Environment">
            <div className="card stack-xs xs">
              {env.map(([name, set]) => (
                <div key={name} className="spread">
                  <span className="mono">{name}</span>
                  <span className={set ? 'up' : 'muted'}>{set ? 'set' : 'not set'}</span>
                </div>
              ))}
              <div className="spread">
                <span className="mono">Gemini models</span>
                <span className="muted">{cfg.geminiModels.join(' → ')}</span>
              </div>
              <div className="spread">
                <span className="mono">Media dir</span>
                <span className="muted clamp-2" style={{ maxWidth: '12rem' }}>
                  {cfg.mediaDir}
                </span>
              </div>
              <span className="muted">Values are never displayed. Secrets live in the repo-root .env and bbo-brain/.env.local.</span>
            </div>
          </Section>
        </aside>
      </div>
    </>
  );
}

function Num({ name, label, value, step }: { name: string; label: string; value: number; step: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input className="input" type="number" name={name} defaultValue={value} step={step} />
    </label>
  );
}

import { get, json, nowIso, run, type Db } from '@/lib/db/client';
import { SourceError } from '@/lib/adapters/types';

export type JobLog = (message: string, data?: Record<string, unknown>) => void;

export type JobContext = {
  db: Db;
  log: JobLog;
  params: Record<string, unknown>;
};

export type JobOutcome = {
  recordsSeen: number;
  recordsWritten: number;
  /** Some records failed but the job made real progress. */
  partial?: boolean;
  summary?: string;
};

export type JobRecord = {
  id: number;
  kind: string;
  status: 'running' | 'succeeded' | 'partial' | 'failed' | 'skipped';
  recordsSeen: number;
  recordsWritten: number;
  error: string | null;
  summary: string | null;
};

const STALE_MS = 2 * 60 * 60 * 1000;

/**
 * Runs one job with a sync_jobs record, a concurrency guard per kind, and up to
 * `maxAttempts` retries for transient source failures. Non-transient failures
 * are recorded once, with the error, and not retried.
 */
export async function runJob(
  db: Db,
  kind: string,
  params: Record<string, unknown>,
  fn: (ctx: JobContext) => Promise<JobOutcome>,
  options: { maxAttempts?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<JobRecord> {
  // A job stuck in 'running' past the stale window crashed; release its lock.
  run(
    db,
    `UPDATE sync_jobs SET status = 'failed', error = 'Abandoned (process ended before the job finished).', finished_at = ?
     WHERE kind = ? AND status = 'running' AND started_at < ?`,
    nowIso(),
    kind,
    new Date(Date.now() - STALE_MS).toISOString()
  );
  const active = get<{ id: number }>(db, `SELECT id FROM sync_jobs WHERE kind = ? AND status = 'running'`, kind);
  if (active) {
    return { id: active.id, kind, status: 'skipped', recordsSeen: 0, recordsWritten: 0, error: 'A job of this kind is already running.', summary: null };
  }

  const maxAttempts = options.maxAttempts ?? 3;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const logs: Array<{ at: string; message: string; data?: Record<string, unknown> }> = [];
  const { lastId: id } = run(
    db,
    `INSERT INTO sync_jobs (kind, status, params_json, started_at) VALUES (?, 'running', ?, ?)`,
    kind,
    json(params),
    nowIso()
  );
  const log: JobLog = (message, data) => {
    if (logs.length < 300) logs.push({ at: nowIso(), message, data });
  };

  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      const outcome = await fn({ db, log, params });
      const status = outcome.partial ? 'partial' : 'succeeded';
      run(
        db,
        `UPDATE sync_jobs SET status = ?, attempts = ?, records_seen = ?, records_written = ?, log_json = ?, finished_at = ?, error = ? WHERE id = ?`,
        status,
        attempt,
        outcome.recordsSeen,
        outcome.recordsWritten,
        json(logs),
        nowIso(),
        outcome.summary ?? null,
        id
      );
      return { id, kind, status, recordsSeen: outcome.recordsSeen, recordsWritten: outcome.recordsWritten, error: null, summary: outcome.summary ?? null };
    } catch (err) {
      const transient = err instanceof SourceError && err.kind === 'transient';
      const message = err instanceof Error ? err.message : String(err);
      log(`attempt ${attempt} failed`, { message, transient });
      if (transient && attempt < maxAttempts) {
        await sleep(2000 * attempt);
        continue;
      }
      run(
        db,
        `UPDATE sync_jobs SET status = 'failed', attempts = ?, error = ?, log_json = ?, finished_at = ? WHERE id = ?`,
        attempt,
        message.slice(0, 1000),
        json(logs),
        nowIso(),
        id
      );
      return { id, kind, status: 'failed', recordsSeen: 0, recordsWritten: 0, error: message, summary: null };
    }
  }
}

export function markIntegration(
  db: Db,
  id: string,
  patch: { status?: 'connected' | 'not_connected' | 'needs_attention'; success?: boolean; records?: number; error?: string | null; accountRef?: string }
): void {
  const now = nowIso();
  run(
    db,
    `UPDATE integrations SET
       status = COALESCE(?, status),
       account_ref = COALESCE(?, account_ref),
       last_sync_at = ?,
       last_success_at = CASE WHEN ? THEN ? ELSE last_success_at END,
       records_synced = records_synced + ?,
       last_error = CASE WHEN ? THEN NULL ELSE COALESCE(?, last_error) END,
       updated_at = ?
     WHERE id = ?`,
    patch.status ?? null,
    patch.accountRef ?? null,
    now,
    patch.success ? 1 : 0,
    now,
    patch.records ?? 0,
    patch.success ? 1 : 0,
    patch.error ?? null,
    now,
    id
  );
}

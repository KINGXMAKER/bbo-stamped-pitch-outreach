import { NextResponse } from 'next/server';
import { all, getDb } from '@/lib/db/client';
import { JOBS, runNamedJob, runPipeline } from '@/lib/sync/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Latest job per kind (or one kind) — polled by the job buttons. */
export async function GET(req: Request) {
  const kind = new URL(req.url).searchParams.get('kind');
  const db = getDb();
  const rows = kind
    ? all(db, 'SELECT id, kind, status, records_seen, records_written, error, started_at, finished_at FROM sync_jobs WHERE kind = ? ORDER BY id DESC LIMIT 1', kind)
    : all(db, 'SELECT id, kind, status, records_seen, records_written, error, started_at, finished_at FROM sync_jobs WHERE id IN (SELECT MAX(id) FROM sync_jobs GROUP BY kind)');
  return NextResponse.json({ jobs: rows });
}

const BodySchema = (body: unknown): { kind: string; params: Record<string, unknown> } | null => {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.kind !== 'string') return null;
  if (b.kind !== 'daily' && !(b.kind in JOBS)) return null;
  const params = b.params && typeof b.params === 'object' && !Array.isArray(b.params) ? (b.params as Record<string, unknown>) : {};
  return { kind: b.kind, params };
};

/** Starts a job in the background and returns immediately; progress is read from sync_jobs. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }
  const parsed = BodySchema(body);
  if (!parsed) return NextResponse.json({ error: 'Unknown job.' }, { status: 400 });
  const db = getDb();
  const task = parsed.kind === 'daily' ? runPipeline(db) : runNamedJob(db, parsed.kind, parsed.params);
  task.catch((err) => console.error(`[bbo-brain] job ${parsed.kind} crashed`, err));
  return NextResponse.json({ started: true, kind: parsed.kind }, { status: 202 });
}

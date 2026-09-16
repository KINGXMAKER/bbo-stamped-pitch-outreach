'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

export function SubmitButton({ children, className = 'btn', pendingText, name, value }: { children: React.ReactNode; className?: string; pendingText?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} name={name} value={value} aria-busy={pending}>
      {pending ? <span className="pulse">{pendingText ?? 'Working…'}</span> : children}
    </button>
  );
}

type JobRow = { status: string; error: string | null; finished_at: string | null; records_written: number };

/** Starts a background job and refreshes the page as it finishes. */
export function JobButton({ kind, params, label, className = 'btn btn-sm', note }: { kind: string; params?: Record<string, unknown>; label: string; className?: string; note?: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  async function start() {
    setState('running');
    setMessage(null);
    const startedAt = new Date().toISOString();
    const res = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, params }) });
    if (!res.ok) {
      setState('failed');
      setMessage((await res.json().catch(() => ({ error: 'Could not start the job.' }))).error);
      return;
    }
    if (kind === 'daily') {
      setMessage('Daily pipeline started — steps appear in the job log as they finish.');
      setState('done');
      return;
    }
    timer.current = setInterval(async () => {
      const r = await fetch(`/api/jobs?kind=${encodeURIComponent(kind)}`).then((x) => x.json()).catch(() => null);
      const job: (JobRow & { started_at: string }) | undefined = r?.jobs?.[0];
      if (!job || job.started_at < startedAt || job.status === 'running') return;
      if (timer.current) clearInterval(timer.current);
      setState(job.status === 'failed' ? 'failed' : 'done');
      setMessage(job.status === 'failed' ? job.error : `Done — ${job.records_written} records written.`);
      router.refresh();
    }, 2500);
  }

  return (
    <span className="stack-xs">
      <button type="button" className={className} onClick={start} disabled={state === 'running'} title={note}>
        {state === 'running' ? <span className="pulse">Running…</span> : label}
      </button>
      {message ? <span className={`xs ${state === 'failed' ? 'down' : 'muted'}`}>{message}</span> : null}
    </span>
  );
}

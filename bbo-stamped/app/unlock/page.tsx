'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function UnlockForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!password.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, next: params.get('next') ?? '/' }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; next?: string; error?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? 'Could not unlock.');
        return;
      }
      router.replace(payload.next ?? '/');
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-screen)',
      }}
    >
      <div style={{ width: 'min(380px, 100%)' }}>
        <div className="wordmark" style={{ fontSize: '2rem', marginBottom: 6 }}>
          BBO STAMPED
        </div>
        <p className="masthead-sub" style={{ marginBottom: 28 }}>
          Reel production OS
        </p>

        <form onSubmit={submit} className="card card-accent">
          <label className="field">
            <span className="field-label">Access password</span>
            <input
              className="input"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter to continue"
            />
          </label>

          {error ? (
            <p className="error-box" role="alert" style={{ marginTop: 14 }}>
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="btn-primary"
            style={{ marginTop: 18 }}
            disabled={busy || !password.trim()}
          >
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </form>

        <p className="small muted" style={{ marginTop: 16, textAlign: 'center' }}>
          This gate exists so the AI keys behind this URL cannot be spent by anyone who finds the
          link.
        </p>
      </div>
    </main>
  );
}

export default function UnlockPage() {
  return (
    <Suspense fallback={null}>
      <UnlockForm />
    </Suspense>
  );
}

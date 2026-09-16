'use client';

import { useState } from 'react';

export default function Unlock() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    const next = new URLSearchParams(window.location.search).get('next') ?? '/';
    const res = await fetch('/api/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: form.get('password'), next }) });
    const body = await res.json().catch(() => ({ error: 'Something went wrong.' }));
    if (res.ok) window.location.href = body.next ?? '/';
    else {
      setError(body.error);
      setBusy(false);
    }
  }

  return (
    <form action={submit} className="card card-pink card-hero stack" style={{ maxWidth: 420, margin: '12vh auto' }}>
      <div className="display" style={{ fontSize: '3rem' }}>
        BBO <span className="pink">BRAIN</span>
      </div>
      <input className="input" type="password" name="password" placeholder="Access password" autoFocus required />
      {error ? <div className="xs down">{error}</div> : null}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? 'Checking…' : 'Unlock'}
      </button>
    </form>
  );
}

'use client';

import { useState } from 'react';
import { cx } from '@/lib/utils/format';
import type { ProgressStep } from './ActivationStore';

export function SectionHead({
  label,
  note,
  tone = 'pink',
}: {
  label: string;
  note?: string;
  tone?: 'pink' | 'gold';
}) {
  return (
    <div className="section">
      <span className={cx('label', tone === 'gold' ? 'label-gold' : 'label-pink')}>{label}</span>
      <span className="section-rule" />
      {note ? <span className="section-note">{note}</span> : null}
    </div>
  );
}

export function ScreenHead({
  title,
  lede,
  action,
}: {
  title: string;
  lede?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="screen-head">
      <div className="spread">
        <h1 className="screen-title">{title}</h1>
        {action}
      </div>
      {lede ? <p className="screen-lede">{lede}</p> : null}
    </header>
  );
}

export function Empty({
  mark,
  title,
  children,
}: {
  mark: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-mark" aria-hidden="true">
        {mark}
      </span>
      <div className="empty-title">{title}</div>
      <p className="small" style={{ maxWidth: '42ch', margin: '0 auto' }}>
        {children}
      </p>
    </div>
  );
}

export function Meter({ percent, ready = false }: { percent: number; ready?: boolean }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div
      className="meter"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={cx('meter-fill', ready && 'ready')} style={{ width: `${value}%` }} />
    </div>
  );
}

export function CopyButton({
  text,
  label = 'Copy',
  className = 'btn',
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

export function ErrorBox({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="error-box" role="alert">
      <p style={{ marginBottom: onRetry || onDismiss ? 12 : 0 }}>{message}</p>
      <div className="row-tight">
        {onRetry ? (
          <button type="button" className="btn" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {onDismiss ? (
          <button type="button" className="btn" onClick={onDismiss}>
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ProgressOverlay({ title, steps }: { title: string; steps: ProgressStep[] }) {
  return (
    <div className="overlay" role="status" aria-live="polite">
      <div className="overlay-inner">
        <div className="overlay-mark">BBO STAMPED</div>
        <div className="panel">
          <p className="label label-pink" style={{ marginBottom: 10 }}>
            {title}
          </p>
          {steps.map((step) => (
            <div key={step.label} className={cx('step', step.state === 'todo' ? '' : step.state)}>
              <span className="step-mark" aria-hidden="true">
                {step.state === 'done' ? '✓' : step.state === 'active' ? '●' : '○'}
              </span>
              <span>{step.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Toast({ message }: { message: string }) {
  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}

export function TagList({ items, tone }: { items: string[]; tone?: 'pink' | 'gold' }) {
  if (items.length === 0) return null;
  return (
    <div className="row-tight" style={{ marginTop: 8 }}>
      {items.map((item) => (
        <span
          key={item}
          className={cx('tag', tone === 'pink' && 'tag-pink', tone === 'gold' && 'tag-gold')}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

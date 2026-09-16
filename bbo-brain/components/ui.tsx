import Link from 'next/link';
import type { ContentFact } from '@/lib/intel/dataset';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

export function PageHead({ kicker, title, lede, actions }: { kicker?: string; title: string; lede?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="page-head rise">
      {kicker ? <div className="kicker">{kicker}</div> : null}
      <div className="page-head-row">
        <h1 className="page-title">{title}</h1>
        {actions ? <div className="row">{actions}</div> : null}
      </div>
      {lede ? <p className="page-lede">{lede}</p> : null}
    </header>
  );
}

export function Section({ title, note, children, id }: { title: string; note?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section className="section" id={id} aria-label={title}>
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        <span className="section-rule" />
        {note ? <span className="section-note">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'up' | 'down' | 'pink' }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={cx('stat-value', tone)}>{value}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children ? <div className="small">{children}</div> : null}
    </div>
  );
}

const LABEL_TONE: Record<string, string> = {
  BREAKOUT: 'chip-solid-pink',
  WINNER: 'chip-green',
  ABOVE_AVERAGE: 'chip-green',
  AVERAGE: 'chip-muted',
  BELOW_AVERAGE: 'chip-amber',
  LOSER: 'chip-red',
  IMMATURE: 'chip-muted',
  UNSCORED: 'chip-muted',
};

export function LabelChip({ label }: { label: string | null | undefined }) {
  if (!label) return <span className="chip chip-muted">no score</span>;
  return <span className={cx('chip', LABEL_TONE[label] ?? 'chip-muted')}>{label.replace(/_/g, ' ')}</span>;
}

export function ScoreBadge({ score, label }: { score: number | null | undefined; label?: string | null }) {
  return (
    <span className="row-tight">
      <span className="score">
        <span className={cx('score-num', typeof score === 'number' && score >= 1.15 && 'up', typeof score === 'number' && score <= 0.85 && 'down')}>{typeof score === 'number' ? score.toFixed(2) : '—'}</span>
      </span>
      <LabelChip label={label} />
    </span>
  );
}

const CONF_LEVEL: Record<string, number> = { INSUFFICIENT_DATA: 0, EARLY_SIGNAL: 1, MODERATE_SIGNAL: 3, STRONG_SIGNAL: 4 };

export function Confidence({ label }: { label: string | null | undefined }) {
  const level = CONF_LEVEL[label ?? ''] ?? 0;
  const text = (label ?? 'INSUFFICIENT_DATA').replace(/_SIGNAL$/, '').replace(/_/g, ' ');
  return (
    <span className={cx('conf', level === 4 && 'conf-strong')} title={`${(label ?? 'INSUFFICIENT_DATA').replace(/_/g, ' ').toLowerCase()}`}>
      <span className="conf-bars" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <i key={i} className={i <= Math.max(level, 0) ? 'on' : undefined} />
        ))}
      </span>
      {text}
    </span>
  );
}

const STATUS_TONE: Record<string, string> = {
  NEW: 'chip-pink',
  OBSERVING: 'chip-muted',
  SUPPORTED: 'chip-green',
  WEAKENED: 'chip-amber',
  CONTRADICTED: 'chip-red',
  PROMOTED_TO_RULE: 'chip-gold',
  ARCHIVED: 'chip-muted',
  pending: 'chip-pink',
  approved: 'chip-green',
  edited_approved: 'chip-green',
  rejected: 'chip-red',
  observing: 'chip-muted',
  open: 'chip-pink',
  kept: 'chip-green',
  narrowed: 'chip-gold',
  replaced: 'chip-gold',
  deactivated: 'chip-red',
  proposed: 'chip-muted',
  running: 'chip-pink',
  completed: 'chip-green',
  abandoned: 'chip-muted',
  active: 'chip-green',
  inactive: 'chip-muted',
  connected: 'chip-green',
  not_connected: 'chip-muted',
  needs_attention: 'chip-amber',
  succeeded: 'chip-green',
  partial: 'chip-amber',
  failed: 'chip-red',
  passed: 'chip-green',
  needs_human: 'chip-pink',
  human_approved: 'chip-green',
  human_rejected: 'chip-red',
  error: 'chip-red',
  ok: 'chip-green',
  ai: 'chip-gold',
};

export function StatusChip({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  return <span className={cx('chip', STATUS_TONE[status] ?? 'chip-muted')}>{status.replace(/_/g, ' ')}</span>;
}

export function SourceChip({ source }: { source: string }) {
  const tone = source === 'ai' ? 'chip-gold' : source === 'human' ? 'chip-pink' : source === 'measured' ? 'chip-green' : 'chip-muted';
  return <span className={cx('chip', tone)}>{source === 'audit_v2' ? 'audit' : source}</span>;
}

export function DemoFlag() {
  return <span className="chip demo-flag">DEMO DATA</span>;
}

export function Thumb({ contentId, hasThumb, title, small }: { contentId: number; hasThumb: boolean; title: string; small?: boolean }) {
  return (
    <div className={cx('thumb', small && 'thumb-sm')}>
      {/* First letter or digit only: charAt(0) splits emoji surrogate pairs and breaks hydration. */}
      {hasThumb ? <img src={`/api/media/${contentId}`} alt="" loading="lazy" /> : <div className="thumb-mono">{title.match(/[A-Za-z0-9]/)?.[0]?.toUpperCase() ?? 'B'}</div>}
    </div>
  );
}

export function PostRow({ fact, extra }: { fact: ContentFact; extra?: React.ReactNode }) {
  return (
    <Link href={`/content/${fact.contentId}`} className="post-row">
      <Thumb contentId={fact.contentId} hasThumb={Boolean(fact.thumbPath)} title={fact.title} small />
      <div className="post-row-body stack-xs">
        <div className="card-title clamp-2 small">{fact.title}</div>
        <div className="row-tight xs muted">
          <ScoreBadge score={fact.score} label={fact.label} />
          <span>{fact.franchiseName ?? 'Unclassified'}</span>
          <span>· {fmtDate(fact.publishedAt)}</span>
          {fact.isDemo ? <DemoFlag /> : null}
        </div>
        {extra}
      </div>
    </Link>
  );
}

export function RatioBar({ ratio }: { ratio: number | null | undefined }) {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return <div className="ratio-bar" />;
  // log2 scale: 0.25x … 4x maps across the bar, 1x at centre.
  const pos = Math.max(-2, Math.min(2, Math.log2(ratio))) / 2;
  const style = pos >= 0 ? { left: '50%', width: `${pos * 50}%`, background: 'var(--green)' } : { right: '50%', width: `${-pos * 50}%`, background: 'var(--red)' };
  return (
    <div className="ratio-bar" title={`${ratio.toFixed(2)}x`}>
      <span style={style} />
    </div>
  );
}

export function fmtDate(iso: string | null | undefined, withYear = false): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) });
}

export function fmtNum(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 10_000) return `${(v / 1000).toFixed(1)}k`;
  return Math.round(v).toLocaleString();
}

export function fmtPct(v: number | null | undefined, digits = 2): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : '—';
}

export function fmtX(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(2)}x` : '—';
}

export { cx };

import { median, percentileRank } from '@/lib/intel/stats';
import type { ContentFact, MetricKey } from '@/lib/intel/dataset';
import { formatClass } from './engine';

export type ContextLine = { text: string; tone: 'up' | 'down' | 'neutral'; n: number };

const fmtX = (x: number) => `${x >= 10 ? x.toFixed(0) : x >= 1 ? x.toFixed(1) : x.toFixed(2)}x`;

function ratioLine(target: ContentFact, pool: ContentFact[], metric: MetricKey, label: string, groupLabel: string): ContextLine | null {
  const value = target.rates[metric];
  const values = pool.map((f) => f.rates[metric]).filter((v): v is number => typeof v === 'number');
  const med = median(values);
  if (typeof value !== 'number' || med === null || med <= 0 || values.length < 5) return null;
  const x = value / med;
  return { text: `${fmtX(x)} ${groupLabel} median ${label}`, tone: x >= 1.15 ? 'up' : x <= 0.85 ? 'down' : 'neutral', n: values.length };
}

/**
 * Relative intelligence for one post: never "42,000 views" alone, always what
 * that means against BBO's own comparable history. Every line carries its n.
 */
export function performanceContext(target: ContentFact, facts: ContentFact[]): ContextLine[] {
  const lines: ContextLine[] = [];
  const mature = facts.filter((f) => f.isMature && f.contentId !== target.contentId && f.platform === target.platform);
  const sameFormat = mature.filter((f) => formatClass(f.format) === formatClass(target.format));
  const platformName = target.platform === 'instagram' ? 'Instagram' : target.platform;

  const reach = ratioLine(target, sameFormat, 'reach', 'reach', `BBO ${platformName}`);
  if (reach) lines.push(reach);
  for (const [metric, label] of [
    ['share_rate', 'share rate'],
    ['comment_rate', 'comment rate'],
    ['save_rate', 'save rate'],
  ] as Array<[MetricKey, string]>) {
    const line = ratioLine(target, sameFormat, metric, label, '');
    if (line) lines.push({ ...line, text: line.text.replace('  ', ' ') });
  }

  if (target.franchise && target.score !== null && target.isMature) {
    const t = new Date(target.publishedAt).getTime();
    const window = mature.filter(
      (f) => f.franchise === target.franchise && f.score !== null && Math.abs(new Date(f.publishedAt).getTime() - t) <= 45 * 86_400_000
    );
    if (window.length >= 9) {
      const pct = percentileRank(target.score, [...window.map((f) => f.score as number), target.score]);
      if (pct !== null) {
        const top = Math.max(1, Math.round((1 - pct) * 100) + 1);
        lines.push({
          text: pct >= 0.5 ? `Top ${Math.min(top, 50)}% of ${target.franchiseName} posts within ±45 days` : `Bottom ${Math.max(1, Math.round(pct * 100))}% of ${target.franchiseName} posts within ±45 days`,
          tone: pct >= 0.75 ? 'up' : pct <= 0.25 ? 'down' : 'neutral',
          n: window.length + 1,
        });
      }
    }
  }

  const ratio = (key: string) => target.components.find((c) => c.key === key)?.ratio;
  const retention = ratio('retention') ?? ratio('hold_3s');
  const comments = ratio('comment_rate');
  const shares = ratio('share_rate');
  if (retention !== undefined && comments !== undefined && retention < 0.85 && comments > 1.3) {
    lines.push({ text: 'Retention was below BBO baseline despite strong comments', tone: 'neutral', n: target.components.length });
  }
  if (retention !== undefined && shares !== undefined && retention > 1.2 && shares < 0.8) {
    lines.push({ text: 'People watched it through but did not send it on', tone: 'neutral', n: target.components.length });
  }
  if (reach && reach.tone === 'down' && target.rates.deep_action_rate !== undefined) {
    const da = ratioLine(target, sameFormat, 'deep_action_rate', 'deep action rate', '');
    if (da && da.tone === 'up') lines.push({ text: 'Hidden winner: low reach, above-baseline deep action — a distribution problem, not a concept problem', tone: 'up', n: da.n });
  }
  return lines;
}

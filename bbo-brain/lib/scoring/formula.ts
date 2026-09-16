/**
 * Normalized BBO performance score — the pure maths. No database access.
 *
 * score = weighted geometric mean of (post value / peer-group median) across
 * components. 1.0 = what BBO normally gets from comparable posts. A geometric
 * mean keeps 2x and 0.5x symmetric and stops one viral reach number from
 * drowning out shares, comments, saves and retention.
 *
 * The formula and thresholds are data (performance_score_versions), not code
 * constants — DEFAULT_* below only seed version v1.
 */

export type ComponentKey =
  | 'share_rate'
  | 'comment_rate'
  | 'save_rate'
  | 'like_rate'
  | 'retention'
  | 'hold_3s'
  | 'reach'
  | 'follows_per_reach'
  | 'deep_action_rate';

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  share_rate: 'share rate',
  comment_rate: 'comment rate',
  save_rate: 'save rate',
  like_rate: 'like rate',
  retention: 'retention (avg watch ÷ duration)',
  hold_3s: '3-second hold (100% − skip rate)',
  reach: 'reach',
  follows_per_reach: 'follows per reach',
  deep_action_rate: 'deep action rate',
};

/**
 * Every component gets a ratio to its peer median, weighted or not. Mining and
 * comparisons use these era-normalised ratios: comparing raw rates across five
 * years of a growing account mostly measures the era, not the content.
 */
export const RELATIVE_KEYS: ComponentKey[] = ['share_rate', 'comment_rate', 'save_rate', 'like_rate', 'retention', 'hold_3s', 'reach', 'deep_action_rate'];

export type ScoreFormula = {
  weights: Partial<Record<ComponentKey, number>>;
  ratioFloor: number;
  ratioCap: number;
  maturityHours: number;
  minCoverage: number;
  baseline: {
    trailingDays: number;
    centeredDays: number;
    minPeers: number;
  };
};

export type LabelThresholds = {
  BREAKOUT: number;
  WINNER: number;
  ABOVE_AVERAGE: number;
  AVERAGE_FLOOR: number;
  LOSER_CEILING: number;
};

export type ScoreLabel =
  | 'BREAKOUT'
  | 'WINNER'
  | 'ABOVE_AVERAGE'
  | 'AVERAGE'
  | 'BELOW_AVERAGE'
  | 'LOSER'
  | 'IMMATURE'
  | 'UNSCORED';

export const DEFAULT_FORMULA_V1: ScoreFormula = {
  weights: {
    share_rate: 0.25,
    comment_rate: 0.15,
    save_rate: 0.15,
    retention: 0.15,
    hold_3s: 0.1,
    reach: 0.1,
    like_rate: 0.1,
    // Instagram does not return per-Reel follows (verified: "Media Insights API does not
    // support the follows metric for this media product type"). Weight 0 until a source exists.
    follows_per_reach: 0,
  },
  ratioFloor: 0.1,
  ratioCap: 10,
  maturityHours: 48,
  minCoverage: 0.5,
  baseline: { trailingDays: 90, centeredDays: 90, minPeers: 10 },
};

export const DEFAULT_THRESHOLDS_V1: LabelThresholds = {
  BREAKOUT: 2.0,
  WINNER: 1.5,
  ABOVE_AVERAGE: 1.15,
  AVERAGE_FLOOR: 0.85,
  LOSER_CEILING: 0.5,
};

/** Canonical metric names (see lib/adapters/types.ts CANONICAL_METRICS). */
export type RawMetrics = {
  reach?: number | null;
  likes?: number | null;
  comments?: number | null;
  saves?: number | null;
  shares?: number | null;
  follows?: number | null;
  avg_watch_time_ms?: number | null;
  skip_rate?: number | null;
};

const num = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Rates from raw metrics. A missing input yields a missing rate — never zero. */
export function deriveComponents(m: RawMetrics, durationS: number | null | undefined): Partial<Record<ComponentKey, number>> {
  const out: Partial<Record<ComponentKey, number>> = {};
  const reach = num(m.reach) && m.reach > 0 ? m.reach : null;
  if (reach !== null) {
    out.reach = reach;
    if (num(m.shares)) out.share_rate = m.shares / reach;
    if (num(m.comments)) out.comment_rate = m.comments / reach;
    if (num(m.saves)) out.save_rate = m.saves / reach;
    if (num(m.likes)) out.like_rate = m.likes / reach;
    if (num(m.follows)) out.follows_per_reach = m.follows / reach;
    if (num(m.shares) && num(m.saves) && num(m.comments)) out.deep_action_rate = (m.shares + m.saves + m.comments) / reach;
  }
  if (num(m.avg_watch_time_ms) && num(durationS) && durationS > 0) {
    out.retention = Math.min(m.avg_watch_time_ms / 1000 / durationS, 3);
  }
  if (num(m.skip_rate) && m.skip_rate >= 0 && m.skip_rate <= 100) {
    out.hold_3s = (100 - m.skip_rate) / 100;
  }
  return out;
}

export type ComponentResult = {
  key: ComponentKey;
  value: number;
  peerMedian: number;
  ratio: number;
  weight: number;
};

export type ScoreResult = {
  score: number | null;
  coverage: number;
  components: ComponentResult[];
};

export function computeScore(
  values: Partial<Record<ComponentKey, number>>,
  peerMedians: Partial<Record<ComponentKey, number | null>>,
  formula: ScoreFormula
): ScoreResult {
  const totalWeight = Object.values(formula.weights).reduce((a, b) => a + (b ?? 0), 0);
  const components: ComponentResult[] = [];
  let usedWeight = 0;
  let logSum = 0;

  for (const [key, weight] of Object.entries(formula.weights) as Array<[ComponentKey, number]>) {
    if (!weight) continue;
    const value = values[key];
    const peer = peerMedians[key];
    if (!num(value) || !num(peer) || peer <= 0) continue;
    const r = Math.min(Math.max(value / peer, formula.ratioFloor), formula.ratioCap);
    components.push({ key, value, peerMedian: peer, ratio: r, weight });
    usedWeight += weight;
    logSum += weight * Math.log(r);
  }

  const coverage = totalWeight > 0 ? usedWeight / totalWeight : 0;
  const score = usedWeight > 0 && coverage >= formula.minCoverage ? Math.exp(logSum / usedWeight) : null;
  return { score, coverage, components };
}

export function labelFor(score: number | null, isMature: boolean, t: LabelThresholds): ScoreLabel {
  if (!isMature) return 'IMMATURE';
  if (score === null) return 'UNSCORED';
  if (score >= t.BREAKOUT) return 'BREAKOUT';
  if (score >= t.WINNER) return 'WINNER';
  if (score >= t.ABOVE_AVERAGE) return 'ABOVE_AVERAGE';
  if (score > t.AVERAGE_FLOOR) return 'AVERAGE';
  if (score > t.LOSER_CEILING) return 'BELOW_AVERAGE';
  return 'LOSER';
}

export function durationBucket(durationS: number | null | undefined): string | null {
  if (!num(durationS) || durationS <= 0) return null;
  if (durationS <= 15) return '<=15s';
  if (durationS <= 30) return '16-30s';
  if (durationS <= 45) return '31-45s';
  if (durationS <= 60) return '46-60s';
  return '>60s';
}

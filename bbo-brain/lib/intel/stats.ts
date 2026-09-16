/**
 * Statistical guardrails. Every "pattern" in BBO BRAIN passes through
 * compareGroups, which decides how much the data is allowed to say.
 *
 * The output is always associational. Nothing here can express causation —
 * that language is reserved for completed experiments (lib/intel/experiments.ts).
 */

export type ConfidenceLabel = 'INSUFFICIENT_DATA' | 'EARLY_SIGNAL' | 'MODERATE_SIGNAL' | 'STRONG_SIGNAL';
export type Verdict = 'positive' | 'negative' | 'no_difference' | 'insufficient';

export const CONFIDENCE_ORDER: ConfidenceLabel[] = [
  'INSUFFICIENT_DATA',
  'EARLY_SIGNAL',
  'MODERATE_SIGNAL',
  'STRONG_SIGNAL',
];

export const STAT_THRESHOLDS = {
  minN: 5,
  moderateN: 8,
  strongN: 15,
  meaningfulUp: 1.25,
  meaningfulDown: 0.8,
  moderateConsistency: 0.6,
  strongConsistency: 0.65,
  moderateP: 0.15,
  strongP: 0.05,
  permutations: 2000,
  recentDays: 60,
} as const;

export type Observation = { value: number; at: string; contentId?: number };

export type GroupComparison = {
  nGroup: number;
  nRest: number;
  medianGroup: number | null;
  medianRest: number | null;
  /** medianGroup / medianRest. >1 means the group is associated with higher values. */
  effect: number | null;
  /** Share of group observations on the effect's side of the rest median. */
  consistency: number | null;
  pValue: number | null;
  /** Does the direction hold in both the earlier and later half of the data? */
  halvesAgree: boolean | null;
  recentEffect: number | null;
  nRecentGroup: number;
  verdict: Verdict;
  confidence: ConfidenceLabel;
};

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function mean(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function quantile(values: number[], q: number): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

/** Share of `values` at or below `value` (0..1). */
export function percentileRank(value: number, values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  return v.filter((x) => x <= value).length / v.length;
}

/** Small deterministic PRNG so the same data always yields the same p-value. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Two-sided permutation test on the difference of medians. */
export function permutationP(group: number[], rest: number[], iterations: number = STAT_THRESHOLDS.permutations): number | null {
  const mg = median(group);
  const mr = median(rest);
  if (mg === null || mr === null) return null;
  const observed = Math.abs(mg - mr);
  const pooled = [...group, ...rest];
  const rand = mulberry32(group.length * 7919 + rest.length * 104729 + Math.round(observed * 1e6));
  let extreme = 0;
  for (let i = 0; i < iterations; i++) {
    for (let j = pooled.length - 1; j > 0; j--) {
      const k = Math.floor(rand() * (j + 1));
      [pooled[j], pooled[k]] = [pooled[k], pooled[j]];
    }
    const a = median(pooled.slice(0, group.length));
    const b = median(pooled.slice(group.length));
    if (a !== null && b !== null && Math.abs(a - b) >= observed - 1e-12) extreme++;
  }
  return (extreme + 1) / (iterations + 1);
}

function normalCdf(z: number): number {
  // Abramowitz & Stegun 7.1.26 approximation of erf.
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/**
 * Two-sided Mann–Whitney U (normal approximation, tie-corrected, continuity
 * corrected). Used when both groups have ≥20 observations, where permutation
 * testing of medians would be needlessly slow across hundreds of comparisons.
 */
export function mannWhitneyP(a: number[], b: number[]): number | null {
  const n1 = a.length;
  const n2 = b.length;
  if (!n1 || !n2) return null;
  const pooled = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  let rankSumA = 0;
  let tieTerm = 0;
  for (let i = 0; i < pooled.length; ) {
    let j = i;
    while (j + 1 < pooled.length && pooled[j + 1].v === pooled[i].v) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (pooled[k].g === 0) rankSumA += rank;
    const t = j - i + 1;
    tieTerm += t * t * t - t;
    i = j + 1;
  }
  const n = n1 + n2;
  const u = rankSumA - (n1 * (n1 + 1)) / 2;
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tieTerm / (n * (n - 1))));
  if (!sigma) return 1;
  const z = Math.max(0, Math.abs(u - (n1 * n2) / 2) - 0.5) / sigma;
  return Math.min(1, 2 * (1 - normalCdf(z)));
}

function ratio(a: number | null, b: number | null): number | null {
  if (a === null || b === null || b <= 0 || a < 0) return null;
  return a / b;
}

export function compareGroups(
  group: Observation[],
  rest: Observation[],
  options: { asOf?: string } = {}
): GroupComparison {
  const T = STAT_THRESHOLDS;
  const gv = group.map((o) => o.value).filter(Number.isFinite);
  const rv = rest.map((o) => o.value).filter(Number.isFinite);
  const medianGroup = median(gv);
  const medianRest = median(rv);
  const effect = ratio(medianGroup, medianRest);

  const base: GroupComparison = {
    nGroup: gv.length,
    nRest: rv.length,
    medianGroup,
    medianRest,
    effect,
    consistency: null,
    pValue: null,
    halvesAgree: null,
    recentEffect: null,
    nRecentGroup: 0,
    verdict: 'insufficient',
    confidence: 'INSUFFICIENT_DATA',
  };
  if (gv.length < T.minN || rv.length < T.minN || effect === null || medianRest === null) return base;

  const positive = effect >= 1;
  const consistency = gv.filter((v) => (positive ? v > medianRest : v < medianRest)).length / gv.length;
  const pValue = gv.length >= 20 && rv.length >= 20 ? mannWhitneyP(gv, rv) : permutationP(gv, rv);

  // Time split: the direction must survive in both halves to be called strong.
  const allTimes = [...group, ...rest].map((o) => o.at).sort();
  const splitAt = allTimes[Math.floor(allTimes.length / 2)];
  const halfEffect = (early: boolean) => {
    const g = group.filter((o) => (early ? o.at < splitAt : o.at >= splitAt)).map((o) => o.value);
    const r = rest.filter((o) => (early ? o.at < splitAt : o.at >= splitAt)).map((o) => o.value);
    return g.length >= 3 && r.length >= 3 ? ratio(median(g), median(r)) : null;
  };
  const e1 = halfEffect(true);
  const e2 = halfEffect(false);
  const halvesAgree = e1 === null || e2 === null ? null : (e1 >= 1) === (e2 >= 1);

  const asOf = options.asOf ?? allTimes[allTimes.length - 1];
  const recentCut = new Date(new Date(asOf).getTime() - T.recentDays * 86_400_000).toISOString();
  const recentGroup = group.filter((o) => o.at >= recentCut).map((o) => o.value);
  const recentRest = rest.filter((o) => o.at >= recentCut).map((o) => o.value);
  const recentEffect = recentGroup.length >= 3 && recentRest.length >= 3 ? ratio(median(recentGroup), median(recentRest)) : null;

  const meaningful = effect >= T.meaningfulUp || effect <= T.meaningfulDown;
  let verdict: Verdict;
  let confidence: ConfidenceLabel;

  if (!meaningful) {
    // Confidence here is confidence that there is NO meaningful difference.
    verdict = 'no_difference';
    confidence =
      gv.length >= T.strongN && rv.length >= T.strongN
        ? 'MODERATE_SIGNAL'
        : gv.length >= T.moderateN
          ? 'EARLY_SIGNAL'
          : 'INSUFFICIENT_DATA';
  } else {
    verdict = positive ? 'positive' : 'negative';
    if (
      gv.length >= T.strongN &&
      rv.length >= T.strongN &&
      consistency >= T.strongConsistency &&
      pValue !== null &&
      pValue <= T.strongP &&
      halvesAgree === true
    ) {
      confidence = 'STRONG_SIGNAL';
    } else if (gv.length >= T.moderateN && consistency >= T.moderateConsistency && pValue !== null && pValue <= T.moderateP) {
      confidence = 'MODERATE_SIGNAL';
    } else {
      confidence = 'EARLY_SIGNAL';
    }
  }

  return {
    ...base,
    consistency,
    pValue,
    halvesAgree,
    recentEffect,
    nRecentGroup: recentGroup.length,
    verdict,
    confidence,
  };
}

/** Plain-language, correlation-only description of a comparison. */
export function describeEffect(c: GroupComparison, metricLabel: string): string {
  if (c.verdict === 'insufficient') return `Not enough data (${c.nGroup} vs ${c.nRest} posts; need ${STAT_THRESHOLDS.minN}+ each).`;
  const x = c.effect ?? 1;
  if (c.verdict === 'no_difference') {
    return `No meaningful difference in ${metricLabel} (${x.toFixed(2)}x, ${c.nGroup} vs ${c.nRest} posts).`;
  }
  const dir = c.verdict === 'positive' ? 'stronger' : 'weaker';
  return `Associated with ${dir} ${metricLabel}: ${x.toFixed(2)}x the comparison median across ${c.nGroup} vs ${c.nRest} posts.`;
}

import { describe, expect, it } from 'vitest';
import {
  computeScore,
  DEFAULT_FORMULA_V1,
  DEFAULT_THRESHOLDS_V1,
  deriveComponents,
  durationBucket,
  labelFor,
} from '@/lib/scoring/formula';

describe('deriveComponents', () => {
  it('never substitutes zero for missing inputs', () => {
    const c = deriveComponents({ reach: 1000, shares: 20 }, null);
    expect(c.share_rate).toBe(0.02);
    expect(c.comment_rate).toBeUndefined();
    expect(c.retention).toBeUndefined();
    expect(c.hold_3s).toBeUndefined();
  });

  it('derives retention from watch time and measured duration, and hold from skip rate', () => {
    const c = deriveComponents({ reach: 1000, avg_watch_time_ms: 15_000, skip_rate: 30 }, 30);
    expect(c.retention).toBeCloseTo(0.5);
    expect(c.hold_3s).toBeCloseTo(0.7);
  });

  it('ignores zero reach rather than dividing by it', () => {
    expect(deriveComponents({ reach: 0, shares: 5 }, 20)).toEqual({});
  });
});

describe('computeScore', () => {
  const peers = { share_rate: 0.01, comment_rate: 0.005, save_rate: 0.006, like_rate: 0.03, retention: 0.4, hold_3s: 0.65, reach: 3000 };

  it('scores exactly 1.0 when every component equals the peer median', () => {
    const result = computeScore({ ...peers }, peers, DEFAULT_FORMULA_V1);
    expect(result.score).toBeCloseTo(1, 10);
    expect(result.coverage).toBeCloseTo(1);
  });

  it('treats 2x and 0.5x symmetrically (geometric mean)', () => {
    const formula = { ...DEFAULT_FORMULA_V1, weights: { share_rate: 0.5, reach: 0.5 } };
    const result = computeScore({ share_rate: 0.02, reach: 1500 }, peers, formula);
    expect(result.score).toBeCloseTo(1, 10);
  });

  it('does not let one huge reach number dominate', () => {
    const result = computeScore({ ...peers, reach: 300_000 }, peers, DEFAULT_FORMULA_V1);
    // reach ratio capped at 10, weight 0.10 → 10^0.1 ≈ 1.26
    expect(result.score).toBeLessThan(1.3);
  });

  it('refuses to score when too little of the formula is measurable', () => {
    const result = computeScore({ reach: 5000 }, peers, DEFAULT_FORMULA_V1);
    expect(result.coverage).toBeLessThan(DEFAULT_FORMULA_V1.minCoverage);
    expect(result.score).toBeNull();
  });
});

describe('labels', () => {
  it('maps scores onto configured thresholds', () => {
    const t = DEFAULT_THRESHOLDS_V1;
    expect(labelFor(2.3, true, t)).toBe('BREAKOUT');
    expect(labelFor(1.6, true, t)).toBe('WINNER');
    expect(labelFor(1.2, true, t)).toBe('ABOVE_AVERAGE');
    expect(labelFor(1.0, true, t)).toBe('AVERAGE');
    expect(labelFor(0.7, true, t)).toBe('BELOW_AVERAGE');
    expect(labelFor(0.45, true, t)).toBe('LOSER');
  });

  it('never classifies an immature post', () => {
    expect(labelFor(3, false, DEFAULT_THRESHOLDS_V1)).toBe('IMMATURE');
    expect(labelFor(null, true, DEFAULT_THRESHOLDS_V1)).toBe('UNSCORED');
  });

  it('buckets duration', () => {
    expect(durationBucket(15)).toBe('<=15s');
    expect(durationBucket(22)).toBe('16-30s');
    expect(durationBucket(61)).toBe('>60s');
    expect(durationBucket(null)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { compareGroups, describeEffect, median, percentileRank, quantile, type Observation } from '@/lib/intel/stats';

const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString();
const obs = (values: number[], offset = 0): Observation[] => values.map((value, i) => ({ value, at: day(offset + i * 3) }));

describe('descriptive stats', () => {
  it('median handles odd, even and empty inputs', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('quantile and percentile rank', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentileRank(4, [1, 2, 3, 4, 5])).toBe(0.8);
  });
});

describe('compareGroups guardrails', () => {
  it('refuses to call a pattern from 1-2 posts', () => {
    const result = compareGroups(obs([5, 6]), obs([1, 1, 1, 1, 1, 1]));
    expect(result.verdict).toBe('insufficient');
    expect(result.confidence).toBe('INSUFFICIENT_DATA');
  });

  it('labels a large, consistent, time-stable difference as a strong signal', () => {
    const group = obs(Array.from({ length: 20 }, (_, i) => 2 + (i % 5) * 0.1), 0);
    const rest = obs(Array.from({ length: 20 }, (_, i) => 1 + (i % 5) * 0.1), 1);
    const result = compareGroups(group, rest);
    expect(result.verdict).toBe('positive');
    expect(result.effect).toBeGreaterThan(1.5);
    expect(result.halvesAgree).toBe(true);
    expect(result.confidence).toBe('STRONG_SIGNAL');
    expect(describeEffect(result, 'share rate')).toMatch(/^Associated with stronger share rate/);
  });

  it('does not upgrade a small difference to a signal', () => {
    const group = obs(Array.from({ length: 16 }, (_, i) => 1 + (i % 4) * 0.05));
    const rest = obs(Array.from({ length: 16 }, (_, i) => 1.02 + (i % 4) * 0.05), 1);
    const result = compareGroups(group, rest);
    expect(result.verdict).toBe('no_difference');
  });

  it('never calls a moderate effect on 5 posts strong', () => {
    const result = compareGroups(obs([3, 3.2, 2.9, 3.1, 3]), obs([1, 1.1, 0.9, 1, 1.05, 0.95]));
    expect(result.verdict).toBe('positive');
    expect(result.confidence).toBe('EARLY_SIGNAL');
  });

  it('is deterministic', () => {
    const g = obs([2, 2.5, 3, 1.8, 2.2, 2.9, 3.1, 2.4]);
    const r = obs([1, 1.2, 0.8, 1.1, 1.3, 0.9, 1, 1.05], 1);
    expect(compareGroups(g, r).pValue).toBe(compareGroups(g, r).pValue);
  });

  it('flags negative associations', () => {
    const group = obs(Array.from({ length: 10 }, (_, i) => 0.4 + (i % 3) * 0.05));
    const rest = obs(Array.from({ length: 10 }, (_, i) => 1 + (i % 3) * 0.05), 1);
    const result = compareGroups(group, rest);
    expect(result.verdict).toBe('negative');
    expect(['MODERATE_SIGNAL', 'STRONG_SIGNAL']).toContain(result.confidence);
  });
});

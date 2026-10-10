'use client';

import { cx } from '@/lib/utils/format';
import type { BBOActivation, Shot, ShotCategory } from '@/types';

export type ShotFilterState = {
  bucket: 'all' | 'must' | 'client' | 'optional' | 'outstanding';
  category: ShotCategory | 'all';
  zoneId: string | 'all';
  reelId: string | 'all';
};

export const DEFAULT_FILTERS: ShotFilterState = {
  bucket: 'all',
  category: 'all',
  zoneId: 'all',
  reelId: 'all',
};

const BUCKETS: Array<{ value: ShotFilterState['bucket']; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'must', label: 'Must' },
  { value: 'client', label: 'Client' },
  { value: 'optional', label: 'Optional' },
];

const CATEGORIES: Array<{ value: ShotCategory | 'all'; label: string }> = [
  { value: 'all', label: 'Every category' },
  { value: 'hook', label: 'Hook' },
  { value: 'establishing', label: 'Establishing' },
  { value: 'venue', label: 'Location' },
  { value: 'talent', label: 'People' },
  { value: 'product', label: 'Product' },
  { value: 'service', label: 'Service' },
  { value: 'reaction', label: 'Reaction' },
  { value: 'interview', label: 'Interview' },
  { value: 'broll', label: 'B-roll' },
  { value: 'transition', label: 'Transition' },
  { value: 'skit', label: 'Skit' },
  { value: 'verdict', label: 'Verdict' },
];

export function applyShotFilters(shots: Shot[], filters: ShotFilterState): Shot[] {
  return shots.filter((shot) => {
    if (filters.bucket === 'must' && shot.priority !== 'must') return false;
    if (filters.bucket === 'client' && !shot.clientRequired) return false;
    if (filters.bucket === 'optional' && shot.priority !== 'optional') return false;
    if (filters.bucket === 'outstanding' && shot.completed) return false;
    if (filters.category !== 'all' && shot.category !== filters.category) return false;
    if (filters.zoneId !== 'all' && shot.zoneId !== filters.zoneId) return false;
    if (
      filters.reelId !== 'all' &&
      !shot.reelUsages.some((usage) => usage.reelId === filters.reelId)
    )
      return false;
    return true;
  });
}

export function ShotFilters({
  activation,
  filters,
  onChange,
}: {
  activation: BBOActivation;
  filters: ShotFilterState;
  onChange: (next: ShotFilterState) => void;
}) {
  const zones = activation.venueAnalysis?.zones ?? [];

  return (
    <div className="card">
      <div className="row-tight">
        {BUCKETS.map((bucket) => (
          <button
            key={bucket.value}
            type="button"
            className={cx('btn', filters.bucket === bucket.value && 'btn-active')}
            aria-pressed={filters.bucket === bucket.value}
            onClick={() => onChange({ ...filters, bucket: bucket.value })}
          >
            {bucket.label}
          </button>
        ))}
      </div>

      <div className="field field-pair" style={{ marginTop: 14 }}>
        <label>
          <span className="field-label">Category</span>
          <select
            className="select"
            value={filters.category}
            onChange={(event) =>
              onChange({ ...filters, category: event.target.value as ShotFilterState['category'] })
            }
          >
            {CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="field-label">Venue zone</span>
          <select
            className="select"
            value={filters.zoneId}
            onChange={(event) => onChange({ ...filters, zoneId: event.target.value })}
          >
            <option value="all">Everywhere</option>
            {zones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="field field-pair">
        <label>
          <span className="field-label">Reel</span>
          <select
            className="select"
            value={filters.reelId}
            onChange={(event) => onChange({ ...filters, reelId: event.target.value })}
          >
            <option value="all">Every Reel</option>
            {activation.reels.map((reel) => (
              <option key={reel.id} value={reel.id}>
                {reel.title}
              </option>
            ))}
          </select>
        </label>

      </div>
    </div>
  );
}

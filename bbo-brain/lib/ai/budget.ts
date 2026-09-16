import { get, type Db } from '@/lib/db/client';
import { brainConfig } from '@/lib/config';

/**
 * Spend controls.
 *
 * The rule the product cares about: running out of budget pauses AI work and
 * says so — it never fails the job, and it never touches metric ingestion,
 * scoring, graph or search. Estimates come from recorded token usage, so the
 * numbers are this system's own accounting, not a provider invoice.
 */

export class BudgetPausedError extends Error {
  readonly kind = 'budget-paused' as const;
  constructor(message: string) {
    super(message);
    this.name = 'BudgetPausedError';
  }
}

export const isBudgetPaused = (err: unknown): err is BudgetPausedError => err instanceof BudgetPausedError;

const startOfDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
const startOfMonth = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

function spendSince(db: Db, since: string): number {
  return get<{ total: number | null }>(db, 'SELECT SUM(estimated_cost_usd) AS total FROM ai_runs WHERE created_at >= ?', since)?.total ?? 0;
}

export type BudgetStatus = {
  dayUsd: number;
  monthUsd: number;
  dayLimitUsd: number;
  monthLimitUsd: number;
  jobLimitUsd: number;
  dayRemainingUsd: number;
  monthRemainingUsd: number;
  paused: boolean;
  reason: string | null;
};

export function budgetStatus(db: Db, now = new Date()): BudgetStatus {
  const cfg = brainConfig();
  const dayUsd = spendSince(db, startOfDay(now));
  const monthUsd = spendSince(db, startOfMonth(now));
  const dayRemainingUsd = cfg.dailyBudgetUsd > 0 ? cfg.dailyBudgetUsd - dayUsd : Number.POSITIVE_INFINITY;
  const monthRemainingUsd = cfg.monthlyBudgetUsd > 0 ? cfg.monthlyBudgetUsd - monthUsd : Number.POSITIVE_INFINITY;
  const reason =
    dayRemainingUsd <= 0
      ? `daily AI budget spent ($${dayUsd.toFixed(4)} of $${cfg.dailyBudgetUsd.toFixed(2)})`
      : monthRemainingUsd <= 0
        ? `monthly AI budget spent ($${monthUsd.toFixed(4)} of $${cfg.monthlyBudgetUsd.toFixed(2)})`
        : null;
  return {
    dayUsd,
    monthUsd,
    dayLimitUsd: cfg.dailyBudgetUsd,
    monthLimitUsd: cfg.monthlyBudgetUsd,
    jobLimitUsd: cfg.maxCostPerJobUsd,
    dayRemainingUsd,
    monthRemainingUsd,
    paused: reason !== null,
    reason,
  };
}

/**
 * One guard per job. It holds the job's own ceiling and consults the day/month
 * ledger, so a long batch stops at the first call that would cross a line
 * rather than after it has already spent the money.
 */
export class BudgetGuard {
  readonly jobLimitUsd: number;
  private spentUsd = 0;
  private readonly db: Db;

  constructor(db: Db, jobLimitUsd = brainConfig().maxCostPerJobUsd) {
    this.db = db;
    this.jobLimitUsd = jobLimitUsd;
  }

  get spent(): number {
    return this.spentUsd;
  }

  /** Throws BudgetPausedError when this call would cross the job, day or month ceiling. */
  check(estimatedUsd = 0, now = new Date()): void {
    const status = budgetStatus(this.db, now);
    if (status.paused) throw new BudgetPausedError(status.reason!);
    if (this.jobLimitUsd > 0 && this.spentUsd + estimatedUsd > this.jobLimitUsd) {
      throw new BudgetPausedError(`job AI budget reached ($${this.spentUsd.toFixed(4)} of $${this.jobLimitUsd.toFixed(2)})`);
    }
    if (estimatedUsd > status.dayRemainingUsd) {
      throw new BudgetPausedError(`daily AI budget would be exceeded (needs $${estimatedUsd.toFixed(4)}, $${Math.max(0, status.dayRemainingUsd).toFixed(4)} left today)`);
    }
    if (estimatedUsd > status.monthRemainingUsd) {
      throw new BudgetPausedError(`monthly AI budget would be exceeded (needs $${estimatedUsd.toFixed(4)}, $${Math.max(0, status.monthRemainingUsd).toFixed(4)} left this month)`);
    }
  }

  record(costUsd: number): void {
    this.spentUsd += Math.max(0, costUsd);
  }
}

/** Average recorded cost of a workflow's recent successful runs, for pre-batch estimates. */
export function averageRunCost(db: Db, workflow: string, sampleSize = 40): number {
  const row = get<{ avg: number | null }>(
    db,
    `SELECT AVG(estimated_cost_usd) AS avg FROM (
       SELECT estimated_cost_usd FROM ai_runs WHERE workflow = ? AND status = 'ok' ORDER BY id DESC LIMIT ?
     )`,
    workflow,
    sampleSize
  );
  return row?.avg ?? 0;
}

/** What a planned batch is expected to cost, and whether it fits. */
export function projectBatch(db: Db, workflow: string, count: number, now = new Date()): { perRunUsd: number; totalUsd: number; fits: boolean; reason: string | null } {
  const perRunUsd = averageRunCost(db, workflow);
  const totalUsd = perRunUsd * count;
  const status = budgetStatus(db, now);
  if (status.paused) return { perRunUsd, totalUsd, fits: false, reason: status.reason };
  const cfg = brainConfig();
  if (cfg.maxCostPerJobUsd > 0 && totalUsd > cfg.maxCostPerJobUsd) {
    return { perRunUsd, totalUsd, fits: false, reason: `estimated $${totalUsd.toFixed(4)} exceeds the per-job ceiling of $${cfg.maxCostPerJobUsd.toFixed(2)}` };
  }
  if (totalUsd > status.dayRemainingUsd) {
    return { perRunUsd, totalUsd, fits: false, reason: `estimated $${totalUsd.toFixed(4)} exceeds the $${Math.max(0, status.dayRemainingUsd).toFixed(4)} left in today's budget` };
  }
  return { perRunUsd, totalUsd, fits: true, reason: null };
}

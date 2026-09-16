import type { TokenUsage } from './providers/types';

/**
 * Token prices in USD per 1M tokens. Static entries are published list prices
 * and are only ever used to *estimate* — the number recorded on a run is an
 * estimate, never a bill. OpenRouter prices are refreshed from its catalogue at
 * runtime (`setPrice`), so a model whose price changes is not silently mispriced.
 */
export type Price = { inputPerMTok: number; outputPerMTok: number; source: 'list' | 'catalogue' | 'free-tier' };

const PRICES = new Map<string, Price>([
  // Google list prices (per 1M tokens).
  ['gemini-2.5-flash', { inputPerMTok: 0.3, outputPerMTok: 2.5, source: 'list' }],
  ['gemini-2.5-flash-lite', { inputPerMTok: 0.1, outputPerMTok: 0.4, source: 'list' }],
  ['gemini-flash-latest', { inputPerMTok: 0.3, outputPerMTok: 2.5, source: 'list' }],
  ['gemini-flash-lite-latest', { inputPerMTok: 0.1, outputPerMTok: 0.4, source: 'list' }],
  ['gemini-2.5-pro', { inputPerMTok: 1.25, outputPerMTok: 10, source: 'list' }],
  // OpenRouter list prices, read from its catalogue on 2026-09-16 and refreshed
  // at runtime by loadOpenRouterCatalogue so a price change is never missed.
  ['qwen/qwen3-235b-a22b-2507', { inputPerMTok: 0.087, outputPerMTok: 0.35, source: 'list' }],
  ['qwen/qwen3-30b-a3b-instruct-2507', { inputPerMTok: 0.048, outputPerMTok: 0.193, source: 'list' }],
  ['qwen/qwen3-32b', { inputPerMTok: 0.08, outputPerMTok: 0.28, source: 'list' }],
]);

/** NVIDIA's hosted NIM endpoints are free on a personal API key (rate-limited, not billed). */
const FREE_PREFIXES = ['nvidia:'];

export function setPrice(model: string, price: Price): void {
  PRICES.set(model, price);
}

export function priceFor(provider: string, model: string): Price | null {
  if (FREE_PREFIXES.includes(`${provider}:`)) return { inputPerMTok: 0, outputPerMTok: 0, source: 'free-tier' };
  return PRICES.get(model) ?? PRICES.get(`${provider}/${model}`) ?? null;
}

/** Estimated USD for one call. Unknown pricing returns 0 and is reported as unknown, not guessed. */
export function estimateCost(provider: string, model: string, usage: TokenUsage): number {
  const price = priceFor(provider, model);
  if (!price) return 0;
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? Math.max(0, (usage.totalTokens ?? 0) - input);
  return (input / 1_000_000) * price.inputPerMTok + (output / 1_000_000) * price.outputPerMTok;
}

/** Cost of a planned batch, from measured averages of previous runs. */
export function projectCost(perRunUsd: number, runs: number): number {
  return Math.max(0, perRunUsd) * Math.max(0, runs);
}

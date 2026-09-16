import { brainConfig } from '@/lib/config';
import { GeminiProvider } from './gemini-provider';
import { loadOpenRouterCatalogue, OpenAICompatProvider } from './openai-compat';
import type { AIProvider, HealthResult, ProviderName, TaskClass } from './types';

/**
 * Which provider answers which task class.
 *
 * Two rules shape everything here: cheap work must not buy premium tokens, and
 * no single provider outage may stop the daily loop. The preferred provider per
 * task is explicit configuration (AI_<TASK>_PROVIDER / _MODEL); everything else
 * configured is a fallback, tried in a fixed order and recorded on the run.
 */

export type Candidate = { provider: AIProvider; model: string };

/** Test seam: lets a suite drive real provider code against a fake transport. */
let fetchOverride: typeof fetch | null = null;
export function setProviderFetch(impl: typeof fetch | null): void {
  fetchOverride = impl;
}

/** Fallback order per task when the preferred choice is unavailable. */
const DEFAULT_ORDER: Record<TaskClass, ProviderName[]> = {
  coding: ['gemini', 'openrouter', 'nvidia'],
  analysis: ['gemini', 'openrouter'],
  gatekeeper: ['gemini', 'openrouter'],
  synthesis: ['gemini', 'openrouter'],
};

function geminiModels(cfg: ReturnType<typeof brainConfig>): Record<TaskClass, string[]> {
  const [primary, ...rest] = cfg.geminiModels;
  const cheapFirst = [...cfg.geminiModels].sort((a, b) => Number(b.includes('lite')) - Number(a.includes('lite')));
  return {
    coding: cheapFirst, // classification: lite first, it is the same taxonomy lookup for a third of the price
    analysis: [primary, ...rest],
    gatekeeper: [primary, ...rest],
    synthesis: [primary, ...rest],
  };
}

function build(name: ProviderName, cfg: ReturnType<typeof brainConfig>): AIProvider | null {
  if (name === 'gemini') return cfg.geminiApiKey ? new GeminiProvider({ apiKey: cfg.geminiApiKey, modelsByTask: geminiModels(cfg), fetchImpl: fetchOverride ?? undefined }) : null;
  if (name === 'openrouter') {
    if (!cfg.openRouterApiKey) return null;
    refreshOpenRouterPrices(cfg.openRouterApiKey);
    const models = cfg.openRouterModels;
    return new OpenAICompatProvider({
      providerName: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: cfg.openRouterApiKey,
      // Attribution headers OpenRouter asks integrations to send.
      headers: { 'HTTP-Referer': 'https://github.com/bbo/bbo-brain', 'X-Title': 'BBO BRAIN' },
      modelsByTask: { coding: models, analysis: models, gatekeeper: models, synthesis: models },
      visionModel: (model) => /-vl-|vision/.test(model),
      fetchImpl: fetchOverride ?? undefined,
    });
  }
  if (!cfg.nvidiaApiKey) return null;
  return new OpenAICompatProvider({
    providerName: 'nvidia',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKey: cfg.nvidiaApiKey,
    modelsByTask: { coding: cfg.nvidiaModels, analysis: cfg.nvidiaModels, gatekeeper: cfg.nvidiaModels, synthesis: cfg.nvidiaModels },
    // Reasoning-tuned hosted models otherwise answer taxonomy questions with prose.
    extraBody: (model) => (model.includes('nemotron-3') ? { chat_template_kwargs: { thinking: false } } : {}),
    fetchImpl: fetchOverride ?? undefined,
  });
}

let pricesLoaded = false;
/** One catalogue read per process: keeps cost estimates honest without hardcoding prices. */
function refreshOpenRouterPrices(apiKey: string): void {
  if (pricesLoaded) return;
  pricesLoaded = true;
  void loadOpenRouterCatalogue(apiKey, fetchOverride ?? undefined).catch(() => {
    pricesLoaded = false; // a failed refresh just leaves the static list prices in place
  });
}

export function availableProviders(): AIProvider[] {
  const cfg = brainConfig();
  return (['gemini', 'openrouter', 'nvidia'] as ProviderName[]).map((n) => build(n, cfg)).filter((p): p is AIProvider => p !== null);
}

export function providerNamed(name: ProviderName): AIProvider | null {
  return build(name, brainConfig());
}

/**
 * Ordered attempts for a task: the configured preference first, then the rest
 * of that provider's models, then other providers' preferred models. Returns an
 * empty list when nothing is configured at all.
 */
export function candidatesFor(task: TaskClass): Candidate[] {
  const cfg = brainConfig();
  const wanted = cfg.tasks[task];
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const push = (provider: AIProvider, model: string) => {
    const key = `${provider.providerName}:${model}`;
    if (!model || seen.has(key)) return;
    seen.add(key);
    out.push({ provider, model });
  };

  if (wanted.provider) {
    const preferred = providerNamed(wanted.provider as ProviderName);
    if (preferred) {
      if (wanted.model) push(preferred, wanted.model);
      for (const m of preferred.models(task)) push(preferred, m);
    }
  }
  if (!cfg.allowFallback && out.length) return out;

  for (const name of DEFAULT_ORDER[task]) {
    const provider = build(name, cfg);
    if (!provider) continue;
    for (const model of provider.models(task)) push(provider, model);
    if (!cfg.allowFallback) break;
  }
  return out;
}

export async function healthChecks(): Promise<HealthResult[]> {
  const results: HealthResult[] = [];
  for (const provider of availableProviders()) {
    results.push(await provider.healthCheck());
  }
  return results;
}

export function providerSummary(): Array<{ provider: ProviderName; configured: boolean; models: string[] }> {
  const cfg = brainConfig();
  return [
    { provider: 'gemini' as const, configured: Boolean(cfg.geminiApiKey), models: cfg.geminiModels },
    { provider: 'openrouter' as const, configured: Boolean(cfg.openRouterApiKey), models: cfg.openRouterModels },
    { provider: 'nvidia' as const, configured: Boolean(cfg.nvidiaApiKey), models: cfg.nvidiaModels },
  ];
}

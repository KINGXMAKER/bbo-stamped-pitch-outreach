import type { Capability, ProviderName } from './types';

/**
 * The single source of truth for model ids and provider ordering.
 *
 * Nothing in a route handler, prompt or component may name a model. Everything
 * reads from here, and everything here reads from the environment first so a
 * model that disappears can be swapped without a code change.
 */

type ModelDefaults = Record<Capability, string>;

type ProviderConfig = {
  /** Env var holding the key. Never read anywhere else. */
  apiKeyEnv: string;
  /** Env var per capability. Empty or unset falls back to `defaults`. */
  modelEnv: Record<Capability, string>;
  defaults: ModelDefaults;
  /**
   * Whether the provider's configured vision model can genuinely accept
   * images. NVIDIA's text models silently ignore image parts, so a text-only
   * id there must drop the provider from the vision chain rather than return
   * an answer invented from the prompt alone.
   */
  visionCapableModels: readonly string[] | 'any';
};

const PROVIDER_CONFIG: Record<ProviderName, ProviderConfig> = {
  google: {
    apiKeyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY',
    modelEnv: { vision: 'GOOGLE_VISION_MODEL', creative: 'GOOGLE_CREATIVE_MODEL' },
    defaults: { vision: 'gemini-2.5-flash', creative: 'gemini-2.5-flash' },
    visionCapableModels: 'any',
  },
  openrouter: {
    apiKeyEnv: 'OPENROUTER_API_KEY',
    modelEnv: { vision: 'OPENROUTER_VISION_MODEL', creative: 'OPENROUTER_CREATIVE_MODEL' },
    // The best creative reasoner and the best multimodal model are not the
    // same model, so these are deliberately different defaults.
    defaults: {
      vision: 'google/gemini-2.5-flash',
      // Measured on the real Reel prompt: claude-sonnet-4.5 takes ~112s and
      // overruns the per-attempt cap in production, while this writes the same
      // volume (~6.1k tokens) in ~38s for roughly half the cost.
      creative: 'google/gemini-3.5-flash',
    },
    visionCapableModels: 'any',
  },
  nvidia: {
    apiKeyEnv: 'NVIDIA_API_KEY',
    modelEnv: { vision: 'NVIDIA_VISION_MODEL', creative: 'NVIDIA_CREATIVE_MODEL' },
    defaults: {
      vision: 'meta/llama-3.2-11b-vision-instruct',
      creative: 'nvidia/nemotron-3-super-120b-a12b',
    },
    // NVIDIA hosts mostly text-only models. Only ids known to take images are
    // allowed to serve the vision capability.
    visionCapableModels: [
      'meta/llama-3.2-11b-vision-instruct',
      'meta/llama-3.2-90b-vision-instruct',
      'microsoft/phi-3-vision-128k-instruct',
      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
    ],
  },
};

/** Built-in chain order, used for whatever the environment does not pin. */
export const DEFAULT_CHAIN: Record<Capability, ProviderName[]> = {
  // Gemini sees the location: it is the strongest and cheapest at reading a
  // room out of a photo set, and it is what the venue analysis is tuned for.
  vision: ['google', 'openrouter', 'nvidia'],
  // OpenRouter is the creative director. Google is the real safety net: it
  // answers a Reel set in ~31s with clean JSON. NVIDIA is last because it took
  // 132s on the same prompt and emitted a malformed object (a stray leading
  // brace), so putting it second would spend most of the budget before the
  // provider that can actually finish the job gets a turn.
  creative: ['openrouter', 'google', 'nvidia'],
};

export function apiKeyEnvFor(provider: ProviderName): string {
  return PROVIDER_CONFIG[provider].apiKeyEnv;
}

export function apiKeyFor(provider: ProviderName): string | undefined {
  return process.env[PROVIDER_CONFIG[provider].apiKeyEnv]?.trim() || undefined;
}

export function modelFor(provider: ProviderName, capability: Capability): string | null {
  const config = PROVIDER_CONFIG[provider];
  const configured = process.env[config.modelEnv[capability]]?.trim();
  const model = configured || config.defaults[capability];
  if (!model) return null;
  if (capability === 'vision' && !supportsVision(provider, model)) return null;
  return model;
}

export function supportsVision(provider: ProviderName, model: string): boolean {
  const allowed = PROVIDER_CONFIG[provider].visionCapableModels;
  if (allowed === 'any') return true;
  return allowed.includes(model);
}

/** Reported by the debug panel so the operator can see the live wiring. */
export function describeRouting(): Array<{
  capability: Capability;
  chain: Array<{ provider: ProviderName; model: string | null; configured: boolean }>;
}> {
  return (['vision', 'creative'] as Capability[]).map((capability) => ({
    capability,
    chain: DEFAULT_CHAIN[capability].map((provider) => ({
      provider,
      model: modelFor(provider, capability),
      configured: Boolean(apiKeyFor(provider)),
    })),
  }));
}

import type { AiImage, GenerateRequest } from '../gemini';

/**
 * Provider-neutral contract for the intelligence pipeline. Nothing above this
 * layer knows which company answered — only which task class it asked for.
 */

export type ProviderName = 'gemini' | 'openrouter' | 'nvidia';

/**
 * Task classes exist so simple work never buys premium tokens:
 * - coding: controlled-taxonomy classification (bulk, cheap model)
 * - analysis: why a post won or lost (low volume, stronger model)
 * - gatekeeper: independent review — always a separate call from generation
 * - synthesis: weekly/monthly narrative and Ask BBO (rare, stronger model)
 */
export type TaskClass = 'coding' | 'analysis' | 'gatekeeper' | 'synthesis';

export const TASK_CLASSES: TaskClass[] = ['coding', 'analysis', 'gatekeeper', 'synthesis'];

export type TokenUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };

export type ProviderResult = {
  text: string;
  providerName: ProviderName;
  modelName: string;
  usage: TokenUsage;
  /** Priced from the provider's published rates; 0 for free-tier hosts. */
  estimatedCost: number;
  latencyMs: number;
};

export type HealthResult = {
  providerName: ProviderName;
  modelName: string;
  ok: boolean;
  latencyMs: number;
  detail: string;
};

export interface AIProvider {
  readonly providerName: ProviderName;
  /** Ordered candidates: index 0 is this provider's preferred model for the task. */
  models(task: TaskClass): string[];
  /** Whether this model can see hook frames. A vendor can host both kinds. */
  acceptsImages(model: string): boolean;
  /** Structured, schema-bound output (JSON mode where the provider has one). */
  generateStructured(req: GenerateRequest, model: string): Promise<ProviderResult>;
  /** Longer-form reasoning output, still returned as JSON. */
  generateAnalysis(req: GenerateRequest, model: string): Promise<ProviderResult>;
  healthCheck(model?: string): Promise<HealthResult>;
}

export type { AiImage, GenerateRequest };

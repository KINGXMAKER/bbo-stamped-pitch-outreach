import { AiError, geminiGenerator, type GenerateRequest } from '../gemini';
import { estimateCost } from '../pricing';
import type { AIProvider, HealthResult, ProviderResult, TaskClass, TokenUsage } from './types';

/**
 * Gemini as one provider among several. Model fallback lives in the registry,
 * so this wrapper is always pinned to the single model it was asked for.
 */
export class GeminiProvider implements AIProvider {
  readonly providerName = 'gemini' as const;
  acceptsImages(): boolean {
    return true;
  }
  private readonly apiKey: string;
  private readonly modelsByTask: Record<TaskClass, string[]>;
  private readonly fetchImpl?: typeof fetch;

  constructor(opts: { apiKey: string; modelsByTask: Record<TaskClass, string[]>; fetchImpl?: typeof fetch }) {
    this.apiKey = opts.apiKey;
    this.modelsByTask = opts.modelsByTask;
    this.fetchImpl = opts.fetchImpl;
  }

  models(task: TaskClass): string[] {
    return this.modelsByTask[task] ?? [];
  }

  generateStructured(req: GenerateRequest, model: string): Promise<ProviderResult> {
    // Taxonomy classification needs no thinking budget — it is a lookup, not a puzzle.
    return this.call({ ...req, thinkingBudget: req.thinkingBudget ?? 0 }, model);
  }

  generateAnalysis(req: GenerateRequest, model: string): Promise<ProviderResult> {
    return this.call(req, model);
  }

  async healthCheck(model?: string): Promise<HealthResult> {
    const target = model ?? this.models('coding')[0] ?? '';
    const started = Date.now();
    if (!target) return { providerName: this.providerName, modelName: '—', ok: false, latencyMs: 0, detail: 'no model configured' };
    try {
      const res = await this.call({ system: 'Reply with compact JSON only.', prompt: 'Return exactly {"ok":true}', temperature: 0, maxOutputTokens: 32, thinkingBudget: 0, timeoutMs: 60_000 }, target);
      const ok = res.text.includes('"ok"');
      return { providerName: this.providerName, modelName: target, ok, latencyMs: res.latencyMs, detail: ok ? 'responded with valid JSON' : `unexpected reply: ${res.text.slice(0, 60)}` };
    } catch (err) {
      return { providerName: this.providerName, modelName: target, ok: false, latencyMs: Date.now() - started, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private async call(req: GenerateRequest, model: string): Promise<ProviderResult> {
    const started = Date.now();
    const generate = geminiGenerator({ apiKey: this.apiKey, models: [model], fetchImpl: this.fetchImpl, attempts: 1 });
    const result = await generate(req);
    const usage: TokenUsage = {
      inputTokens: result.usage?.promptTokens,
      outputTokens: result.usage?.outputTokens,
      totalTokens: result.usage?.totalTokens,
    };
    if (!result.text) throw new AiError({ kind: 'bad-output', model, message: `gemini ${model} returned no content` });
    return {
      text: result.text,
      providerName: this.providerName,
      modelName: result.model,
      usage,
      estimatedCost: estimateCost('gemini', model, usage),
      latencyMs: Date.now() - started,
    };
  }
}

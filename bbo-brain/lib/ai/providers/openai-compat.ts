import { AiError, classifyStatus, type GenerateRequest } from '../gemini';
import { estimateCost, setPrice } from '../pricing';
import type { AIProvider, HealthResult, ProviderName, ProviderResult, TaskClass, TokenUsage } from './types';

/**
 * One transport for every OpenAI-compatible host (OpenRouter, NVIDIA NIM).
 * Failures are classified from the HTTP status the host returned — never by
 * scanning the message for digits (see repo CLAUDE.md).
 */

export type CompatOptions = {
  providerName: ProviderName;
  baseUrl: string;
  apiKey: string;
  /** Preferred model per task class; index 0 is tried first. */
  modelsByTask: Record<TaskClass, string[]>;
  headers?: Record<string, string>;
  supportsImages?: boolean;
  /** Some hosts need a body flag to stop a reasoning model emitting prose. */
  extraBody?: (model: string, req: GenerateRequest) => Record<string, unknown>;
  fetchImpl?: typeof fetch;
};

type ChatResponse = {
  choices?: Array<{ message?: { content?: string | null; reasoning?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  model?: string;
  error?: { message?: string; code?: number | string };
};

export class OpenAICompatProvider implements AIProvider {
  readonly providerName: ProviderName;
  readonly supportsImages: boolean;
  private readonly opts: CompatOptions;
  private readonly fetchImpl: typeof fetch;
  /** Models that rejected JSON mode outright, learned from the host's own 400. */
  private readonly noJsonMode = new Set<string>();

  constructor(opts: CompatOptions) {
    this.opts = opts;
    this.providerName = opts.providerName;
    this.supportsImages = opts.supportsImages ?? false;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  models(task: TaskClass): string[] {
    return this.opts.modelsByTask[task] ?? [];
  }

  generateStructured(req: GenerateRequest, model: string): Promise<ProviderResult> {
    return this.call(req, model, { jsonMode: true, maxTokens: req.maxOutputTokens ?? 4096 });
  }

  generateAnalysis(req: GenerateRequest, model: string): Promise<ProviderResult> {
    return this.call(req, model, { jsonMode: true, maxTokens: req.maxOutputTokens ?? 8192 });
  }

  async healthCheck(model?: string): Promise<HealthResult> {
    const target = model ?? this.models('coding')[0] ?? this.models('analysis')[0] ?? '';
    const started = Date.now();
    if (!target) return { providerName: this.providerName, modelName: '—', ok: false, latencyMs: 0, detail: 'no model configured' };
    try {
      const res = await this.call(
        { system: 'Reply with compact JSON only.', prompt: 'Return exactly {"ok":true}', temperature: 0, maxOutputTokens: 32, timeoutMs: 60_000 },
        target,
        { jsonMode: true, maxTokens: 32 }
      );
      const ok = res.text.includes('"ok"');
      return { providerName: this.providerName, modelName: target, ok, latencyMs: res.latencyMs, detail: ok ? 'responded with valid JSON' : `unexpected reply: ${res.text.slice(0, 60)}` };
    } catch (err) {
      return {
        providerName: this.providerName,
        modelName: target,
        ok: false,
        latencyMs: Date.now() - started,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async call(req: GenerateRequest, model: string, opts: { jsonMode: boolean; maxTokens: number }): Promise<ProviderResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 120_000);
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: req.prompt }];
    for (const img of this.supportsImages ? (req.images ?? []) : []) {
      content.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}` } });
    }
    const jsonMode = opts.jsonMode && !this.noJsonMode.has(model);
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: content.length === 1 ? req.prompt : content },
      ],
      temperature: req.temperature ?? 0.3,
      max_tokens: opts.maxTokens,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      ...(this.opts.extraBody?.(model, req) ?? {}),
    };

    try {
      const res = await this.fetchImpl(`${this.opts.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${this.opts.apiKey}`, ...(this.opts.headers ?? {}) },
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        // A host that refuses JSON mode for this model says so with a 400. Learn
        // it once and retry plainly rather than losing the model entirely.
        if (res.status === 400 && jsonMode) {
          this.noJsonMode.add(model);
          clearTimeout(timer);
          return this.call(req, model, opts);
        }
        throw new AiError({
          kind: classifyStatus(res.status),
          status: res.status,
          model,
          message: `${this.providerName} ${model} returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`,
        });
      }
      const data = (await res.json()) as ChatResponse;
      // Reasoning models put chain-of-thought in a separate field. We never read
      // it, never store it, and treat an answer-free response as a failure.
      const text = (data.choices?.[0]?.message?.content ?? '').trim();
      if (!text) {
        throw new AiError({
          kind: 'bad-output',
          model,
          message: `${this.providerName} ${model} returned no answer content (${data.choices?.[0]?.finish_reason ?? 'no choice'})`,
        });
      }
      const usage: TokenUsage = {
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      };
      return {
        text,
        providerName: this.providerName,
        modelName: data.model ?? model,
        usage,
        estimatedCost: estimateCost(this.providerName, model, usage),
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      if (err instanceof AiError) throw err;
      const aborted = err instanceof Error && err.name === 'AbortError';
      throw new AiError({ kind: 'transient', model, message: `${this.providerName} ${model} ${aborted ? 'timed out' : 'request failed'}` });
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Reads OpenRouter's live catalogue so model slugs and prices are never assumed. */
export async function loadOpenRouterCatalogue(apiKey: string, fetchImpl: typeof fetch | undefined = fetch): Promise<Array<{ id: string; name: string; contextLength: number | null; inputPerMTok: number; outputPerMTok: number }>> {
  const res = await (fetchImpl ?? fetch)('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new AiError({ kind: classifyStatus(res.status), status: res.status, message: `OpenRouter catalogue returned HTTP ${res.status}` });
  const data = (await res.json()) as { data?: Array<{ id: string; name?: string; context_length?: number; pricing?: { prompt?: string; completion?: string } }> };
  return (data.data ?? []).map((m) => {
    const inputPerMTok = Number(m.pricing?.prompt ?? 0) * 1_000_000;
    const outputPerMTok = Number(m.pricing?.completion ?? 0) * 1_000_000;
    setPrice(m.id, { inputPerMTok, outputPerMTok, source: 'catalogue' });
    return { id: m.id, name: m.name ?? m.id, contextLength: m.context_length ?? null, inputPerMTok, outputPerMTok };
  });
}

import { apiKeyFor, modelFor } from '../models';
import { AiProviderError, classifyStatus } from '../types';
import type {
  AiProvider,
  Capability,
  GenerateArgs,
  ProviderName,
  ProviderResult,
  UsageInfo,
} from '../types';

type Config = {
  name: ProviderName;
  baseUrl: string;
  extraHeaders?: Record<string, string>;
};

type ChatResponse = {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
  error?: { message?: string; code?: number | string };
};

/**
 * OpenRouter and NVIDIA NIM both speak the OpenAI chat-completions dialect, so
 * they share one implementation. Only the base URL, key and model ids differ —
 * and all three come from the central model config, never from a call site.
 *
 * Everything provider-specific stops here: callers receive `ProviderResult`
 * and `AiProviderError`, and never see an OpenRouter response envelope.
 */
export function createOpenAiCompatibleProvider(config: Config): AiProvider {
  return {
    name: config.name,

    model(capability: Capability) {
      return modelFor(config.name, capability);
    },

    isConfigured(capability: Capability) {
      return Boolean(apiKeyFor(config.name) && this.model(capability));
    },

    async generate(args: GenerateArgs, capability: Capability): Promise<ProviderResult> {
      const key = apiKeyFor(config.name);
      const model = this.model(capability);
      if (!key || !model) {
        throw new AiProviderError({
          kind: 'not-configured',
          provider: config.name,
          message: `${config.name} has no key or no usable ${capability} model configured.`,
        });
      }

      const content: Array<Record<string, unknown>> = [];
      for (const image of args.images ?? []) {
        content.push({
          type: 'image_url',
          image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
        });
      }
      content.push({ type: 'text', text: args.prompt });

      // The caller's signal and our own timeout both have to be able to cancel.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), args.timeoutMs);
      const onCallerAbort = () => controller.abort();
      args.signal?.addEventListener('abort', onCallerAbort, { once: true });

      try {
        const res = await fetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
            ...(config.extraHeaders ?? {}),
          },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: args.system },
              { role: 'user', content },
            ],
            response_format: { type: 'json_object' },
            temperature: args.temperature ?? 0.8,
            max_tokens: args.maxTokens ?? 8192,
            stream: false,
          }),
        });

        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          throw new AiProviderError({
            kind: classifyStatus(res.status),
            provider: config.name,
            status: res.status,
            message: `${config.name} returned ${res.status}`,
            detail: redact(detail).slice(0, 400),
          });
        }

        const data = (await res.json()) as ChatResponse;

        // OpenRouter tunnels some upstream failures inside a 200 body.
        if (data.error) {
          const status = typeof data.error.code === 'number' ? data.error.code : 502;
          throw new AiProviderError({
            kind: classifyStatus(status),
            provider: config.name,
            status,
            message: `${config.name} reported an upstream error`,
            detail: redact(data.error.message ?? '').slice(0, 400),
          });
        }

        const text = data.choices?.[0]?.message?.content?.trim() ?? '';
        if (!text) {
          throw new AiProviderError({
            kind: 'transient',
            provider: config.name,
            message: `${config.name} returned an empty response.`,
          });
        }

        return { text, model: data.model || model, usage: readUsage(data) };
      } catch (err) {
        if (err instanceof AiProviderError) throw err;
        const aborted = err instanceof Error && err.name === 'AbortError';
        throw new AiProviderError({
          kind: aborted && args.signal?.aborted ? 'aborted' : 'transient',
          provider: config.name,
          message: aborted
            ? `${config.name} request timed out.`
            : `${config.name} request failed.`,
        });
      } finally {
        clearTimeout(timer);
        args.signal?.removeEventListener('abort', onCallerAbort);
      }
    },
  };
}

function readUsage(data: ChatResponse): UsageInfo | undefined {
  const usage = data.usage;
  if (!usage) return undefined;
  const info: UsageInfo = {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    reportedCostUsd: usage.cost,
  };
  return Object.values(info).some((value) => value !== undefined) ? info : undefined;
}

/** Belt and braces: an error body echoed back must never carry a credential. */
function redact(text: string): string {
  return text.replace(/(sk-[A-Za-z0-9-]{8})[A-Za-z0-9-_]+/g, '$1…redacted');
}

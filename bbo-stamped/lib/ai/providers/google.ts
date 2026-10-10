import { apiKeyFor, modelFor } from '../models';
import { AiProviderError, classifyStatus } from '../types';
import type { AiProvider, Capability, GenerateArgs, ProviderResult, UsageInfo } from '../types';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Hard ceiling for the 2.5 Flash family; the request is clamped to it. */
const MAX_OUTPUT_TOKENS = 65_536;

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    /** Reasoning tokens. These are billed and capped alongside the output. */
    thoughtsTokenCount?: number;
  };
};

export const googleProvider: AiProvider = {
  name: 'google',

  model(capability) {
    return modelFor('google', capability);
  },

  isConfigured(capability) {
    return Boolean(apiKeyFor('google') && this.model(capability));
  },

  async generate(args: GenerateArgs, capability: Capability): Promise<ProviderResult> {
    const key = apiKeyFor('google');
    const model = this.model(capability);
    if (!key || !model) {
      throw new AiProviderError({
        kind: 'not-configured',
        provider: 'google',
        message: `Google has no key or no usable ${capability} model configured.`,
      });
    }

    const parts: Array<Record<string, unknown>> = [];
    for (const image of args.images ?? []) {
      parts.push({ inline_data: { mime_type: image.mediaType, data: image.base64 } });
    }
    parts.push({ text: args.prompt });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), args.timeoutMs);
    const onCallerAbort = () => controller.abort();
    args.signal?.addEventListener('abort', onCallerAbort, { once: true });

    try {
      const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          systemInstruction: { parts: [{ text: args.system }] },
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: args.temperature ?? 0.8,
            // Gemini 2.5 spends reasoning tokens out of this same allowance —
            // a Reel set burned 5.5k on thoughts and got truncated mid-string
            // at a 10k cap. Give thinking its own headroom so the caller's
            // token budget is what actually reaches the JSON.
            maxOutputTokens: Math.min(MAX_OUTPUT_TOKENS, (args.maxTokens ?? 8192) * 3),
          },
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new AiProviderError({
          kind: classifyStatus(res.status),
          provider: 'google',
          status: res.status,
          message: `Google returned ${res.status}`,
          // The key travels in the query string, so never echo a URL back.
          detail: detail.replace(/key=[^&"\s]+/g, 'key=redacted').slice(0, 400),
        });
      }

      const data = (await res.json()) as GeminiResponse;
      const candidate = data.candidates?.[0];
      const text = (candidate?.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('')
        .trim();

      if (!text) {
        throw new AiProviderError({
          kind: 'transient',
          provider: 'google',
          message: 'Google returned an empty response.',
        });
      }

      // Truncated output is not a usable answer. Saying so here produces an
      // honest "ran out of room" error instead of handing half a JSON object
      // to the validator, which reports a baffling parse error three layers on.
      if (candidate?.finishReason === 'MAX_TOKENS') {
        throw new AiProviderError({
          kind: 'transient',
          provider: 'google',
          message: 'Google hit its output limit before finishing the JSON.',
          detail: `thoughts=${data.usageMetadata?.thoughtsTokenCount ?? '?'} output=${data.usageMetadata?.candidatesTokenCount ?? '?'}`,
        });
      }

      return { text, model, usage: readUsage(data) };
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      const aborted = err instanceof Error && err.name === 'AbortError';
      throw new AiProviderError({
        kind: aborted && args.signal?.aborted ? 'aborted' : 'transient',
        provider: 'google',
        message: aborted ? 'Google request timed out.' : 'Google request failed.',
      });
    } finally {
      clearTimeout(timer);
      args.signal?.removeEventListener('abort', onCallerAbort);
    }
  },
};

function readUsage(data: GeminiResponse): UsageInfo | undefined {
  const usage = data.usageMetadata;
  if (!usage) return undefined;
  // Google does not report a price, so no cost field is invented here.
  return {
    promptTokens: usage.promptTokenCount,
    completionTokens: usage.candidatesTokenCount,
    totalTokens: usage.totalTokenCount,
  };
}

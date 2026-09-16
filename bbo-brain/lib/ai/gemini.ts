/**
 * Gemini REST provider. Failures are classified from the HTTP status Google
 * returned — never by scanning the message for digits (see repo CLAUDE.md).
 */

export type AiFailureKind = 'not-configured' | 'transient' | 'model-unavailable' | 'hard' | 'bad-output';

export class AiError extends Error {
  readonly kind: AiFailureKind;
  readonly status?: number;
  readonly model?: string;

  constructor(args: { kind: AiFailureKind; message: string; status?: number; model?: string }) {
    super(args.message);
    this.name = 'AiError';
    this.kind = args.kind;
    this.status = args.status;
    this.model = args.model;
  }
}

export function classifyStatus(status: number): AiFailureKind {
  if (status === 404) return 'model-unavailable';
  if (status === 408 || status === 409 || status === 429 || status >= 500) return 'transient';
  return 'hard';
}

export type AiImage = { mimeType: string; base64: string };

export type GenerateRequest = {
  system: string;
  prompt: string;
  images?: AiImage[];
  temperature?: number;
  maxOutputTokens?: number;
  /** Only sent to models that support thinking (2.5 family). 0 disables it. */
  thinkingBudget?: number;
  timeoutMs?: number;
};

export type GenerateResult = {
  text: string;
  model: string;
  provider: string;
  usage?: { promptTokens?: number; outputTokens?: number; totalTokens?: number };
};

export type Generator = (req: GenerateRequest) => Promise<GenerateResult>;

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
};

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export function geminiGenerator(opts: { apiKey: string; models: string[]; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }): Generator {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  return async (req) => {
    let last: AiError | null = null;
    // A retired model at the end of the chain must not mask the real reason the
    // run failed (usually a 429 quota wall on the models we actually wanted).
    const remember = (err: AiError) => {
      last = last && last.kind !== 'model-unavailable' && err.kind === 'model-unavailable' ? last : err;
    };
    for (const model of opts.models) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        if (attempt > 1) await sleep(1500);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 90_000);
        try {
          const parts: Array<Record<string, unknown>> = (req.images ?? []).map((img) => ({ inline_data: { mime_type: img.mimeType, data: img.base64 } }));
          parts.push({ text: req.prompt });
          const generationConfig: Record<string, unknown> = {
            responseMimeType: 'application/json',
            temperature: req.temperature ?? 0.4,
            maxOutputTokens: req.maxOutputTokens ?? 8192,
          };
          if (model.startsWith('gemini-2.5') && req.thinkingBudget !== undefined) {
            generationConfig.thinkingConfig = { thinkingBudget: req.thinkingBudget };
          }
          const res = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
            signal: controller.signal,
            body: JSON.stringify({ contents: [{ role: 'user', parts }], systemInstruction: { parts: [{ text: req.system }] }, generationConfig }),
          });
          if (!res.ok) {
            const kind = classifyStatus(res.status);
            const failure = new AiError({ kind, status: res.status, model, message: `Gemini ${model} returned HTTP ${res.status}` });
            remember(failure);
            if (kind === 'transient' && attempt < 2) continue;
            if (kind === 'hard') throw failure;
            break; // model-unavailable or exhausted transient retries → next model
          }
          const data = (await res.json()) as GeminiResponse;
          const text = (data.candidates?.[0]?.content?.parts ?? [])
            .filter((p) => !p.thought)
            .map((p) => p.text ?? '')
            .join('')
            .trim();
          if (!text) {
            remember(new AiError({ kind: 'transient', model, message: `Gemini ${model} returned an empty response (${data.candidates?.[0]?.finishReason ?? 'no candidate'})` }));
            continue;
          }
          return {
            text,
            model,
            provider: 'google',
            usage: {
              promptTokens: data.usageMetadata?.promptTokenCount,
              outputTokens: data.usageMetadata?.candidatesTokenCount,
              totalTokens: data.usageMetadata?.totalTokenCount,
            },
          };
        } catch (err) {
          if (err instanceof AiError) throw err;
          const aborted = err instanceof Error && err.name === 'AbortError';
          remember(new AiError({ kind: 'transient', model, message: aborted ? `Gemini ${model} timed out` : `Gemini ${model} request failed` }));
          if (aborted) break; // too slow today — give the next model its turn
        } finally {
          clearTimeout(timer);
        }
      }
    }
    throw last ?? new AiError({ kind: 'transient', message: 'Every Gemini model failed.' });
  };
}

export type ProviderName = 'google' | 'openrouter' | 'nvidia';
export type Capability = 'vision' | 'creative';

export type AiImage = {
  /** Raw base64, no `data:` prefix. */
  base64: string;
  mediaType: string;
};

export type GenerateArgs = {
  system: string;
  prompt: string;
  images?: AiImage[];
  maxTokens?: number;
  temperature?: number;
  /** Hard per-attempt wall-clock cap in ms. */
  timeoutMs: number;
  /** Caller-owned cancellation, combined with the timeout. */
  signal?: AbortSignal;
};

/** Only ever populated from what the provider actually reported. */
export type UsageInfo = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** Provider-reported cost in USD. Never estimated locally. */
  reportedCostUsd?: number;
};

export type ProviderResult = {
  text: string;
  model: string;
  usage?: UsageInfo;
};

/**
 * Failure classes. These are decided from the HTTP status the provider
 * actually returned — never by scanning a message for loose digits, which
 * misreads retry-delay hints and quota values (see CLAUDE.md).
 */
export type FailureKind =
  | 'not-configured' // no API key / no usable model — skip this provider
  | 'transient' // 408/409/429/5xx/timeout — retry, then fall through
  | 'model-unavailable' // 404 — model gone, try the next provider
  | 'hard' // 400/401/403 — bad key or malformed request, never retry
  | 'bad-output' // provider answered but the payload failed validation
  | 'aborted'; // caller cancelled

export class AiProviderError extends Error {
  readonly kind: FailureKind;
  readonly provider: ProviderName | 'router';
  readonly status?: number;
  readonly detail?: string;

  constructor(args: {
    kind: FailureKind;
    provider: ProviderName | 'router';
    message: string;
    status?: number;
    detail?: string;
  }) {
    super(args.message);
    this.name = 'AiProviderError';
    this.kind = args.kind;
    this.provider = args.provider;
    this.status = args.status;
    this.detail = args.detail;
  }
}

/** Maps an HTTP status onto a failure class. Status only — no text sniffing. */
export function classifyStatus(status: number): FailureKind {
  if (status === 404) return 'model-unavailable';
  if (status === 408 || status === 409 || status === 429) return 'transient';
  if (status >= 500) return 'transient';
  return 'hard';
}

export interface AiProvider {
  readonly name: ProviderName;
  /** Model id configured for this capability, or null when unusable. */
  model(capability: Capability): string | null;
  isConfigured(capability: Capability): boolean;
  generate(args: GenerateArgs, capability: Capability): Promise<ProviderResult>;
}

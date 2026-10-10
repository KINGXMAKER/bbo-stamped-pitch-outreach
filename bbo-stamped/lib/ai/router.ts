import type { z } from 'zod';
import { DEFAULT_CHAIN } from './models';
import { googleProvider } from './providers/google';
import { openrouterProvider } from './providers/openrouter';
import { nvidiaProvider } from './providers/nvidia';
import { AiProviderError } from './types';
import type { AiImage, AiProvider, Capability, ProviderName, UsageInfo } from './types';
import type { GenerationAttempt, GenerationInfo } from '@/types';

const PROVIDERS: Record<ProviderName, AiProvider> = {
  google: googleProvider,
  openrouter: openrouterProvider,
  nvidia: nvidiaProvider,
};

function isProviderName(value: string): value is ProviderName {
  return value === 'google' || value === 'openrouter' || value === 'nvidia';
}

/**
 * Chain order = the configured primary for this capability, then the configured
 * fallback, then the built-in order from lib/ai/models.ts. De-duplicated, and
 * any provider without a key — or without a model that can do the job — is
 * dropped before a single request goes out.
 */
export function buildChain(capability: Capability): AiProvider[] {
  const primaryEnv =
    capability === 'vision' ? process.env.AI_VISION_PROVIDER : process.env.AI_CREATIVE_PROVIDER;

  // AI_FALLBACK_PROVIDER is the *creative* fallback — NVIDIA's role in this
  // architecture. Applying it to vision as well would push a text-first
  // provider ahead of OpenRouter's multimodal model, so vision keeps its own
  // built-in order behind whatever AI_VISION_PROVIDER pins.
  const fallbackEnv =
    capability === 'creative' ? process.env.AI_FALLBACK_PROVIDER : undefined;

  const ordered: ProviderName[] = [];
  for (const candidate of [primaryEnv?.trim(), fallbackEnv?.trim()]) {
    if (candidate && isProviderName(candidate)) ordered.push(candidate);
  }
  ordered.push(...DEFAULT_CHAIN[capability]);

  const seen = new Set<ProviderName>();
  const chain: AiProvider[] = [];
  for (const name of ordered) {
    if (seen.has(name)) continue;
    seen.add(name);
    const provider = PROVIDERS[name];
    if (provider.isConfigured(capability)) chain.push(provider);
  }
  return chain;
}

/**
 * Strips code fences and pulls the outermost JSON object out of a response.
 *
 * This is a recovery layer, not the architecture: every provider is asked for
 * JSON mode, and the result is always Zod-validated. It exists because some
 * models (Claude via OpenRouter, for one) wrap valid JSON in ```json fences
 * even when JSON mode is requested.
 */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const candidates: string[] = [trimmed];

  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  if (unfenced !== trimmed) candidates.push(unfenced);

  const first = unfenced.indexOf('{');
  const last = unfenced.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(unfenced.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next strategy
    }
  }
  throw new AiProviderError({
    kind: 'bad-output',
    provider: 'router',
    message: 'Model response was not parseable JSON.',
  });
}

export type RunArgs<T> = {
  /** Named for observability: "location-scout", "reels", "shots"… */
  stage: string;
  capability: Capability;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  images?: AiImage[];
  maxTokens?: number;
  temperature?: number;
  /** Whole-operation wall clock, shared across every attempt. */
  budgetMs?: number;
  /** Per-attempt cap. Kept under the remaining budget automatically. */
  attemptTimeoutMs?: number;
  signal?: AbortSignal;
};

export type RunResult<T> = {
  data: T;
  generation: GenerationInfo;
};

const DEFAULT_BUDGET_MS = 110_000;
const DEFAULT_ATTEMPT_MS = 45_000;

/**
 * Runs one AI stage: provider chain, one transient retry per provider, a single
 * repair pass when the payload parses but fails validation, and a shared
 * deadline so a slow first provider can never eat the whole request budget.
 *
 * Every attempt — successful or not — is recorded, so the debug panel can show
 * exactly which provider answered and what the others did first.
 */
export async function runStage<T>(args: RunArgs<T>): Promise<RunResult<T>> {
  const budgetMs = args.budgetMs ?? DEFAULT_BUDGET_MS;
  const startedAt = Date.now();
  const deadline = startedAt + budgetMs;
  const chain = buildChain(args.capability);
  const attempts: GenerationAttempt[] = [];

  if (chain.length === 0) {
    throw new AiProviderError({
      kind: 'not-configured',
      provider: 'router',
      message:
        'No AI provider is configured on the server. Set at least one of GOOGLE_GENERATIVE_AI_API_KEY, OPENROUTER_API_KEY or NVIDIA_API_KEY.',
    });
  }

  let lastError: AiProviderError | null = null;

  const finish = (
    provider: AiProvider,
    model: string,
    usage: UsageInfo | undefined,
    validatedFirstTry: boolean
  ): GenerationInfo => ({
    stage: args.stage,
    providerUsed: provider.name,
    modelUsed: model,
    latencyMs: Date.now() - startedAt,
    fallbackOccurred: attempts.some((attempt) => attempt.status === 'error'),
    attemptCount: attempts.length,
    validatedFirstTry,
    attempts,
    usage,
    generatedAt: new Date().toISOString(),
  });

  for (const [chainIndex, provider] of chain.entries()) {
    const attemptsForProvider = 2; // first try + one transient retry

    // No single provider may spend the whole budget: each gets a slice so the
    // fallback it exists to protect against still gets a real turn. The slice
    // is never smaller than one full attempt, because half an attempt is worth
    // nothing — a big structured generation either finishes or it does not.
    const providersLeft = chain.length - chainIndex;
    const perAttempt = args.attemptTimeoutMs ?? DEFAULT_ATTEMPT_MS;
    const providerDeadline =
      providersLeft > 1
        ? Math.min(
            deadline,
            Date.now() +
              Math.max(perAttempt + 5_000, (deadline - Date.now()) / providersLeft + 15_000)
          )
        : deadline;

    for (let attempt = 0; attempt < attemptsForProvider; attempt++) {
      const remaining = Math.min(providerDeadline, deadline) - Date.now();
      if (remaining <= 3_000) {
        lastError =
          lastError ??
          new AiProviderError({
            kind: 'transient',
            provider: 'router',
            message: 'Ran out of time before a provider answered.',
          });
        break;
      }

      const timeoutMs = Math.min(args.attemptTimeoutMs ?? DEFAULT_ATTEMPT_MS, remaining - 1_000);
      const model = provider.model(args.capability);
      const attemptStart = Date.now();

      try {
        const result = await provider.generate(
          {
            system: args.system,
            prompt: args.prompt,
            images: args.images,
            maxTokens: args.maxTokens,
            temperature: args.temperature,
            timeoutMs,
            signal: args.signal,
          },
          args.capability
        );

        const parsed = args.schema.safeParse(extractJson(result.text));
        if (parsed.success) {
          attempts.push({
            provider: provider.name,
            model: result.model,
            status: 'ok',
            latencyMs: Date.now() - attemptStart,
          });
          return { data: parsed.data, generation: finish(provider, result.model, result.usage, true) };
        }

        // The payload came back but did not satisfy the schema. One repair pass
        // on the same provider, and only when there is real budget left.
        attempts.push({
          provider: provider.name,
          model: result.model,
          status: 'error',
          latencyMs: Date.now() - attemptStart,
          errorType: 'bad-output',
        });
        logAttempt(args.stage, provider.name, 'bad-output', undefined, summarise(parsed.error.issues));

        const repairBudget = deadline - Date.now();
        if (repairBudget > 15_000) {
          const repairStart = Date.now();
          try {
            const repaired = await provider.generate(
              {
                system: args.system,
                prompt: buildRepairPrompt(result.text, parsed.error.issues.slice(0, 12)),
                maxTokens: args.maxTokens,
                temperature: 0.2,
                timeoutMs: Math.min(timeoutMs, repairBudget - 1_000),
                signal: args.signal,
              },
              args.capability
            );
            const second = args.schema.safeParse(extractJson(repaired.text));
            if (second.success) {
              attempts.push({
                provider: provider.name,
                model: repaired.model,
                status: 'ok',
                latencyMs: Date.now() - repairStart,
              });
              return {
                data: second.data,
                generation: finish(provider, repaired.model, repaired.usage, false),
              };
            }
            attempts.push({
              provider: provider.name,
              model: repaired.model,
              status: 'error',
              latencyMs: Date.now() - repairStart,
              errorType: 'bad-output-after-repair',
            });
          } catch (repairError) {
            attempts.push({
              provider: provider.name,
              model,
              status: 'error',
              latencyMs: Date.now() - repairStart,
              errorType: repairError instanceof AiProviderError ? repairError.kind : 'transient',
            });
          }
        }

        lastError = new AiProviderError({
          kind: 'bad-output',
          provider: provider.name,
          message: `${provider.name} produced output that did not match the required shape.`,
          detail: summarise(parsed.error.issues),
        });
        break; // schema failures do not improve on a plain retry
      } catch (err) {
        const providerError =
          err instanceof AiProviderError
            ? err
            : new AiProviderError({
                kind: 'transient',
                provider: provider.name,
                message: `${provider.name} request failed.`,
              });

        attempts.push({
          provider: provider.name,
          model,
          status: 'error',
          latencyMs: Date.now() - attemptStart,
          errorType: providerError.kind,
          httpStatus: providerError.status,
        });
        lastError = providerError;
        logAttempt(
          args.stage,
          provider.name,
          providerError.kind,
          providerError.status,
          providerError.detail
        );

        // A cancelled request is the caller's decision — stop everything.
        if (providerError.kind === 'aborted') throw providerError;

        // A bad key or malformed request will not fix itself; skip the retry
        // and let the next provider in the chain have a turn.
        if (providerError.kind !== 'transient') break;

        // A timeout means this model is simply too slow for the budget today.
        // Retrying it identically burns the fallback's turn, so move on unless
        // there is comfortable room left.
        if (timedOut(providerError) && Math.min(providerDeadline, deadline) - Date.now() < timeoutMs) {
          break;
        }
      }
    }
  }

  throw (
    lastError ??
    new AiProviderError({
      kind: 'transient',
      provider: 'router',
      message: 'Every AI provider failed.',
    })
  );
}

function timedOut(error: AiProviderError): boolean {
  return error.kind === 'transient' && error.status === undefined && /timed out/.test(error.message);
}

function summarise(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .slice(0, 5)
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

/**
 * Every failed attempt is logged, not just the one that ends the chain —
 * otherwise a primary provider can fail silently behind a noisier fallback.
 * Provider detail is already redacted upstream; no header is ever logged.
 */
function logAttempt(
  stage: string,
  provider: string,
  kind: string,
  status?: number,
  detail?: string
): void {
  console.warn(
    `[bbo-ai] ${stage} attempt failed — ${provider} ${kind}${status ? ` ${status}` : ''}`,
    detail ?? ''
  );
}

function buildRepairPrompt(
  raw: string,
  issues: Array<{ path: PropertyKey[]; message: string }>
): string {
  const problems = issues
    .map((issue) => `- ${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  return [
    'Your previous response did not match the required JSON shape.',
    '',
    'Validation problems:',
    problems,
    '',
    'Here is what you returned:',
    raw.slice(0, 12_000),
    '',
    'Return the corrected JSON only. Keep all the real content you already wrote — fix only the structure, missing fields and wrong types. No markdown, no commentary.',
  ].join('\n');
}

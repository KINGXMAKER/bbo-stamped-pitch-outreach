import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { get, json, run, type Db } from '@/lib/db/client';
import { brainConfig } from '@/lib/config';
import { BudgetGuard, BudgetPausedError, averageRunCost } from './budget';
import { AiError, type AiImage, type Generator } from './gemini';
import { candidatesFor, type Candidate } from './providers/registry';
import type { ProviderResult, TaskClass } from './providers/types';

let override: Generator | null = null;

/** Tests and offline runs inject a generator; production uses the provider registry. */
export function setGenerator(generator: Generator | null): void {
  override = generator;
}

export function aiConfigured(): boolean {
  if (override) return true;
  const cfg = brainConfig();
  return Boolean(cfg.geminiApiKey || cfg.openRouterApiKey || cfg.nvidiaApiKey);
}

export function registerPrompt(db: Db, slug: string, template: string, schemaVersion: string): number {
  const checksum = createHash('sha256').update(`${schemaVersion}\n${template}`).digest('hex').slice(0, 16);
  const existing = get<{ id: number }>(db, 'SELECT id FROM prompt_versions WHERE slug = ? AND checksum = ?', slug, checksum);
  if (existing) return existing.id;
  const next = (get<{ v: number | null }>(db, 'SELECT MAX(version) AS v FROM prompt_versions WHERE slug = ?', slug)?.v ?? 0) + 1;
  return run(
    db,
    'INSERT INTO prompt_versions (slug, version, template, schema_version, checksum) VALUES (?, ?, ?, ?, ?)',
    slug,
    next,
    template,
    schemaVersion,
    checksum
  ).lastId;
}

/** Pulls the outermost JSON object out of a response (models sometimes fence JSON). */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  for (const candidate of [trimmed, unfenced]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // next strategy
    }
  }
  const first = unfenced.indexOf('{');
  const last = unfenced.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(unfenced.slice(first, last + 1));
    } catch {
      // fall through
    }
  }
  throw new AiError({ kind: 'bad-output', message: 'Model response was not parseable JSON.' });
}

export type AiRunArgs<T> = {
  db: Db;
  workflow: string;
  /** Which model class this work deserves. Taxonomy coding must never buy premium tokens. */
  task?: TaskClass;
  promptSlug: string;
  /** The static instruction template (versioned). Filled evidence goes in `prompt`. */
  template: string;
  schemaVersion: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  images?: AiImage[];
  input: Record<string, unknown>;
  skillVersionId?: number | null;
  ruleVersionIds?: number[];
  scoreVersionId?: number | null;
  parentRunId?: number | null;
  temperature?: number;
  maxOutputTokens?: number;
  thinkingBudget?: number;
  confidence?: (data: T) => string | null;
  /** Shared across a batch so one job cannot exceed its ceiling call by call. */
  budget?: BudgetGuard;
  /** Pins this call to one provider/model (benchmarks, escalation). No fallback. */
  pin?: Candidate;
  /** Raw per-attempt reporting for benchmarks. Never used to store chain-of-thought. */
  capture?: (attempt: { text: string; provider: string; model: string; latencyMs: number; usage: ProviderResult['usage']; estimatedCost: number; isRepair: boolean }) => void;
};

export type AiRunResult<T> = { data: T; runId: number; model: string; provider: string; costUsd: number; retries: number };

const STRUCTURED_TASKS: TaskClass[] = ['coding', 'gatekeeper'];

/** Pause between retries of the same model. Tests set it to 0. */
const retryBackoffMs = () => {
  const raw = Number(process.env.AI_RETRY_BACKOFF_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 1500;
};

async function callProvider(candidate: Candidate, task: TaskClass, req: Parameters<Generator>[0]): Promise<ProviderResult> {
  return STRUCTURED_TASKS.includes(task) ? candidate.provider.generateStructured(req, candidate.model) : candidate.provider.generateAnalysis(req, candidate.model);
}

/**
 * The only way BBO BRAIN calls a model. Every call — success or failure — lands
 * in ai_runs with provider, exact model, prompt/skill/rule/score versions,
 * tokens, estimated cost, retries and why it fell back. No chain-of-thought is
 * requested or stored.
 *
 * Failure handling follows the provider contract: a quota (429) or 5xx error is
 * retried once and then handed to the next candidate; a retired model (404) is
 * dropped immediately; an auth failure disables that provider for this call and
 * is reported as configuration, not weather; invalid JSON gets exactly one
 * repair attempt before escalating to the next candidate.
 */
export async function runAi<T>(args: AiRunArgs<T>): Promise<AiRunResult<T>> {
  const { db } = args;
  const task = args.task ?? 'analysis';
  const promptVersionId = registerPrompt(db, args.promptSlug, args.template, args.schemaVersion);
  const started = Date.now();
  const guard = args.budget ?? new BudgetGuard(db);
  const perRunEstimate = averageRunCost(db, args.workflow);

  let retries = 0;
  let fallbackReason: string | null = null;
  const attempted: string[] = [];

  const record = (
    status: 'ok' | 'error',
    output: unknown,
    error: string | null,
    confidence: string | null,
    result: ProviderResult | null
  ): number => {
    const runId = run(
      db,
      `INSERT INTO ai_runs (workflow, task_class, status, provider, model, prompt_version_id, skill_version_id, score_version_id, input_json,
         output_json, confidence, error, latency_ms, usage_json, parent_run_id, input_tokens, output_tokens, estimated_cost_usd, retry_count, fallback_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args.workflow,
      task,
      status,
      result?.providerName ?? null,
      result?.modelName ?? null,
      promptVersionId,
      args.skillVersionId ?? null,
      args.scoreVersionId ?? null,
      json(args.input),
      output === null ? null : json(output),
      confidence,
      error,
      Date.now() - started,
      result?.usage ? json(result.usage) : null,
      args.parentRunId ?? null,
      result?.usage.inputTokens ?? null,
      result?.usage.outputTokens ?? null,
      result?.estimatedCost ?? 0,
      retries,
      fallbackReason
    ).lastId;
    for (const versionId of new Set(args.ruleVersionIds ?? [])) {
      run(db, 'INSERT INTO ai_run_rules (ai_run_id, rule_version_id) VALUES (?, ?) ON CONFLICT DO NOTHING', runId, versionId);
    }
    return runId;
  };

  const baseRequest = {
    system: args.system,
    prompt: args.prompt,
    images: args.images,
    temperature: args.temperature,
    maxOutputTokens: args.maxOutputTokens,
    thinkingBudget: args.thinkingBudget,
  };

  // The injected generator (tests, offline) stands in for the whole registry.
  if (override) {
    try {
      guard.check(perRunEstimate);
      const first = await override(baseRequest);
      const asResult: ProviderResult = {
        text: first.text,
        providerName: (first.provider as ProviderResult['providerName']) ?? 'gemini',
        modelName: first.model,
        usage: { inputTokens: first.usage?.promptTokens, outputTokens: first.usage?.outputTokens, totalTokens: first.usage?.totalTokens },
        estimatedCost: 0,
        latencyMs: Date.now() - started,
      };
      let parsed = safeParse(args.schema, first.text);
      if (!parsed.success) {
        retries++;
        const repaired = await override(repairRequest(args, first.text, parsed.error));
        parsed = safeParse(args.schema, repaired.text);
      }
      if (!parsed.success) throw new AiError({ kind: 'bad-output', message: `Model output failed validation: ${parsed.error}` });
      const runId = record('ok', parsed.data, null, args.confidence ? args.confidence(parsed.data) : null, asResult);
      return { data: parsed.data, runId, model: asResult.modelName, provider: asResult.providerName, costUsd: 0, retries };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record('error', null, message.slice(0, 1000), null, null);
      throw err instanceof AiError || err instanceof BudgetPausedError ? err : new AiError({ kind: 'transient', message });
    }
  }

  const candidates = args.pin ? [args.pin] : candidatesFor(task);
  if (!candidates.length) {
    const message = 'No AI provider is configured (set GEMINI_API_KEY, OPENROUTER_API_KEY or NVIDIA_API_KEY).';
    record('error', null, message, null, null);
    throw new AiError({ kind: 'not-configured', message });
  }

  const deadProviders = new Set<string>();
  let lastError: AiError | null = null;

  for (const candidate of candidates) {
    if (deadProviders.has(candidate.provider.providerName)) continue;
    attempted.push(`${candidate.provider.providerName}:${candidate.model}`);
    if (attempted.length > 1) fallbackReason = lastError?.message.slice(0, 300) ?? 'previous candidate unavailable';

    try {
      guard.check(perRunEstimate);
    } catch (err) {
      if (err instanceof BudgetPausedError) {
        record('error', null, err.message, null, null);
        throw err;
      }
      throw err;
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await callProvider(candidate, task, baseRequest);
        args.capture?.({ text: result.text, provider: result.providerName, model: result.modelName, latencyMs: result.latencyMs, usage: result.usage, estimatedCost: result.estimatedCost, isRepair: false });
        let parsed = safeParse(args.schema, result.text);
        if (!parsed.success) {
          // Exactly one repair attempt, then this candidate has had its chance.
          retries++;
          const repaired = await callProvider(candidate, task, repairRequest(args, result.text, parsed.error));
          args.capture?.({ text: repaired.text, provider: repaired.providerName, model: repaired.modelName, latencyMs: repaired.latencyMs, usage: repaired.usage, estimatedCost: repaired.estimatedCost, isRepair: true });
          parsed = safeParse(args.schema, repaired.text);
          if (parsed.success) {
            guard.record(result.estimatedCost + repaired.estimatedCost);
            const merged: ProviderResult = {
              ...repaired,
              estimatedCost: result.estimatedCost + repaired.estimatedCost,
              usage: {
                inputTokens: (result.usage.inputTokens ?? 0) + (repaired.usage.inputTokens ?? 0),
                outputTokens: (result.usage.outputTokens ?? 0) + (repaired.usage.outputTokens ?? 0),
                totalTokens: (result.usage.totalTokens ?? 0) + (repaired.usage.totalTokens ?? 0),
              },
            };
            const runId = record('ok', parsed.data, null, args.confidence ? args.confidence(parsed.data) : null, merged);
            return { data: parsed.data, runId, model: merged.modelName, provider: merged.providerName, costUsd: merged.estimatedCost, retries };
          }
          guard.record(result.estimatedCost + repaired.estimatedCost);
          lastError = new AiError({ kind: 'bad-output', model: candidate.model, message: `${candidate.provider.providerName} ${candidate.model} output failed validation: ${parsed.error}` });
          break; // schema failure survived a repair → escalate to the next candidate
        }
        guard.record(result.estimatedCost);
        const runId = record('ok', parsed.data, null, args.confidence ? args.confidence(parsed.data) : null, result);
        return { data: parsed.data, runId, model: result.modelName, provider: result.providerName, costUsd: result.estimatedCost, retries };
      } catch (err) {
        if (err instanceof BudgetPausedError) {
          record('error', null, err.message, null, null);
          throw err;
        }
        const failure = err instanceof AiError ? err : new AiError({ kind: 'transient', model: candidate.model, message: err instanceof Error ? err.message : String(err) });
        lastError = failure;
        if (failure.kind === 'hard') {
          // 401/403 and other hard refusals are configuration, not weather.
          deadProviders.add(candidate.provider.providerName);
          break;
        }
        if (failure.kind === 'model-unavailable') break; // retired model: drop it, do not retry
        if (failure.kind === 'transient' && attempt < 2) {
          retries++;
          await new Promise((r) => setTimeout(r, retryBackoffMs()));
          continue;
        }
        break;
      }
    }
  }

  const message = lastError?.message ?? 'Every configured AI provider failed.';
  record('error', null, `${message} (tried ${attempted.join(', ')})`.slice(0, 1000), null, null);
  throw lastError ?? new AiError({ kind: 'transient', message });
}

function repairRequest<T>(args: AiRunArgs<T>, previous: string, problems: string) {
  return {
    system: args.system,
    prompt: [
      'Your previous response did not match the required JSON shape.',
      `Problems: ${problems}`,
      'Previous response:',
      previous.slice(0, 12_000),
      'Return the corrected JSON only. Keep the real content; fix structure, missing fields and types.',
    ].join('\n\n'),
    temperature: 0.1,
    maxOutputTokens: args.maxOutputTokens,
    thinkingBudget: 0,
  };
}

function safeParse<T>(schema: z.ZodType<T>, text: string): { success: true; data: T } | { success: false; error: string } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch {
    return { success: false, error: 'not JSON' };
  }
  const result = schema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    error: result.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
      .join('; '),
  };
}

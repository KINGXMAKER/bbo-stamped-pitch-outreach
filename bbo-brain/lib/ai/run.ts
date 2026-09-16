import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { get, json, run, type Db } from '@/lib/db/client';
import { brainConfig } from '@/lib/config';
import { AiError, geminiGenerator, type AiImage, type Generator } from './gemini';

let override: Generator | null = null;

/** Tests and offline runs inject a generator; production uses Gemini from env. */
export function setGenerator(generator: Generator | null): void {
  override = generator;
}

export function aiConfigured(): boolean {
  return Boolean(override) || Boolean(brainConfig().geminiApiKey);
}

export function currentGenerator(): Generator {
  if (override) return override;
  const cfg = brainConfig();
  if (!cfg.geminiApiKey) {
    throw new AiError({ kind: 'not-configured', message: 'GEMINI_API_KEY is not set, so AI workflows are unavailable.' });
  }
  return geminiGenerator({ apiKey: cfg.geminiApiKey, models: cfg.geminiModels });
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
};

export type AiRunResult<T> = { data: T; runId: number; model: string };

/**
 * The only way BBO BRAIN calls a model. Every call — success or failure —
 * lands in ai_runs with model, prompt version, skill version, rule versions,
 * score version, inputs and the validated structured output. No chain-of-thought
 * is requested or stored.
 */
export async function runAi<T>(args: AiRunArgs<T>): Promise<AiRunResult<T>> {
  const { db } = args;
  const promptVersionId = registerPrompt(db, args.promptSlug, args.template, args.schemaVersion);
  const started = Date.now();
  const generate = currentGenerator();
  let model: string | null = null;
  let provider: string | null = null;
  let usage: unknown = null;

  const record = (status: 'ok' | 'error', output: unknown, error: string | null, confidence: string | null): number => {
    const runId = run(
      db,
      `INSERT INTO ai_runs (workflow, status, provider, model, prompt_version_id, skill_version_id, score_version_id, input_json,
         output_json, confidence, error, latency_ms, usage_json, parent_run_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args.workflow,
      status,
      provider,
      model,
      promptVersionId,
      args.skillVersionId ?? null,
      args.scoreVersionId ?? null,
      json(args.input),
      output === null ? null : json(output),
      confidence,
      error,
      Date.now() - started,
      usage === null ? null : json(usage),
      args.parentRunId ?? null
    ).lastId;
    for (const versionId of new Set(args.ruleVersionIds ?? [])) {
      run(db, 'INSERT INTO ai_run_rules (ai_run_id, rule_version_id) VALUES (?, ?) ON CONFLICT DO NOTHING', runId, versionId);
    }
    return runId;
  };

  try {
    const first = await generate({
      system: args.system,
      prompt: args.prompt,
      images: args.images,
      temperature: args.temperature,
      maxOutputTokens: args.maxOutputTokens,
      thinkingBudget: args.thinkingBudget,
    });
    model = first.model;
    provider = first.provider;
    usage = first.usage ?? null;

    let parsed = safeParse(args.schema, first.text);
    if (!parsed.success) {
      const repaired = await generate({
        system: args.system,
        prompt: [
          'Your previous response did not match the required JSON shape.',
          `Problems: ${parsed.error}`,
          'Previous response:',
          first.text.slice(0, 12_000),
          'Return the corrected JSON only. Keep the real content; fix structure, missing fields and types.',
        ].join('\n\n'),
        temperature: 0.1,
        maxOutputTokens: args.maxOutputTokens,
        thinkingBudget: 0,
      });
      model = repaired.model;
      parsed = safeParse(args.schema, repaired.text);
    }
    if (!parsed.success) {
      throw new AiError({ kind: 'bad-output', model: model ?? undefined, message: `Model output failed validation: ${parsed.error}` });
    }
    const runId = record('ok', parsed.data, null, args.confidence ? args.confidence(parsed.data) : null);
    return { data: parsed.data, runId, model: model ?? 'unknown' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record('error', null, message.slice(0, 1000), null);
    throw err instanceof AiError ? err : new AiError({ kind: 'transient', message });
  }
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

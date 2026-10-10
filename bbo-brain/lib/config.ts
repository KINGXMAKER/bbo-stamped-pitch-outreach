import os from 'node:os';
import path from 'node:path';

const env = (key: string) => process.env[key]?.trim() || undefined;

function num(key: string, fallback: number): number {
  const raw = Number(env(key));
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const raw = env(key)?.toLowerCase();
  return raw === undefined ? fallback : raw === 'true' || raw === '1' || raw === 'yes';
}

function list(key: string, fallback: string[]): string[] {
  const raw = env(key);
  if (!raw) return fallback;
  return raw.split(',').map((v) => v.trim()).filter(Boolean);
}

function int(key: string, fallback: number): number {
  const raw = Number(env(key));
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/**
 * Server-side configuration. Secrets come only from the environment (repo-root
 * .env, then bbo-brain/.env.local). The defaults below are non-secret account
 * identifiers and local tool paths, overridable per machine.
 */
export function brainConfig() {
  // gemini-2.0-flash was retired by Google (HTTP 404 on this key, verified
  // 2026-09-16) — a dead model at the end of the chain hides the real failure.
  const fallbacks = (env('GEMINI_MODEL_FALLBACKS') ?? 'gemini-2.5-flash-lite,gemini-flash-latest')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const primary = env('GEMINI_MODEL_PRIMARY') ?? env('GEMINI_MODEL') ?? 'gemini-2.5-flash';
  return {
    composioApiKey: env('COMPOSIO_API_KEY'),
    composioConnectedAccountId: env('COMPOSIO_INSTAGRAM_CONNECTED_ACCOUNT_ID') ?? 'ca_xH0r_E3tatzk',
    igUserId: env('INSTAGRAM_IG_USER_ID') ?? '26850983357863398',
    geminiApiKey: env('GEMINI_API_KEY') ?? env('GOOGLE_GENERATIVE_AI_API_KEY'),
    geminiModels: [primary, ...fallbacks.filter((m) => m !== primary)],
    whisperCli: env('WHISPER_CLI') ?? '/opt/homebrew/bin/whisper-cli',
    whisperModel: env('WHISPER_MODEL') ?? path.join(os.homedir(), '.agents/tools/whisper-models/ggml-base.en.bin'),
    mediaDir: env('BRAIN_MEDIA_DIR') ?? path.join(process.cwd(), 'data', 'media'),
    accessPassword: env('BRAIN_ACCESS_PASSWORD'),

    // Throughput. Measured on this machine (Apple M1, 8 cores, 8 GB): media
    // download + ffprobe + frames + whisper base.en ≈ 2.5s per post at
    // concurrency 1. RAM is the binding constraint (whisper ≈ 1 GB per
    // process alongside the dev server), so concurrency defaults stay low.
    mediaDailyLimit: int('MEDIA_ANALYSIS_DAILY_LIMIT', 150),
    mediaConcurrency: int('MEDIA_ANALYSIS_CONCURRENCY', 2),
    whisperThreads: int('WHISPER_THREADS', 4),
    aiDailyLimit: int('AI_ANALYSIS_DAILY_LIMIT', 150),
    aiConcurrency: int('AI_ANALYSIS_CONCURRENCY', 2),
    // Total posts to hold structured coding for. Coding stops here until the
    // corpus has been inspected and this is deliberately raised.
    codingCorpusLimit: int('AI_CODING_CORPUS_LIMIT', 150),
    // Fields the coding model has not been validated on. Its values are kept in
    // ai_runs for audit but never written as attributes, so weaker evidence
    // (heuristics, audits) is not overruled by a known-bad classifier.
    // franchise: Qwen3-VL-32B agreed 11–17% with the reference (2026-09-16).
    untrustedCodingFields: list('AI_CODING_UNTRUSTED_FIELDS', ['franchise']),

    // Content-bucket classifier and its rollout gate (scored against human labels only).
    bucketProvider: env('AI_BUCKET_PROVIDER') ?? env('AI_CODING_PROVIDER') ?? 'openrouter',
    bucketModel: env('AI_BUCKET_MODEL') ?? env('AI_CODING_MODEL') ?? 'qwen/qwen3-vl-32b-instruct',
    bucketGateMinLabels: int('BUCKET_GATE_MIN_LABELS', 30),
    bucketGateMinAccuracy: num('BUCKET_GATE_MIN_ACCURACY', 0.85),
    bucketGateMinCoreRecall: num('BUCKET_GATE_MIN_CORE_RECALL', 0.9),

    // Providers. Keys decide what exists; the per-task settings decide what is
    // preferred. A task never silently upgrades to a pricier model: fallback
    // order is explicit and every hop is recorded on the run.
    openRouterApiKey: env('OPENROUTER_API_KEY'),
    nvidiaApiKey: env('NVIDIA_API_KEY'),
    openRouterModels: list('OPENROUTER_MODELS', ['qwen/qwen3-235b-a22b-2507']),
    // Per task class, because the cheap classifier and the escalation model are
    // deliberately different models. Each falls back to OPENROUTER_MODELS.
    openRouterTaskModels: {
      coding: list('OPENROUTER_CODING_MODELS', []),
      analysis: list('OPENROUTER_ANALYSIS_MODELS', []),
      gatekeeper: list('OPENROUTER_GATEKEEPER_MODELS', []),
      synthesis: list('OPENROUTER_SYNTHESIS_MODELS', []),
    },
    nvidiaModels: list('NVIDIA_MODELS', ['nvidia/nemotron-3.5-lightning-30b-a3b', 'mistralai/mistral-nemotron']),
    allowFallback: bool('AI_ALLOW_FALLBACK', true),
    tasks: {
      coding: { provider: env('AI_CODING_PROVIDER'), model: env('AI_CODING_MODEL') },
      analysis: { provider: env('AI_ANALYSIS_PROVIDER'), model: env('AI_ANALYSIS_MODEL') },
      gatekeeper: { provider: env('AI_GATEKEEPER_PROVIDER'), model: env('AI_GATEKEEPER_MODEL') },
      synthesis: { provider: env('AI_SYNTHESIS_PROVIDER'), model: env('AI_SYNTHESIS_MODEL') },
    },

    // Budget. 0 means "no ceiling configured"; anything above it pauses AI work
    // (never metric ingestion) rather than failing the job.
    dailyBudgetUsd: num('AI_DAILY_BUDGET_USD', 1),
    monthlyBudgetUsd: num('AI_MONTHLY_BUDGET_USD', 15),
    maxCostPerJobUsd: num('AI_MAX_COST_PER_JOB_USD', 0.75),

    // Escalation: a cheap model's low-confidence or invalid answer is re-asked
    // of the analysis-class model instead of being trusted.
    escalateBelowConfidence: num('AI_ESCALATE_BELOW_CONFIDENCE', 0.45),
    escalateLabels: list('AI_ESCALATE_LABELS', ['BREAKOUT', 'WINNER', 'LOSER']),
  };
}

export type BrainConfig = ReturnType<typeof brainConfig>;

import os from 'node:os';
import path from 'node:path';

const env = (key: string) => process.env[key]?.trim() || undefined;

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
  };
}

export type BrainConfig = ReturnType<typeof brainConfig>;

import os from 'node:os';
import path from 'node:path';

const env = (key: string) => process.env[key]?.trim() || undefined;

/**
 * Server-side configuration. Secrets come only from the environment (repo-root
 * .env, then bbo-brain/.env.local). The defaults below are non-secret account
 * identifiers and local tool paths, overridable per machine.
 */
export function brainConfig() {
  const fallbacks = (env('GEMINI_MODEL_FALLBACKS') ?? 'gemini-2.5-flash-lite,gemini-2.0-flash')
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
  };
}

export type BrainConfig = ReturnType<typeof brainConfig>;

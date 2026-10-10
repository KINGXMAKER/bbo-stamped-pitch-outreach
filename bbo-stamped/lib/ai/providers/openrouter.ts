import { createOpenAiCompatibleProvider } from './openai-compatible';

/** Model ids and the API key live in lib/ai/models.ts, never here. */
export const openrouterProvider = createOpenAiCompatibleProvider({
  name: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  extraHeaders: {
    'HTTP-Referer': 'https://bbostamped.local',
    'X-Title': 'BBO Stamped',
  },
});

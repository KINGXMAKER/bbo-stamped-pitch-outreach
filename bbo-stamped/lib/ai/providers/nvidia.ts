import { createOpenAiCompatibleProvider } from './openai-compatible';

/** Model ids and the API key live in lib/ai/models.ts, never here. */
export const nvidiaProvider = createOpenAiCompatibleProvider({
  name: 'nvidia',
  baseUrl: 'https://integrate.api.nvidia.com/v1',
});

import { NextResponse } from 'next/server';
import { AiProviderError } from './types';

/**
 * Provider text never reaches the browser. Each failure class becomes a plain
 * sentence the operator can act on, while the detail stays in the server log.
 */
export function aiErrorResponse(error: unknown): NextResponse {
  if (error instanceof AiProviderError) {
    console.error(
      `[bbo-ai] ${error.provider} ${error.kind}${error.status ? ` ${error.status}` : ''}: ${error.message}`,
      error.detail ?? ''
    );

    const body = { error: messageFor(error), kind: error.kind };
    const status =
      error.kind === 'not-configured' ? 503 : error.kind === 'hard' ? 502 : error.kind === 'bad-output' ? 502 : 504;
    return NextResponse.json(body, { status });
  }

  console.error('[bbo-ai] unexpected failure', error);
  return NextResponse.json(
    { error: 'Something went wrong on the server. Nothing was lost — try again.', kind: 'unknown' },
    { status: 500 }
  );
}

function messageFor(error: AiProviderError): string {
  switch (error.kind) {
    case 'not-configured':
      return 'No AI provider is set up on the server yet. Add an API key for Google, OpenRouter or NVIDIA and restart.';
    case 'hard':
      return 'Every AI provider rejected the request — usually a bad or expired API key. Check the server keys.';
    case 'model-unavailable':
      return 'The configured models are unavailable. Check the model ids in your environment.';
    case 'bad-output':
      return 'The AI answered but could not produce a usable plan. Try again — nothing else was lost.';
    case 'transient':
    default:
      return 'Every AI provider is busy or timed out right now. Try again in a moment — nothing else was lost.';
  }
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message, kind: 'bad-request' }, { status: 400 });
}

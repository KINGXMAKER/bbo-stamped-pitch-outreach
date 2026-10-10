import { z } from 'zod';
import { NextResponse } from 'next/server';
import { runStage } from '@/lib/ai/router';
import { PitchIntelSchema } from '@/lib/ai/schemas';
import { aiErrorResponse, badRequest } from '@/lib/ai/respond';
import { PITCH_SYSTEM, buildPitchPrompt } from '@/lib/ai/prompts/pitch-intel';

export const runtime = 'nodejs';
export const maxDuration = 300;

const BodySchema = z.object({
  name: z.string().trim().max(200).default(''),
  instagram: z.string().trim().max(120).optional(),
  website: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(4000).optional(),
  ask: z.string().trim().min(1).max(200),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Request body was not valid JSON.');
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return badRequest('Add a business name or handle first.');
  if (!parsed.data.name && !parsed.data.instagram) {
    return badRequest('Add a business name or an Instagram handle first.');
  }

  try {
    const result = await runStage({
      stage: 'pitch-intel',
      capability: 'creative',
      system: PITCH_SYSTEM,
      prompt: buildPitchPrompt(parsed.data),
      schema: PitchIntelSchema,
      temperature: 0.7,
      maxTokens: 6000,
      budgetMs: 150_000,
      attemptTimeoutMs: 75_000,
      signal: request.signal,
    });
    return NextResponse.json(result);
  } catch (error) {
    return aiErrorResponse(error);
  }
}

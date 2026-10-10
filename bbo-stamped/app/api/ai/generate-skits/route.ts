import { z } from 'zod';
import { NextResponse } from 'next/server';
import { runStage } from '@/lib/ai/router';
import { SkitSetSchema, VenueAnalysisSchema } from '@/lib/ai/schemas';
import { ActivationContextSchema } from '@/lib/ai/requests';
import { aiErrorResponse, badRequest } from '@/lib/ai/respond';
import { SKIT_SYSTEM, buildSkitPrompt } from '@/lib/ai/prompts/skit-generator';

export const runtime = 'nodejs';
export const maxDuration = 300;

const BodySchema = z.object({
  activation: ActivationContextSchema,
  venueAnalysis: VenueAnalysisSchema,
  count: z.number().int().min(1).max(10).default(7),
  steer: z.string().trim().max(400).optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Request body was not valid JSON.');
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return badRequest('Run the location scout before generating skits.');

  const { activation, venueAnalysis, count, steer } = parsed.data;

  try {
    const result = await runStage({
      stage: 'skits',
      capability: 'creative',
      system: SKIT_SYSTEM,
      prompt: buildSkitPrompt(activation, venueAnalysis, count, steer),
      schema: SkitSetSchema,
      temperature: 1,
      maxTokens: 10_000,
      budgetMs: 210_000,
      attemptTimeoutMs: 105_000,
      signal: request.signal,
    });
    return NextResponse.json(result);
  } catch (error) {
    return aiErrorResponse(error);
  }
}

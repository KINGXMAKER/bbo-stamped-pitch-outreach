import { z } from 'zod';
import { NextResponse } from 'next/server';
import { runStage } from '@/lib/ai/router';
import { ReelSetSchema, VenueAnalysisSchema } from '@/lib/ai/schemas';
import { ActivationContextSchema } from '@/lib/ai/requests';
import { aiErrorResponse, badRequest } from '@/lib/ai/respond';
import { REEL_SYSTEM, buildReelPrompt } from '@/lib/ai/prompts/reel-generator';

export const runtime = 'nodejs';
export const maxDuration = 300;

const BodySchema = z.object({
  activation: ActivationContextSchema,
  venueAnalysis: VenueAnalysisSchema,
  count: z.number().int().min(1).max(6).default(4),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Request body was not valid JSON.');
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return badRequest('Run the location scout before generating Reels.');

  const { activation, venueAnalysis, count } = parsed.data;

  try {
    const result = await runStage({
      stage: 'reels',
      capability: 'creative',
      system: REEL_SYSTEM,
      prompt: buildReelPrompt(activation, venueAnalysis, count),
      schema: ReelSetSchema,
      temperature: 0.9,
      maxTokens: 10_000,
      budgetMs: 260_000,
      attemptTimeoutMs: 130_000,
      signal: request.signal,
    });
    return NextResponse.json(result);
  } catch (error) {
    return aiErrorResponse(error);
  }
}

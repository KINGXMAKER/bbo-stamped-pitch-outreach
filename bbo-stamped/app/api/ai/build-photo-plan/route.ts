import { z } from 'zod';
import { NextResponse } from 'next/server';
import { runStage } from '@/lib/ai/router';
import { PhotoPlanSchema, ReelConceptSchema, VenueAnalysisSchema } from '@/lib/ai/schemas';
import { ActivationContextSchema } from '@/lib/ai/requests';
import { aiErrorResponse, badRequest } from '@/lib/ai/respond';
import { PHOTO_SYSTEM, buildPhotoPlanPrompt } from '@/lib/ai/prompts/photo-plan';

export const runtime = 'nodejs';
export const maxDuration = 300;

const BodySchema = z.object({
  activation: ActivationContextSchema,
  venueAnalysis: VenueAnalysisSchema,
  reels: z.array(ReelConceptSchema).max(6).default([]),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Request body was not valid JSON.');
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return badRequest('Run the location scout before building the photo plan.');

  const { activation, venueAnalysis, reels } = parsed.data;

  try {
    const result = await runStage({
      stage: 'photo-plan',
      capability: 'creative',
      system: PHOTO_SYSTEM,
      prompt: buildPhotoPlanPrompt(activation, venueAnalysis, reels),
      schema: PhotoPlanSchema,
      temperature: 0.7,
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

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { runStage } from '@/lib/ai/router';
import { RecoverableVenueAnalysisSchema } from '@/lib/ai/schemas';
import { ActivationContextSchema } from '@/lib/ai/requests';
import { aiErrorResponse, badRequest } from '@/lib/ai/respond';
import { LOCATION_SCOUT_SYSTEM, buildLocationScoutPrompt } from '@/lib/ai/prompts/location-scout';

export const runtime = 'nodejs';
export const maxDuration = 300;

const BodySchema = z.object({ activation: ActivationContextSchema });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Request body was not valid JSON.');
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return badRequest('The activation details were incomplete.');

  const { activation } = parsed.data;
  const usable = activation.photos.filter((photo) => Boolean(photo.base64));
  if (usable.length === 0) {
    return badRequest('Add at least one location photo before analysing.');
  }

  try {
    const result = await runStage({
      stage: 'location-scout',
      capability: 'vision',
      system: LOCATION_SCOUT_SYSTEM,
      prompt: buildLocationScoutPrompt(activation),
      schema: RecoverableVenueAnalysisSchema,
      images: usable.map((photo) => ({ base64: photo.base64!, mediaType: photo.mediaType })),
      temperature: 0.55,
      maxTokens: 8192,
      budgetMs: 110_000,
      attemptTimeoutMs: 50_000,
      signal: request.signal,
    });
    return NextResponse.json(result);
  } catch (error) {
    return aiErrorResponse(error);
  }
}

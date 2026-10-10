import { z } from 'zod';
import { NextResponse } from 'next/server';
import { buildShotList } from '@/lib/ai/shot-pipeline';
import { ReelConceptSchema, SkitConceptSchema, VenueAnalysisSchema } from '@/lib/ai/schemas';
import { ActivationContextSchema } from '@/lib/ai/requests';
import { aiErrorResponse, badRequest } from '@/lib/ai/respond';

export const runtime = 'nodejs';
export const maxDuration = 300;

const BodySchema = z.object({
  activation: ActivationContextSchema,
  venueAnalysis: VenueAnalysisSchema,
  reels: z.array(ReelConceptSchema).min(1).max(6),
  skits: z.array(SkitConceptSchema).max(6).default([]),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Request body was not valid JSON.');
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return badRequest('Select at least one Reel before building the shot list.');

  const { activation, venueAnalysis, reels, skits } = parsed.data;

  try {
    // Each Reel is planned in parallel, then the shared camera setups are
    // merged — see lib/ai/shot-pipeline.ts.
    const result = await buildShotList({
      activation,
      analysis: venueAnalysis,
      reels,
      skits,
      signal: request.signal,
    });
    return NextResponse.json({ data: { shots: result.shots }, generation: result.generation });
  } catch (error) {
    return aiErrorResponse(error);
  }
}

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { buildReelSet } from '@/lib/ai/reel-pipeline';
import { ReelSetSchema, VenueAnalysisSchema } from '@/lib/ai/schemas';
import { ActivationContextSchema } from '@/lib/ai/requests';
import { aiErrorResponse, badRequest } from '@/lib/ai/respond';


export const runtime = 'nodejs';
export const maxDuration = 300;

const BodySchema = z.object({
  activation: ActivationContextSchema,
  venueAnalysis: VenueAnalysisSchema,
  count: z.number().int().min(1).max(8).default(6),
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
    // Group and solo are generated in parallel — see lib/ai/reel-pipeline.ts.
    const result = await buildReelSet({
      activation,
      analysis: venueAnalysis,
      count,
      signal: request.signal,
    });
    return NextResponse.json({ data: { reels: result.reels }, generation: result.generation });
  } catch (error) {
    return aiErrorResponse(error);
  }
}

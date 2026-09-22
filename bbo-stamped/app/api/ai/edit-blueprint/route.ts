import { z } from 'zod';
import { NextResponse } from 'next/server';
import { runStage } from '@/lib/ai/router';
import { EditBlueprintSchema, ReelConceptSchema, ShotSchema } from '@/lib/ai/schemas';
import { aiErrorResponse, badRequest } from '@/lib/ai/respond';
import { BLUEPRINT_SYSTEM, buildBlueprintPrompt } from '@/lib/ai/prompts/edit-blueprint';

export const runtime = 'nodejs';
export const maxDuration = 300;

const BodySchema = z.object({
  businessName: z.string().trim().min(1).max(200),
  reel: ReelConceptSchema,
  shots: z.array(ShotSchema).max(120),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Request body was not valid JSON.');
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return badRequest('That Reel is missing the data needed for a blueprint.');

  const { businessName, reel, shots } = parsed.data;
  if (!shots.some((shot) => shot.completed)) {
    return badRequest('No footage has been ticked off yet, so there is nothing to assemble.');
  }

  try {
    const result = await runStage({
      stage: 'edit-blueprint',
      capability: 'creative',
      system: BLUEPRINT_SYSTEM,
      prompt: buildBlueprintPrompt(reel, shots, businessName),
      schema: EditBlueprintSchema,
      temperature: 0.5,
      maxTokens: 8192,
      budgetMs: 210_000,
      attemptTimeoutMs: 105_000,
      signal: request.signal,
    });
    return NextResponse.json(result);
  } catch (error) {
    return aiErrorResponse(error);
  }
}

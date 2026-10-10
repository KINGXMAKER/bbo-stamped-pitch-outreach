import { runStage } from './router';
import { ReelSetSchema } from './schemas';
import { REEL_SYSTEM, buildReelPrompt } from './prompts/reel-generator';
import type { PromptActivation } from './prompts/shared';
import type { GenerationAttempt, GenerationInfo, ReelConcept, VenueAnalysis } from '@/types';

/**
 * Group and solo concepts are generated in two parallel passes rather than one
 * call asked for a balanced set.
 *
 * Asking a single call for six Reels produced one invented `format` value that
 * failed the whole batch, and the repair pass then returned two Reels where six
 * were wanted — four good concepts lost to one bad word. Splitting the work
 * halves each request, makes the balance structural instead of an instruction
 * the model may ignore, and means one side failing cannot take the other with it.
 */
/**
 * Group content is the half a solo creator cannot film, so it never rounds down
 * to nothing — both sides always get at least one, and at four or more both get
 * at least two.
 */
export function splitCount(count: number): { groupCount: number; soloCount: number } {
  const total = Math.max(2, Math.floor(count));
  const groupCount = Math.max(1, Math.round(total / 2));
  return { groupCount, soloCount: Math.max(1, total - groupCount) };
}

export async function buildReelSet(args: {
  activation: PromptActivation;
  analysis: VenueAnalysis;
  count: number;
  signal?: AbortSignal;
}): Promise<{ reels: ReelConcept[]; generation: GenerationInfo }> {
  const startedAt = Date.now();

  const { groupCount, soloCount } = splitCount(args.count);

  const pass = (voice: 'GROUP' | 'SOLO', count: number) =>
    runStage({
      stage: `reels:${voice.toLowerCase()}`,
      capability: 'creative',
      system: REEL_SYSTEM,
      prompt: buildReelPrompt(args.activation, args.analysis, count, voice),
      schema: ReelSetSchema,
      temperature: 0.9,
      maxTokens: 10_000,
      budgetMs: 200_000,
      attemptTimeoutMs: 110_000,
      signal: args.signal,
    });

  const [group, solo] = await Promise.allSettled([
    pass('GROUP', groupCount),
    pass('SOLO', soloCount),
  ]);

  // A half-set beats nothing: if one voice fails the operator still gets the
  // other, and the error is only raised when both came back empty.
  if (group.status === 'rejected' && solo.status === 'rejected') throw group.reason;

  const reels: ReelConcept[] = [];
  const attempts: GenerationAttempt[] = [];
  let usage: GenerationInfo['usage'];
  let primary: GenerationInfo | undefined;
  let validatedFirstTry = true;

  for (const [voice, result] of [
    ['BBO', group],
    ['CREATOR', solo],
  ] as const) {
    if (result.status !== 'fulfilled') continue;
    const { data, generation } = result.value;

    // Each pass numbers its concepts from "reel-1", so ids collide across the
    // two. Namespacing keeps every downstream Map keyed by a real concept.
    reels.push(
      ...data.reels.map((reel) => ({
        ...reel,
        id: `${voice === 'BBO' ? 'g' : 's'}-${reel.id}`,
        // The pass decides the owner. A model that mislabels its own voice
        // cannot put a solo concept into the group column.
        contentOwner: voice,
        sequence: reel.sequence.map((beat) => ({
          ...beat,
          id: `${voice === 'BBO' ? 'g' : 's'}-${beat.id}`,
        })),
      }))
    );

    attempts.push(...generation.attempts);
    usage = mergeUsage([usage, generation.usage]);
    primary = primary ?? generation;
    validatedFirstTry = validatedFirstTry && generation.validatedFirstTry;
  }

  const base = primary!;
  return {
    reels,
    generation: {
      ...base,
      stage: 'reels',
      latencyMs: Date.now() - startedAt,
      attemptCount: attempts.length,
      attempts,
      usage,
      fallbackOccurred: attempts.some((attempt) => attempt.status === 'error'),
      validatedFirstTry,
    },
  };
}

function mergeUsage(
  parts: Array<GenerationInfo['usage']>
): GenerationInfo['usage'] {
  const present = parts.filter(Boolean) as NonNullable<GenerationInfo['usage']>[];
  if (present.length === 0) return undefined;
  const sum = (pick: (u: NonNullable<GenerationInfo['usage']>) => number | undefined) => {
    const values = present.map(pick).filter((v): v is number => typeof v === 'number');
    return values.length ? values.reduce((a, b) => a + b, 0) : undefined;
  };
  return {
    promptTokens: sum((u) => u.promptTokens),
    completionTokens: sum((u) => u.completionTokens),
    totalTokens: sum((u) => u.totalTokens),
    reportedCostUsd: sum((u) => u.reportedCostUsd),
  };
}

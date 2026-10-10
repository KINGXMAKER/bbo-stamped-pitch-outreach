import { runStage } from './router';
import { ShotDedupeDecisionSchema, ShotListSchema } from './schemas';
import {
  DEDUPE_SYSTEM,
  SHOT_SYSTEM,
  buildDedupeAdjudicationPrompt,
  buildShotPromptForReel,
} from './prompts/shot-builder';
import { findCandidatePairs, pairsToGroups } from './dedupe-candidates';
import type { PromptActivation } from './prompts/shared';
import type { GenerationAttempt, GenerationInfo, ReelConcept, Shot, SkitConcept, VenueAnalysis } from '@/types';

/**
 * The shot list is the only stage whose size grows with the shoot. Planning
 * every Reel in one call took five minutes on a three-Reel activation, so each
 * Reel is planned in parallel and the shared camera setups are merged after.
 *
 * The merge itself is applied by this file, not by the model: the model only
 * proposes which ids are the same setup, and anything it names that does not
 * exist is ignored.
 */
export async function buildShotList(args: {
  activation: PromptActivation;
  analysis: VenueAnalysis;
  reels: ReelConcept[];
  skits: SkitConcept[];
  signal?: AbortSignal;
}): Promise<{ shots: Shot[]; generation: GenerationInfo }> {
  const startedAt = Date.now();

  const perReel = await Promise.all(
    args.reels.map((reel) =>
      runStage({
        stage: `shots:${reel.id}`,
        capability: 'creative',
        system: SHOT_SYSTEM,
        prompt: buildShotPromptForReel(args.activation, args.analysis, reel, args.skits),
        schema: ShotListSchema,
        temperature: 0.65,
        maxTokens: 10_000,
        budgetMs: 200_000,
        attemptTimeoutMs: 120_000,
        signal: args.signal,
      })
    )
  );

  // Each Reel is planned by its own call, and each call numbers its shots from
  // "shot-1". Left alone, three Reels all produce a "shot-1" — and every lookup
  // downstream is a Map keyed by id, which silently keeps only the last one.
  // Namespacing by Reel is what makes the ids mean one setup each.
  const shots: Shot[] = perReel.flatMap((result, index) => {
    const reelId = args.reels[index]?.id ?? `reel-${index + 1}`;
    return (result.data.shots as Shot[]).map((shot) => ({
      ...shot,
      id: `${reelId}--${shot.id}`,
    }));
  });
  const attempts: GenerationAttempt[] = perReel.flatMap((result) => result.generation.attempts);
  const usage = mergeUsage(perReel.map((result) => result.generation.usage));
  const primary = perReel[0].generation;

  // Nothing to merge across a single Reel — its own beats were already merged
  // inside that generation.
  if (args.reels.length < 2 || shots.length < 2) {
    return {
      shots,
      generation: {
        ...primary,
        stage: 'shots',
        latencyMs: Date.now() - startedAt,
        attemptCount: attempts.length,
        attempts,
        usage,
        fallbackOccurred: attempts.some((attempt) => attempt.status === 'error'),
        validatedFirstTry: perReel.every((result) => result.generation.validatedFirstTry),
      },
    };
  }

  let merged = shots;
  let dedupeAttempts: GenerationAttempt[] = [];
  let dedupeUsage = usage;

  // The search is deterministic; the model only judges the shortlist. Asking it
  // to find duplicates across the whole list made it answer "none" every time.
  const candidates = findCandidatePairs(shots);

  if (candidates.length === 0) {
    dedupeAttempts = [
      { provider: 'local', model: null, status: 'ok', latencyMs: 0, errorType: undefined },
    ];
  } else {
    try {
      const decision = await runStage({
        stage: 'shots:dedupe',
        capability: 'creative',
        system: DEDUPE_SYSTEM,
        prompt: buildDedupeAdjudicationPrompt(candidates),
        schema: ShotDedupeDecisionSchema,
        temperature: 0.1,
        maxTokens: 3_000,
        budgetMs: 70_000,
        attemptTimeoutMs: 45_000,
        signal: args.signal,
      });

      // Only pairs the model actually confirmed, and only ones it was offered —
      // a hallucinated id must never collapse two real setups.
      // Match regardless of the order the model echoed the pair back in.
      const key = (x: string, y: string) => [x, y].sort().join('|');
      const offered = new Set(candidates.map((pair) => key(pair.a.id, pair.b.id)));
      const confirmed = decision.data.decisions.filter(
        (item) => item.sameSetup && offered.has(key(item.aId, item.bId))
      );

      merged = applyDedupe(shots, pairsToGroups(confirmed));
      dedupeAttempts = decision.generation.attempts;
      dedupeUsage = mergeUsage([usage, decision.generation.usage]);
    } catch (error) {
      // A failed merge must never lose the plan. The crew gets every shot, with
      // some duplication, rather than nothing at all.
      console.warn('[bbo-ai] shots:dedupe failed — keeping every shot unmerged', error);
      dedupeAttempts = [
        { provider: 'router', model: null, status: 'error', latencyMs: 0, errorType: 'dedupe-skipped' },
      ];
    }
  }

  return {
    shots: merged,
    generation: {
      ...primary,
      stage: 'shots',
      latencyMs: Date.now() - startedAt,
      attemptCount: attempts.length + dedupeAttempts.length,
      attempts: [...attempts, ...dedupeAttempts],
      usage: dedupeUsage,
      fallbackOccurred: [...attempts, ...dedupeAttempts].some(
        (attempt) => attempt.status === 'error'
      ),
      validatedFirstTry: perReel.every((result) => result.generation.validatedFirstTry),
    },
  };
}

/**
 * Applies the model's merge proposal. One shot survives per group and inherits
 * every Reel usage the duplicates carried, so coverage still knows the setup
 * serves more than one Reel. Ids that do not exist are ignored.
 */
export function applyDedupe(
  shots: Shot[],
  groups: Array<{ keepId: string; duplicateIds: string[] }>
): Shot[] {
  const byId = new Map(shots.map((shot) => [shot.id, shot]));
  const removed = new Set<string>();

  for (const group of groups) {
    const keeper = byId.get(group.keepId);
    if (!keeper || removed.has(group.keepId)) continue;

    for (const duplicateId of group.duplicateIds) {
      if (duplicateId === group.keepId) continue;
      const duplicate = byId.get(duplicateId);
      if (!duplicate || removed.has(duplicateId)) continue;

      const usages = [...keeper.reelUsages, ...duplicate.reelUsages];
      const seen = new Set<string>();
      keeper.reelUsages = usages.filter((usage) => {
        const key = `${usage.reelId}:${usage.beatId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // The merged setup inherits the strictest requirements of its parts.
      keeper.priority = strictest(keeper.priority, duplicate.priority);
      keeper.clientRequired = keeper.clientRequired || duplicate.clientRequired;
      // The merged setup keeps whichever on-camera direction is more demanding
      // — "the group" outranks "creator", which outranks "hands only".
      keeper.onCamera = widerOnCamera(keeper.onCamera, duplicate.onCamera);
      keeper.timeSensitive = keeper.timeSensitive || duplicate.timeSensitive;
      keeper.sourcePhotoIds = [
        ...new Set([...keeper.sourcePhotoIds, ...duplicate.sourcePhotoIds]),
      ];
      keeper.recommendedTakeCount = Math.max(
        keeper.recommendedTakeCount,
        duplicate.recommendedTakeCount
      );
      keeper.minimumUsefulDuration = Math.max(
        keeper.minimumUsefulDuration,
        duplicate.minimumUsefulDuration
      );

      removed.add(duplicateId);
    }
  }

  return shots.filter((shot) => !removed.has(shot.id));
}

/** Ranked by how many people the setup needs standing in frame. */
const ON_CAMERA_RANK = ['hands only', 'creator', 'host', 'staff member', 'the group'];

function widerOnCamera(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  const rank = (value: string) =>
    ON_CAMERA_RANK.findIndex((entry) => value.toLowerCase().includes(entry));
  return rank(b) > rank(a) ? b : a;
}

const RANK: Record<Shot['priority'], number> = { must: 3, strong: 2, optional: 1 };

function strictest(a: Shot['priority'], b: Shot['priority']): Shot['priority'] {
  return RANK[a] >= RANK[b] ? a : b;
}

function mergeUsage(
  usages: Array<GenerationInfo['usage'] | undefined>
): GenerationInfo['usage'] | undefined {
  const present = usages.filter((usage): usage is NonNullable<typeof usage> => Boolean(usage));
  if (present.length === 0) return undefined;

  const sum = (pick: (usage: NonNullable<GenerationInfo['usage']>) => number | undefined) => {
    const values = present.map(pick).filter((value): value is number => value !== undefined);
    return values.length ? values.reduce((total, value) => total + value, 0) : undefined;
  };

  return {
    promptTokens: sum((usage) => usage.promptTokens),
    completionTokens: sum((usage) => usage.completionTokens),
    totalTokens: sum((usage) => usage.totalTokens),
    reportedCostUsd: sum((usage) => usage.reportedCostUsd),
  };
}

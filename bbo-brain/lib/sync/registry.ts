import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { all, type Db } from '@/lib/db/client';
import { brainConfig } from '@/lib/config';
import { aiConfigured } from '@/lib/ai/run';
import { WhisperCppAdapter } from '@/lib/adapters/whisper';
import { defaultArchivePaths, importArchiveFiles } from '@/lib/ingest/archive';
import { defaultLearningMemoryPath, importLearningMemory } from '@/lib/ingest/learning-memory';
import { computeAllScores } from '@/lib/scoring/engine';
import { analysisQueue, analyzeContent, enrichContent } from '@/lib/intel/analysis';
import { mineLessons } from '@/lib/intel/lessons';
import { benchmarkReport, benchmarkSample, runCodingBenchmark } from '@/lib/intel/benchmark';
import { buildIntelligenceReport, renderIntelligenceReport } from '@/lib/intel/report';
import { autoAssign, evaluateExperiment, suggestExperimentsFromLessons } from '@/lib/intel/experiments';
import { generateOpportunities } from '@/lib/intel/opportunities';
import { buildMonthlyReview, buildWeeklyReview } from '@/lib/intel/reviews';
import { rebuildGraph } from '@/lib/intel/graph';
import { rebuildSearchIndex } from '@/lib/intel/search';
import { detectRuleChallenges, generateRuleProposals } from '@/lib/rules/engine';
import { getSetting, seedReference } from '@/lib/seed';
import { AiError } from '@/lib/ai/gemini';
import { BudgetGuard, budgetStatus, isBudgetPaused, projectBatch } from '@/lib/ai/budget';
import { healthChecks } from '@/lib/ai/providers/registry';
import {
  checkInstagramConnection,
  syncInstagramAccount,
  syncInstagramContent,
  syncInstagramMetrics,
  syncMediaAndTranscripts,
} from './instagram';
import { markIntegration, runJob, type JobContext, type JobOutcome, type JobRecord } from './jobs';
import { buildQueue, corpusStatus, processedToday } from './media-queue';

export type JobDef = { label: string; description: string; phase: string; run: (ctx: JobContext) => Promise<JobOutcome> };

async function aiBatch(
  ctx: JobContext,
  ids: number[],
  fn: (id: number, budget: BudgetGuard) => Promise<{ status: string; reason?: string }>,
  concurrency = 1,
  workflow = 'enrichment'
): Promise<JobOutcome> {
  if (!aiConfigured()) {
    markIntegration(ctx.db, 'gemini', { status: 'not_connected', error: 'No AI provider key is set (GEMINI_API_KEY, OPENROUTER_API_KEY or NVIDIA_API_KEY).' });
    return { recordsSeen: ids.length, recordsWritten: 0, summary: 'AI not configured — skipped.' };
  }
  // Estimate before spending: a batch that cannot fit its ceiling is paused, not started.
  const projection = projectBatch(ctx.db, workflow, ids.length);
  if (!projection.fits) {
    ctx.log('budget paused', { estimatedUsd: Number(projection.totalUsd.toFixed(4)), reason: projection.reason });
    return { recordsSeen: ids.length, recordsWritten: 0, summary: `BUDGET PAUSED — ${projection.reason}` };
  }
  const budget = new BudgetGuard(ctx.db);
  let done = 0;
  let failed = 0;
  let stop = false;
  let paused: string | null = null;
  let lastError: string | null = null;
  let cursor = 0;
  const worker = async () => {
    while (cursor < ids.length && !stop) {
      const id = ids[cursor++];
      try {
        const r = await fn(id, budget);
        if (r.status === 'analysed' || r.status === 'enriched') done++;
        else ctx.log('skipped', { contentId: id, reason: r.reason });
      } catch (err) {
        if (isBudgetPaused(err)) {
          // Out of budget is a planned stop, not a failure: leave the rest queued.
          paused = err.message;
          stop = true;
          continue;
        }
        failed++;
        lastError = err instanceof Error ? err.message : String(err);
        ctx.log('ai call failed', { contentId: id, message: lastError });
        if (err instanceof AiError && (err.kind === 'hard' || err.kind === 'not-configured')) stop = true; // a bad key won't fix itself
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, ids.length)) }, worker));
  markIntegration(ctx.db, 'gemini', failed && !done ? { status: 'needs_attention', error: 'AI calls failed — see AI Agent Runs.' } : { status: 'connected', success: done > 0, records: done });
  const spent = `$${budget.spent.toFixed(4)}`;
  if (!paused && failed > 0 && done === 0) {
    // Every provider refused: say FAILED honestly. The posts keep coded_at unset,
    // so they are simply queued for the next run; the daily loop carries on.
    throw new Error(`All ${failed} AI calls failed — posts stay queued for the next run. Last error: ${(lastError ?? 'unknown').slice(0, 240)}`);
  }
  if (paused) {
    return { recordsSeen: ids.length, recordsWritten: done, partial: done > 0, summary: `BUDGET PAUSED after ${done} completed (${spent}) — ${paused}` };
  }
  return {
    recordsSeen: ids.length,
    recordsWritten: done,
    partial: failed > 0 && done > 0,
    summary: `${done} completed, ${failed} failed, ${ids.length - done - failed} skipped · ${spent}`,
  };
}

export const JOBS: Record<string, JobDef> = {
  'integration-check': {
    label: 'Check integrations',
    description: 'Live Instagram call via Composio, local tool availability, AI key presence.',
    phase: 'setup',
    run: async (ctx) => {
      const cfg = brainConfig();
      const whisper = new WhisperCppAdapter(cfg.whisperCli, cfg.whisperModel).isAvailable();
      markIntegration(ctx.db, 'whisper_local', whisper ? { status: 'connected', success: true } : { status: 'not_connected', error: `Not found: ${cfg.whisperCli}` });
      markIntegration(ctx.db, 'gemini', cfg.geminiApiKey ? { status: 'connected' } : { status: 'not_connected', error: 'GEMINI_API_KEY is not set.' });
      markIntegration(ctx.db, 'audit_archive', defaultArchivePaths().length ? { status: 'connected' } : { status: 'not_connected', error: 'No audit JSON files found.' });
      for (const id of ['tiktok', 'youtube', 'google_drive']) markIntegration(ctx.db, id, { status: 'not_connected', error: 'No connected account in Composio (verified 2026-09-15).' });
      const ig = await checkInstagramConnection(ctx);
      const keys = [cfg.geminiApiKey && 'gemini', cfg.openRouterApiKey && 'openrouter', cfg.nvidiaApiKey && 'nvidia'].filter(Boolean).join(', ') || 'none';
      return { recordsSeen: 1, recordsWritten: 0, summary: `instagram: ${ig.summary}; whisper: ${whisper ? 'available' : 'missing'}; AI provider keys: ${keys}` };
    },
  },
  'import-archive': {
    label: 'Import audit archive',
    description: 'Historical metric snapshots from the weekly audit runs (real past Instagram pulls).',
    phase: 'ingest',
    run: async (ctx) => {
      const files = defaultArchivePaths();
      const r = importArchiveFiles(ctx.db, files);
      markIntegration(ctx.db, 'audit_archive', { status: files.length ? 'connected' : 'not_connected', success: true, records: r.snapshots });
      return { recordsSeen: r.posts, recordsWritten: r.snapshots + r.newContent, summary: `${r.files} files · ${r.newContent} new content · ${r.snapshots} snapshots · ${r.comments} comments` };
    },
  },
  'import-learning-memory': {
    label: 'Import audit learnings',
    description: 'Lessons, belief history and proposed tests from bbo_content_learning_memory.json.',
    phase: 'ingest',
    run: async (ctx) => {
      const file = defaultLearningMemoryPath();
      if (!file || !existsSync(file)) return { recordsSeen: 0, recordsWritten: 0, summary: 'No learning memory file found.' };
      const r = importLearningMemory(ctx.db, file);
      return { recordsSeen: r.lessons, recordsWritten: r.lessons + r.experiments, summary: `${r.lessons} lessons · ${r.experiments} experiments · ${r.events} belief events` };
    },
  },
  'instagram-content': { label: 'Sync Instagram content', description: 'List posts via Composio and upsert content (dedupe on platform + post id).', phase: 'ingest', run: (ctx) => syncInstagramContent(ctx) },
  'instagram-metrics': { label: 'Refresh Instagram metrics', description: 'Append a metric snapshot for recent posts (or all with {"all":true}).', phase: 'ingest', run: (ctx) => syncInstagramMetrics(ctx) },
  'instagram-account': { label: 'Sync account insights', description: 'Follower change, account reach, demographics.', phase: 'ingest', run: (ctx) => syncInstagramAccount(ctx) },
  'media-transcripts': { label: 'Media + transcripts', description: 'Download, measure duration/loudness, hook frames, local whisper transcripts.', phase: 'ingest', run: (ctx) => syncMediaAndTranscripts(ctx) },
  score: {
    label: 'Score performance',
    description: 'Recompute normalized performance scores with the active formula version.',
    phase: 'performance',
    run: async (ctx) => {
      const r = computeAllScores(ctx.db);
      return { recordsSeen: r.total, recordsWritten: r.scored, summary: `${r.scored} scored · ${r.immature} immature · ${r.unscored} unscored · ${r.noBaseline} without baseline` };
    },
  },
  'ai-enrich': {
    label: 'Structured content coding',
    description: 'Code hook, opening type, tension, timings, triggers and topics from transcript + frames — intelligence priority order.',
    phase: 'analysis',
    run: async (ctx) => {
      const cfg = brainConfig();
      const concurrency = Math.max(1, Number(ctx.params.concurrency ?? cfg.aiConcurrency));
      const dailyCap = Math.max(1, Number(ctx.params.dailyLimit ?? cfg.aiDailyLimit));
      const alreadyToday = processedToday(ctx.db, 'coded_at');
      const limit = Math.min(Number(ctx.params.limit ?? cfg.aiDailyLimit), Math.max(0, dailyCap - alreadyToday));
      if (limit <= 0) return { recordsSeen: 0, recordsWritten: 0, summary: `daily coding limit reached (${alreadyToday}/${dailyCap})` };
      const queue = buildQueue(ctx.db, { limit, stage: 'coding', ignoreTargets: ctx.params.ignoreTargets === true });
      ctx.log('coding queue built', {
        size: queue.length,
        concurrency,
        byTier: queue.reduce<Record<string, number>>((acc, q) => ({ ...acc, [q.tier]: (acc[q.tier] ?? 0) + 1 }), {}),
        byClass: queue.reduce<Record<string, number>>((acc, q) => ({ ...acc, [q.corpusClass]: (acc[q.corpusClass] ?? 0) + 1 }), {}),
      });
      const out = await aiBatch(ctx, queue.map((q) => q.contentId), (id, budget) => enrichContent(ctx.db, id, { budget }), concurrency, 'enrichment');
      const status = corpusStatus(ctx.db);
      return { ...out, summary: `${out.summary}; corpus ${status.coded}/${status.target} coded (winners ${status.classes.winner.coded}/${status.classes.winner.target}, losers ${status.classes.loser.coded}/${status.classes.loser.target}, average ${status.classes.average.coded}/${status.classes.average.target}, unusual ${status.classes.unusual.coded}/${status.classes.unusual.target})` };
    },
  },
  analyze: {
    label: 'Winner / loser analysis',
    description: 'Deep AI analysis for posts that crossed the configured triggers.',
    phase: 'analysis',
    run: async (ctx) => {
      const t = getSetting<{ maxPerRun: number }>(ctx.db, 'analysis_triggers');
      const queue = analysisQueue(ctx.db);
      if (queue.waitingForMedia.length) ctx.log('waiting for media', { contentIds: queue.waitingForMedia.map((h) => h.fact.contentId) });
      const batch = queue.ready.slice(0, Number(ctx.params.limit ?? t.maxPerRun));
      const out = await aiBatch(
        ctx,
        batch.map((h) => h.fact.contentId),
        (id, budget) => {
          const hit = batch.find((h) => h.fact.contentId === id)!;
          return analyzeContent(ctx.db, id, { reasons: hit.reasons, outcome: hit.outcome, budget });
        },
        Math.max(1, Number(ctx.params.concurrency ?? brainConfig().aiConcurrency)),
        'content_analysis'
      );
      return { ...out, summary: `${out.summary}; ${queue.waitingForMedia.length} waiting for media` };
    },
  },
  'provider-health': {
    label: 'AI provider health',
    description: 'Ask every configured provider for one tiny JSON reply, and report the day/month budget position.',
    phase: 'analysis',
    run: async (ctx) => {
      const health = await healthChecks();
      for (const h of health) {
        markIntegration(ctx.db, h.providerName, h.ok ? { status: 'connected', success: true } : { status: 'needs_attention', error: h.detail.slice(0, 200) });
        ctx.log('provider health', { provider: h.providerName, model: h.modelName, ok: h.ok, latencyMs: h.latencyMs, detail: h.detail.slice(0, 200) });
      }
      const budget = budgetStatus(ctx.db);
      const line = health.map((h) => `${h.providerName}/${h.modelName}: ${h.ok ? `ok ${h.latencyMs}ms` : `FAILED — ${h.detail.slice(0, 80)}`}`).join(' · ');
      return {
        recordsSeen: health.length,
        recordsWritten: health.filter((h) => h.ok).length,
        partial: health.some((h) => !h.ok) && health.some((h) => h.ok),
        summary: `${line || 'no providers configured'} · spent today $${budget.dayUsd.toFixed(4)}/$${budget.dayLimitUsd.toFixed(2)}, month $${budget.monthUsd.toFixed(4)}/$${budget.monthLimitUsd.toFixed(2)}${budget.paused ? ' · BUDGET PAUSED' : ''}`,
      };
    },
  },
  'benchmark-coding': {
    label: 'Benchmark a coding model',
    description: 'Re-code an already-coded, stratified sample with a candidate provider/model. Writes only to benchmark tables.',
    phase: 'analysis',
    run: async (ctx) => {
      const provider = String(ctx.params.provider ?? '');
      const model = String(ctx.params.model ?? '');
      if (!provider || !model) return { recordsSeen: 0, recordsWritten: 0, summary: 'Pass {"provider":"openrouter|nvidia|gemini","model":"<slug>"}' };
      const ids = Array.isArray(ctx.params.contentIds) ? (ctx.params.contentIds as number[]) : benchmarkSample(ctx.db, Number(ctx.params.size ?? 25));
      ctx.log('benchmark sample', { size: ids.length, provider, model });
      const r = await runCodingBenchmark(ctx.db, { provider: provider as 'gemini' | 'openrouter' | 'nvidia', model, label: String(ctx.params.label ?? `${provider}:${model}`) }, ids, {
        budgetUsd: Number(ctx.params.budgetUsd ?? 0.5),
        log: ctx.log,
      });
      const [report] = benchmarkReport(ctx.db, [r.benchmarkRunId]);
      return {
        recordsSeen: ids.length,
        recordsWritten: r.ok,
        partial: r.schemaFailed + r.errored > 0 && r.ok > 0,
        summary: `${r.ok} ok · ${r.schemaFailed} schema-failed · ${r.errored} errored · agreement ${report.overallAgreement === null ? 'n/a' : `${Math.round(report.overallAgreement * 100)}%`} · ${report.taxonomyViolations} taxonomy violations · median ${report.medianLatencyMs}ms · $${report.costUsd.toFixed(4)}`,
      };
    },
  },
  'intelligence-report': {
    label: 'Intelligence review',
    description: 'Answer the fourteen standing questions from calculated evidence, with sample sizes, effects and confidence. Writes data/reports/.',
    phase: 'learning',
    run: async (ctx) => {
      const report = buildIntelligenceReport(ctx.db);
      const markdown = renderIntelligenceReport(report);
      const dir = path.join(process.cwd(), 'data', 'reports');
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `intelligence-${report.generatedAt.slice(0, 10)}.md`);
      writeFileSync(file, markdown, 'utf8');
      const answered = report.answers.filter((a) => a.findings.length || a.note).length;
      const thin = report.answers.filter((a) => a.insufficient && !a.findings.length).length;
      ctx.log('report written', { file, answered, insufficient: thin, coded: report.corpus.coded });
      return { recordsSeen: report.answers.length, recordsWritten: answered, summary: `${answered}/14 questions answered from ${report.corpus.coded} coded posts · ${thin} lack evidence · ${file.replace(process.cwd() + '/', '')}` };
    },
  },
  'mine-lessons': {
    label: 'Mine lessons',
    description: 'Find associations across attributes, topics and guests; update lesson statuses; suggest experiments for early signals.',
    phase: 'learning',
    run: async (ctx) => {
      const r = mineLessons(ctx.db);
      const suggested = suggestExperimentsFromLessons(ctx.db);
      return { recordsSeen: r.testsRun, recordsWritten: r.created + r.updated, summary: `${r.testsRun} comparisons · ${r.created} new lessons · ${r.updated} updated · ${r.imported} audit claims re-checked · ${suggested} experiments suggested` };
    },
  },
  'rule-proposals': {
    label: 'Rule proposals',
    description: 'Propose rules from repeatedly supported lessons. Never activates anything.',
    phase: 'learning',
    run: async (ctx) => {
      const r = generateRuleProposals(ctx.db);
      return { recordsSeen: r.considered, recordsWritten: r.proposed, summary: `${r.considered} supported lessons considered · ${r.proposed} proposals · ${r.attachedToExistingRule} attached to existing rules` };
    },
  },
  'rule-challenges': {
    label: 'Rule challenges',
    description: 'Check active testable rules against recent evidence.',
    phase: 'learning',
    run: async (ctx) => {
      const r = detectRuleChallenges(ctx.db);
      return { recordsSeen: r.rulesChecked, recordsWritten: r.opened, summary: `${r.rulesChecked} testable rules checked · ${r.opened} challenges opened` };
    },
  },
  experiments: {
    label: 'Evaluate experiments',
    description: 'Auto-assign new content to running experiments and re-evaluate results.',
    phase: 'learning',
    run: async (ctx) => {
      const running = all<{ id: number }>(ctx.db, `SELECT id FROM experiments WHERE status = 'running'`);
      let assigned = 0;
      for (const e of running) {
        const a = autoAssign(ctx.db, e.id);
        assigned += a.control + a.variant;
        evaluateExperiment(ctx.db, e.id);
      }
      return { recordsSeen: running.length, recordsWritten: assigned, summary: `${running.length} running · ${assigned} new assignments` };
    },
  },
  opportunities: {
    label: 'Content opportunities',
    description: 'Rank what BBO should make next from topic, guest, format and pattern evidence.',
    phase: 'future',
    run: async (ctx) => {
      const r = generateOpportunities(ctx.db);
      return { recordsSeen: r.count, recordsWritten: r.count, summary: `${r.count} opportunities` };
    },
  },
  'weekly-review': {
    label: 'Weekly review',
    description: 'Last 7 days vs the previous 7.',
    phase: 'review',
    run: async (ctx) => ({ recordsSeen: 1, recordsWritten: 1, summary: `review #${await buildWeeklyReview(ctx.db)}` }),
  },
  'monthly-review': {
    label: 'Monthly review',
    description: 'Last 30 days vs the previous 30.',
    phase: 'review',
    run: async (ctx) => ({ recordsSeen: 1, recordsWritten: 1, summary: `review #${await buildMonthlyReview(ctx.db)}` }),
  },
  graph: { label: 'Rebuild knowledge graph', description: 'Materialise relationships into graph_edges.', phase: 'graph', run: async (ctx) => { const n = rebuildGraph(ctx.db); return { recordsSeen: n, recordsWritten: n, summary: `${n} edges` }; } },
  search: { label: 'Rebuild search index', description: 'FTS5 over content, transcripts, people, topics, lessons, rules, experiments, analyses.', phase: 'graph', run: async (ctx) => { const n = rebuildSearchIndex(ctx.db); return { recordsSeen: n, recordsWritten: n, summary: `${n} documents indexed` }; } },
};

/** The daily loop, in dependency order. Each step is its own recorded job. */
export const DAILY_PIPELINE = ['instagram-content', 'instagram-metrics', 'instagram-account', 'media-transcripts', 'score', 'provider-health', 'ai-enrich', 'analyze', 'mine-lessons', 'rule-proposals', 'rule-challenges', 'experiments', 'opportunities', 'graph', 'search'];

export async function runNamedJob(db: Db, kind: string, params: Record<string, unknown> = {}): Promise<JobRecord> {
  seedReference(db);
  const def = JOBS[kind];
  if (!def) throw new Error(`Unknown job "${kind}". Known: ${Object.keys(JOBS).join(', ')}`);
  return runJob(db, kind, params, def.run);
}

export async function runPipeline(db: Db, steps = DAILY_PIPELINE, params: Record<string, Record<string, unknown>> = {}): Promise<JobRecord[]> {
  const results: JobRecord[] = [];
  for (const step of steps) {
    const r = await runNamedJob(db, step, params[step] ?? {});
    results.push(r);
    // Content and metrics are the foundation; without them later steps would reason over stale data.
    if ((step === 'instagram-content' || step === 'instagram-metrics') && r.status === 'failed') break;
  }
  return results;
}

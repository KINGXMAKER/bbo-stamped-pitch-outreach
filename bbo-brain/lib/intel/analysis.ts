import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { all, get, json, nowIso, parseJson, run, type Db } from '@/lib/db/client';
import { runAi } from '@/lib/ai/run';
import { BudgetPausedError, type BudgetGuard } from '@/lib/ai/budget';
import { candidatesFor, type Candidate } from '@/lib/ai/providers/registry';
import { looseConfidence, looseList, looseText, looseTextNullable } from '@/lib/ai/schema';
import { activeSkill } from '@/lib/ai/skills';
import { brainConfig } from '@/lib/config';
import { getSetting } from '@/lib/seed';
import { ATTRIBUTE_DEFINITIONS } from '@/lib/seed/reference';
import { resolveEntity } from '@/lib/entities/resolve';
import { setAttribute } from '@/lib/ingest/ingest';
import { loadRelevantRules, rulesPromptBlock } from '@/lib/rules/load';
import { activeScoreVersion } from '@/lib/scoring/engine';
import { performanceContext } from '@/lib/scoring/context';
import { COMPONENT_LABELS } from '@/lib/scoring/formula';
import { comparable, loadFacts, type ContentFact } from './dataset';
import { createAnalysisLesson } from './lessons';
import { similarContent } from './similar';

export type Triggers = { scoreHigh: number; scoreLow: number; componentHigh: number; retentionLow: number; requireMature: boolean; maxPerRun: number };

export type TriggerHit = { fact: ContentFact; reasons: string[]; outcome: 'winner' | 'loser' | 'notable'; priority: number };

/** Decides which posts deserve deep AI attention. Average posts are not analysed. */
export function triggerHits(facts: ContentFact[], t: Triggers): TriggerHit[] {
  const hits: TriggerHit[] = [];
  for (const fact of facts) {
    if (t.requireMature && !fact.isMature) continue;
    if (fact.score === null) continue;
    const reasons: string[] = [];
    let up = 0;
    let down = 0;
    if (fact.score >= t.scoreHigh) {
      reasons.push(`performance score ${fact.score.toFixed(2)} ≥ ${t.scoreHigh}`);
      up++;
    }
    if (fact.score <= t.scoreLow) {
      reasons.push(`performance score ${fact.score.toFixed(2)} ≤ ${t.scoreLow}`);
      down++;
    }
    for (const c of fact.components) {
      if ((c.key === 'share_rate' || c.key === 'comment_rate' || c.key === 'retention') && c.ratio >= t.componentHigh) {
        reasons.push(`${COMPONENT_LABELS[c.key]} ${c.ratio.toFixed(1)}x peer median`);
        up++;
      }
      if (c.key === 'retention' && c.ratio <= t.retentionLow) {
        reasons.push(`${COMPONENT_LABELS[c.key]} ${c.ratio.toFixed(2)}x peer median`);
        down++;
      }
    }
    if (!reasons.length) continue;
    const outcome = up && down ? 'notable' : fact.score >= 1 ? 'winner' : 'loser';
    hits.push({ fact, reasons, outcome, priority: Math.abs(Math.log(fact.score)) + reasons.length * 0.1 });
  }
  return hits.sort((a, b) => b.priority - a.priority);
}

export function analysisQueue(db: Db): { ready: TriggerHit[]; waitingForMedia: TriggerHit[]; analysed: number } {
  const t = getSetting<Triggers>(db, 'analysis_triggers');
  const analysed = new Set(all<{ content_id: number }>(db, 'SELECT DISTINCT content_id FROM content_analyses').map((r) => r.content_id));
  const hits = triggerHits(comparable(loadFacts(db)), t).filter((h) => !analysed.has(h.fact.contentId));
  const withFrames = new Set(all<{ id: number }>(db, `SELECT id FROM content WHERE frames_json IS NOT NULL AND frames_json != '[]'`).map((r) => r.id));
  return {
    ready: hits.filter((h) => h.fact.hasTranscript || withFrames.has(h.fact.contentId)),
    waitingForMedia: hits.filter((h) => !h.fact.hasTranscript && !withFrames.has(h.fact.contentId)),
    analysed: analysed.size,
  };
}

// ── Output schema ────────────────────────────────────────────────────────
const allowed = (key: string) => new Set(ATTRIBUTE_DEFINITIONS.find((a) => a.key === key)?.values ?? []);
/** Unknown enum values become null instead of forcing a repair round-trip. */
const enumOf = (key: string) =>
  z.preprocess((v) => (typeof v === 'string' && allowed(key).has(v) ? v : null), z.string().nullable());
const moment = z.preprocess(
  (v) => (typeof v === 'string' ? { quote: v } : v ?? {}),
  z.object({ timestamp: looseTextNullable().default(null), quote: looseText().default(''), why: looseText().default('') })
);

export const AnalysisSchema = z.object({
  evidence_notes: looseText(),
  actual_topic: looseText(),
  underlying_debate: looseText(),
  emotional_trigger: looseText(),
  hook_mechanics: looseText(),
  strongest_moment: moment,
  strongest_opening: z.preprocess(
    (v) => (typeof v === 'string' ? { quote: v } : v ?? {}),
    z.object({ timestamp: looseTextNullable().default(null), quote: looseText().default(''), why: looseText().default(''), is_current_opening: z.boolean().nullable().default(null) })
  ),
  strongest_standalone: moment,
  clarity: looseText(),
  tension: looseText(),
  payoff: looseText(),
  dead_setup: looseText(),
  unnecessary_context: looseText(),
  reaction_timing: looseText(),
  speaker_dynamics: looseText(),
  comment_trigger: looseText(),
  share_trigger: looseText(),
  curiosity_trigger: looseText(),
  outcome_explanation: looseText(),
  retention_strengths: looseList().default([]),
  retention_weaknesses: looseList().default([]),
  editing_opportunities: looseList().default([]),
  reusable_lesson: z.preprocess((v) => (typeof v === 'string' ? { text: v } : v ?? { text: '' }), z.object({ text: looseText(), category: looseText().default('other') })),
  recommended_experiment: z
    .preprocess(
      (v) => (typeof v === 'string' ? { hypothesis: v } : v),
      z.object({ hypothesis: looseText(), variable: looseTextNullable().default(null), control: looseTextNullable().default(null), variant: looseTextNullable().default(null) }).nullable()
    )
    .default(null),
  attributes: z
    .object({
      hook_type: enumOf('hook_type'),
      opening_speaker_role: enumOf('opening_speaker_role'),
      opening_visual: enumOf('opening_visual'),
      emotional_trigger: enumOf('emotional_trigger'),
      tension_type: enumOf('tension_type'),
      controversy_type: enumOf('controversy_type'),
      reaction_timing: enumOf('reaction_timing'),
      editing_style: enumOf('editing_style'),
      guest_gender_mix: enumOf('guest_gender_mix'),
      subtitle_style: enumOf('subtitle_style'),
      opening_type: enumOf('opening_type'),
      clarity_rating: enumOf('clarity_rating'),
      share_trigger_type: enumOf('share_trigger_type'),
      comment_trigger_type: enumOf('comment_trigger_type'),
      curiosity_trigger_type: enumOf('curiosity_trigger_type'),
      guest_answer_opening: z.boolean().nullable().default(null),
      question_opening: z.boolean().nullable().default(null),
      payoff_first: z.boolean().nullable().default(null),
      has_text_hook: z.boolean().nullable().default(null),
      reaction_shot_present: z.boolean().nullable().default(null),
      text_hook: looseTextNullable().default(null),
    })
    .partial()
    .default({}),
  timings: z
    .object({
      time_to_understandable_s: z.preprocess((v) => (v === null || v === undefined || v === '' ? null : Number(v)), z.number().nullable().catch(null)).default(null),
      time_to_tension_s: z.preprocess((v) => (v === null || v === undefined || v === '' ? null : Number(v)), z.number().nullable().catch(null)).default(null),
      time_to_payoff_s: z.preprocess((v) => (v === null || v === undefined || v === '' ? null : Number(v)), z.number().nullable().catch(null)).default(null),
      dead_setup_s: z.preprocess((v) => (v === null || v === undefined || v === '' ? null : Number(v)), z.number().nullable().catch(null)).default(null),
    })
    .partial()
    .default({}),
  opening_line: looseText().default(''),
  topics: looseList().default([]),
  confidence: looseConfidence(),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

const ANALYSIS_TEMPLATE = `You are BBO BRAIN's content analyst. You explain why ONE published BBO post performed the way it did.

HARD RULES
- Ground every claim in the evidence provided: transcript with timestamps, hook frames, caption, comments, metrics. Never invent footage, lines or numbers.
- Determine the actual topic from the transcript/frames — never from the title, the caption alone, or one isolated quote.
- Metrics are relative to BBO's own comparable posts. Say "associated with", never "caused".
- If something could not be observed (no transcript, frames only, comments unavailable), say so in evidence_notes and lower confidence.
- A winner explanation answers "what made this outperform?"; a loser explanation answers "what likely caused viewers to leave or not act?".
- Attribute values must come from the allowed lists below; use null when not observable.

ALLOWED ATTRIBUTE VALUES
{{attribute_values}}

ALLOWED TOPICS (topics[] must use 1–3 of these exact names)
{{topics}}

Return one JSON object matching the schema keys exactly: evidence_notes, actual_topic, underlying_debate, emotional_trigger, hook_mechanics, strongest_moment {timestamp, quote, why}, strongest_opening {timestamp, quote, why, is_current_opening}, strongest_standalone {timestamp, quote, why}, clarity, tension, payoff, dead_setup, unnecessary_context, reaction_timing, speaker_dynamics, comment_trigger, share_trigger, curiosity_trigger, outcome_explanation, retention_strengths[], retention_weaknesses[], editing_opportunities[], reusable_lesson {text, category}, recommended_experiment {hypothesis, variable, control, variant} | null, attributes {…}, topics[], confidence (low|medium|high).`;

export const ATTRIBUTE_VALUES_BLOCK = ATTRIBUTE_DEFINITIONS.filter((a) => a.type === 'enum' && ['hook', 'substance', 'edit'].includes(a.group))
  .map((a) => `${a.key}: ${a.values?.join(' | ')}`)
  .join('\n');

function topicNames(db: Db): string {
  return all<{ name: string }>(db, 'SELECT name FROM topics ORDER BY name')
    .map((t) => t.name)
    .join(' | ');
}

export function formatTranscript(segmentsJson: string | null): string {
  const segments = parseJson<Array<{ start: number; end: number; text: string }>>(segmentsJson, []);
  const ts = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  return segments.map((s) => `[${ts(s.start)}–${ts(s.end)}] ${s.text}`).join('\n');
}

function loadFrames(framesJson: string | null): Array<{ atS: number; mimeType: string; base64: string }> {
  return parseJson<Array<{ atS: number; path: string }>>(framesJson, [])
    .filter((f) => existsSync(f.path))
    .slice(0, 4)
    .map((f) => ({ atS: f.atS, mimeType: 'image/jpeg', base64: readFileSync(f.path).toString('base64') }));
}

export type AnalysisOutcome = { status: 'analysed'; analysisId: number; runId: number } | { status: 'skipped'; reason: string };

export async function analyzeContent(
  db: Db,
  contentId: number,
  options: { reasons?: string[]; outcome?: 'winner' | 'loser' | 'notable'; budget?: BudgetGuard } = {}
): Promise<AnalysisOutcome> {
  const facts = comparable(loadFacts(db));
  const fact = loadFacts(db, { contentIds: [contentId] })[0];
  if (!fact) return { status: 'skipped', reason: 'content not found' };

  const content = get<{ frames_json: string | null }>(db, 'SELECT frames_json FROM content WHERE id = ?', contentId);
  const transcript = get<{ segments_json: string | null; text: string; model: string | null }>(db, 'SELECT segments_json, text, model FROM transcripts WHERE content_id = ? ORDER BY id DESC LIMIT 1', contentId);
  const frames = loadFrames(content?.frames_json ?? null);
  if (!transcript && !frames.length) {
    return { status: 'skipped', reason: 'No transcript or frames yet — run media ingestion first (BBO rule R-003: analyse the real footage, not the caption).' };
  }

  const t = getSetting<Triggers>(db, 'analysis_triggers');
  const hit = triggerHits([fact], t)[0];
  const reasons = options.reasons ?? hit?.reasons ?? ['manual analysis request'];
  const outcome = options.outcome ?? hit?.outcome ?? (fact.score !== null && fact.score >= 1 ? 'winner' : 'loser');

  const rules = loadRelevantRules(db, { workflow: 'content_analysis', franchise: fact.franchise, platform: fact.platform, format: fact.format });
  const skill = activeSkill(db, 'bbo-viral-content');
  const version = activeScoreVersion(db);
  const similar = similarContent(facts, fact, 3);
  const context = performanceContext(fact, facts);
  const comments = all<{ text: string }>(db, `SELECT text FROM content_comments WHERE platform_post_id = ? AND text IS NOT NULL ORDER BY like_count DESC, id LIMIT 25`, fact.postId);
  const basis = [transcript ? 'transcript' : null, frames.length ? 'frames' : null, 'caption', comments.length ? 'comments' : null].filter(Boolean).join('+');

  const evidence = [
    `POST: ${fact.title}`,
    `Platform: ${fact.platform} · Format: ${fact.format} · Franchise: ${fact.franchiseName ?? 'unclassified'} · Published: ${fact.publishedAt.slice(0, 10)} · Duration: ${fact.durationS ?? 'unknown'}s`,
    `OUTCOME TO EXPLAIN: ${outcome.toUpperCase()} — ${reasons.join('; ')}`,
    `Performance score ${fact.score?.toFixed(2) ?? 'n/a'} (${fact.label}) vs peer group "${fact.baselineGroup}". Component ratios vs peer median: ${fact.components.map((c) => `${COMPONENT_LABELS[c.key]} ${c.ratio.toFixed(2)}x`).join(', ')}`,
    `Context: ${context.map((c) => c.text).join(' · ') || 'none'}`,
    '',
    `CAPTION:\n${fact.caption || '(none)'}`,
    '',
    transcript ? `TRANSCRIPT (${transcript.model ?? 'unknown model'}; speaker names not identified):\n${formatTranscript(transcript.segments_json) || transcript.text}` : 'TRANSCRIPT: not available.',
    '',
    frames.length ? `HOOK FRAMES attached in order at: ${frames.map((f) => `${f.atS}s`).join(', ')}` : 'HOOK FRAMES: not available.',
    '',
    comments.length ? `COMMENTS (sample of ${comments.length}):\n${comments.map((c) => `- ${c.text}`).join('\n')}` : 'COMMENTS: text not available.',
    '',
    'SIMILAR HISTORICAL WINNERS:',
    ...(similar.winners.length ? similar.winners.map((s) => `- "${s.fact.title}" score ${s.fact.score?.toFixed(2)} (shares: ${s.shared.join(', ')})`) : ['- none found']),
    'SIMILAR HISTORICAL LOSERS:',
    ...(similar.losers.length ? similar.losers.map((s) => `- "${s.fact.title}" score ${s.fact.score?.toFixed(2)} (shares: ${s.shared.join(', ')})`) : ['- none found']),
    '',
    rulesPromptBlock(rules),
  ].join('\n');

  const result = await runAi({
    db,
    workflow: 'content_analysis',
    task: 'analysis',
    budget: options.budget,
    promptSlug: 'content-analysis',
    template: ANALYSIS_TEMPLATE,
    schemaVersion: 'analysis-v1',
    system: `${ANALYSIS_TEMPLATE.replace('{{attribute_values}}', ATTRIBUTE_VALUES_BLOCK).replace('{{topics}}', topicNames(db))}\n\nBBO VIRAL CONTENT SKILL (v${skill?.version ?? '?'}):\n${skill?.body ?? ''}`,
    prompt: evidence,
    images: frames.map((f) => ({ mimeType: f.mimeType, base64: f.base64 })),
    schema: AnalysisSchema,
    input: { contentId, postId: fact.postId, reasons, outcome, evidenceBasis: basis, similarWinners: similar.winners.map((s) => s.fact.contentId), similarLosers: similar.losers.map((s) => s.fact.contentId), commentCount: comments.length },
    skillVersionId: skill?.id ?? null,
    ruleVersionIds: rules.map((r) => r.versionId),
    scoreVersionId: version.id,
    temperature: 0.3,
    maxOutputTokens: 6000,
    thinkingBudget: 2048,
    confidence: (d) => d.confidence,
  });

  const a = result.data;
  const conf = a.confidence === 'high' ? 0.8 : a.confidence === 'medium' ? 0.6 : 0.4;
  const { lastId: analysisId } = run(
    db,
    `INSERT INTO content_analyses (content_id, platform_post_id, ai_run_id, trigger_reasons_json, outcome, evidence_basis, actual_topic, underlying_debate, emotional_trigger,
       hook_mechanics, tension, payoff, dead_setup, reaction_timing, speaker_dynamics, comment_trigger, share_trigger, curiosity_trigger, outcome_explanation,
       strongest_moment_json, strongest_opening_json, strongest_standalone_json, retention_strengths_json, retention_weaknesses_json, editing_opportunities_json,
       reusable_lesson, recommended_experiment, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    contentId,
    fact.postId,
    result.runId,
    json(reasons),
    outcome,
    basis,
    a.actual_topic,
    a.underlying_debate,
    a.emotional_trigger,
    a.hook_mechanics,
    a.tension,
    a.payoff,
    [a.dead_setup, a.unnecessary_context].filter(Boolean).join(' — '),
    a.reaction_timing,
    a.speaker_dynamics,
    a.comment_trigger,
    a.share_trigger,
    a.curiosity_trigger,
    a.outcome_explanation,
    json(a.strongest_moment),
    json(a.strongest_opening),
    json(a.strongest_standalone),
    json(a.retention_strengths),
    json(a.retention_weaknesses),
    json(a.editing_opportunities),
    a.reusable_lesson.text,
    a.recommended_experiment ? json(a.recommended_experiment) : null,
    a.confidence
  );

  applyAiAttributes(db, contentId, a, conf, result.runId);
  run(db, 'UPDATE content SET coded_at = ? WHERE id = ?', nowIso(), contentId);
  createAnalysisLesson(db, { text: a.reusable_lesson.text, category: a.reusable_lesson.category, contentId, experiment: a.recommended_experiment?.hypothesis ?? null });
  return { status: 'analysed', analysisId, runId: result.runId };
}

/** Numeric timings become comparable buckets; mining works on the buckets. */
function bucketFor(key: string, seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return key === 'time_to_tension_bucket' || key === 'time_to_payoff_bucket' ? 'never' : null;
  const s = Math.max(0, seconds);
  if (key === 'time_to_understandable_bucket') return s <= 2 ? '0-2s' : s <= 5 ? '2-5s' : s <= 8 ? '5-8s' : '>8s';
  if (key === 'time_to_tension_bucket') return s <= 2 ? '0-2s' : s <= 5 ? '2-5s' : s <= 10 ? '5-10s' : '>10s';
  if (key === 'time_to_payoff_bucket') return s <= 5 ? '0-5s' : s <= 15 ? '5-15s' : s <= 30 ? '15-30s' : '>30s';
  if (key === 'dead_setup_bucket') return s < 0.5 ? 'none' : s <= 2 ? '0-2s' : s <= 5 ? '2-5s' : '>5s';
  return null;
}

type CodingPayload = Pick<Analysis, 'attributes' | 'topics' | 'underlying_debate' | 'hook_mechanics'> &
  Partial<Pick<Analysis, 'timings' | 'opening_line' | 'strongest_moment' | 'strongest_opening'>>;

export function applyAiAttributes(db: Db, contentId: number, a: CodingPayload, confidence: number, runId: number): void {
  const t = a.timings ?? {};
  const timingKeys: Array<[keyof typeof t, string]> = [
    ['time_to_understandable_s', 'time_to_understandable_bucket'],
    ['time_to_tension_s', 'time_to_tension_bucket'],
    ['time_to_payoff_s', 'time_to_payoff_bucket'],
    ['dead_setup_s', 'dead_setup_bucket'],
  ];
  for (const [numericKey, bucketKey] of timingKeys) {
    const seconds = t[numericKey] ?? null;
    if (seconds !== null) setAttribute(db, contentId, numericKey, seconds, 'ai', confidence, runId);
    const bucket = bucketFor(bucketKey, seconds);
    if (bucket) setAttribute(db, contentId, bucketKey, bucket, 'ai', confidence, runId);
  }
  if (a.opening_line) setAttribute(db, contentId, 'opening_line', a.opening_line.slice(0, 300), 'ai', confidence, runId);
  if (a.strongest_moment?.quote) setAttribute(db, contentId, 'strongest_moment_quote', a.strongest_moment.quote.slice(0, 300), 'ai', confidence, runId);
  if (a.strongest_opening?.quote) setAttribute(db, contentId, 'strongest_opening_quote', a.strongest_opening.quote.slice(0, 300), 'ai', confidence, runId);
  if (a.strongest_opening && typeof a.strongest_opening.is_current_opening === 'boolean') {
    setAttribute(db, contentId, 'opening_is_strongest', a.strongest_opening.is_current_opening, 'ai', confidence, runId);
  }

  for (const [key, value] of Object.entries(a.attributes ?? {})) {
    if (value === null || value === undefined) continue;
    setAttribute(db, contentId, key, value as string | boolean, 'ai', confidence, runId);
  }
  setAttribute(db, contentId, 'underlying_debate', a.underlying_debate, 'ai', confidence, runId);
  const topicIds: number[] = [];
  for (const name of a.topics.slice(0, 4)) {
    const r = resolveEntity(db, 'topic', name, { contentId, text: `AI topic for content ${contentId}` });
    if (r.kind === 'matched') topicIds.push(Number(r.entityId));
  }
  if (topicIds.length) {
    run(db, `DELETE FROM content_topics WHERE content_id = ? AND source = 'heuristic'`, contentId);
    [...new Set(topicIds)].forEach((topicId, i) =>
      run(
        db,
        `INSERT INTO content_topics (content_id, topic_id, is_primary, source, confidence) VALUES (?, ?, ?, 'ai', ?)
         ON CONFLICT (content_id, topic_id) DO UPDATE SET source = 'ai', confidence = excluded.confidence, is_primary = excluded.is_primary`,
        contentId,
        topicId,
        i === 0 ? 1 : 0,
        confidence
      )
    );
  }
}

// ── Lightweight enrichment for the whole catalogue ─────────────────────────
export const EnrichmentSchema = AnalysisSchema.pick({
  attributes: true,
  topics: true,
  timings: true,
  opening_line: true,
  strongest_moment: true,
  strongest_opening: true,
  underlying_debate: true,
  hook_mechanics: true,
  confidence: true,
  evidence_notes: true,
}).extend({
  franchise: looseTextNullable().default(null),
  opening_hook: looseTextNullable().default(null),
});

const ENRICH_TEMPLATE = `You code ONE BBO post's content attributes from its transcript, hook frames and caption so BBO can compare posts. You do not judge performance.
Use only what the evidence shows. Determine topics from the transcript/frames, not the caption alone. Use null when an attribute is not observable.

ALLOWED ATTRIBUTE VALUES
{{attribute_values}}
franchise: one of {{franchises}} or null
topics: 1–3 of these exact names: {{topics}}

TIMING DEFINITIONS (seconds from the first frame, decimals allowed, null when it never happens)
- time_to_understandable_s: when a stranger could say who is talking and what the subject is
- time_to_tension_s: when a disagreement, stake, confession or contradiction is first present
- time_to_payoff_s: when the clip delivers the moment it was building to
- dead_setup_s: how much of the opening is setup a viewer does not need (0 when none)

Return JSON: {evidence_notes, franchise, opening_hook, opening_line (verbatim first spoken or on-screen line), underlying_debate, hook_mechanics,
strongest_moment {timestamp, quote, why}, strongest_opening {timestamp, quote, why, is_current_opening},
timings {time_to_understandable_s, time_to_tension_s, time_to_payoff_s, dead_setup_s}, attributes {…}, topics[], confidence (low|medium|high)}.`;

/**
 * The exact coding request production uses. Shared so a provider benchmark
 * measures the real prompt against the real material, not an approximation.
 */
export function codingRequest(
  db: Db,
  contentId: number
): { system: string; prompt: string; images: Array<{ mimeType: string; base64: string }>; input: Record<string, unknown>; franchises: string[] } | null {
  const fact = loadFacts(db, { contentIds: [contentId] })[0];
  if (!fact) return null;
  const content = get<{ frames_json: string | null }>(db, 'SELECT frames_json FROM content WHERE id = ?', contentId);
  const transcript = get<{ segments_json: string | null; text: string }>(db, 'SELECT segments_json, text FROM transcripts WHERE content_id = ? ORDER BY id DESC LIMIT 1', contentId);
  const frames = loadFrames(content?.frames_json ?? null);
  if (!transcript && !frames.length) return null;
  const franchises = all<{ slug: string }>(db, 'SELECT slug FROM franchises').map((f) => f.slug);
  return {
    franchises,
    system: ENRICH_TEMPLATE.replace('{{attribute_values}}', ATTRIBUTE_VALUES_BLOCK).replace('{{franchises}}', franchises.join(' | ')).replace('{{topics}}', topicNames(db)),
    prompt: [
      `CAPTION:\n${fact.caption || '(none)'}`,
      transcript ? `TRANSCRIPT:\n${formatTranscript(transcript.segments_json) || transcript.text}` : 'TRANSCRIPT: not available.',
      frames.length ? `HOOK FRAMES attached at: ${frames.map((f) => `${f.atS}s`).join(', ')}` : 'HOOK FRAMES: not available.',
    ].join('\n\n'),
    images: frames.map((f) => ({ mimeType: f.mimeType, base64: f.base64 })),
    input: { contentId, hasTranscript: Boolean(transcript), frames: frames.length },
  };
}

export async function enrichContent(
  db: Db,
  contentId: number,
  options: { budget?: BudgetGuard; pin?: Candidate; noEscalate?: boolean } = {}
): Promise<{ status: 'enriched' | 'skipped'; reason?: string; escalated?: string | null }> {
  const fact = loadFacts(db, { contentIds: [contentId] })[0];
  if (!fact) return { status: 'skipped', reason: 'not found' };
  const content = get<{ frames_json: string | null }>(db, 'SELECT frames_json FROM content WHERE id = ?', contentId);
  const transcript = get<{ segments_json: string | null; text: string }>(db, 'SELECT segments_json, text FROM transcripts WHERE content_id = ? ORDER BY id DESC LIMIT 1', contentId);
  const frames = loadFrames(content?.frames_json ?? null);
  if (!transcript && !frames.length) return { status: 'skipped', reason: 'no transcript or frames' };

  const request = codingRequest(db, contentId);
  if (!request) return { status: 'skipped', reason: 'no transcript or frames' };
  const { system, franchises } = request;
  const result = await runAi({
    db,
    workflow: 'enrichment',
    task: 'coding',
    budget: options.budget,
    pin: options.pin,
    promptSlug: 'content-enrichment',
    template: ENRICH_TEMPLATE,
    schemaVersion: 'enrichment-v1',
    system,
    prompt: request.prompt,
    images: request.images,
    schema: EnrichmentSchema,
    input: request.input,
    temperature: 0.1,
    maxOutputTokens: 2000,
    thinkingBudget: 0,
    confidence: (d) => d.confidence,
  });
  let d = result.data;
  let conf = d.confidence === 'high' ? 0.75 : d.confidence === 'medium' ? 0.55 : 0.35;
  let escalation: EscalationOutcome | null = null;

  // Escalation is the exception, not the rule: two models never run on every
  // post, only where a cheap answer is unsafe to trust (see shouldEscalate).
  const reason = options.pin || options.noEscalate ? null : shouldEscalate(db, contentId, d, conf);
  if (reason) {
    escalation = await escalateCoding(db, contentId, { base: result, baseData: d, reason, budget: options.budget, request });
    if (escalation?.data) {
      d = escalation.data;
      conf = d.confidence === 'high' ? 0.75 : d.confidence === 'medium' ? 0.55 : 0.35;
    }
  }

  applyAiAttributes(db, contentId, d, conf, escalation?.runId ?? result.runId);
  if (d.opening_hook) setAttribute(db, contentId, 'opening_hook', d.opening_hook, 'ai', conf, escalation?.runId ?? result.runId);
  if (d.franchise && franchises.includes(d.franchise)) setAttribute(db, contentId, 'franchise', d.franchise, 'ai', conf, escalation?.runId ?? result.runId);
  run(db, 'UPDATE content SET coded_at = ? WHERE id = ?', nowIso(), contentId);
  return { status: 'enriched', escalated: escalation?.outcome ?? null };
}

/** Fields a disagreement is judged on — the ones BBO's comparisons actually use. */
const ESCALATION_FIELDS = ['hook_type', 'opening_type', 'tension_type', 'emotional_trigger', 'share_trigger_type', 'comment_trigger_type', 'reaction_shot_present', 'payoff_first', 'question_opening', 'guest_answer_opening'];

/** Core fields that must come back filled for a coding to be usable at all. */
const REQUIRED_CODING_FIELDS = ['hook_type', 'opening_type'];

export type EnrichmentPayload = z.infer<typeof EnrichmentSchema>;

type EscalationOutcome = { outcome: 'agreed' | 'kept_stronger' | 'human_review'; data: EnrichmentPayload | null; runId: number | null };

function shouldEscalate(db: Db, contentId: number, d: EnrichmentPayload, conf: number): string | null {
  const cfg = brainConfig();
  const attrs = (d.attributes ?? {}) as Record<string, unknown>;
  const missing = REQUIRED_CODING_FIELDS.filter((k) => attrs[k] === null || attrs[k] === undefined || attrs[k] === '');
  if (missing.length) return `validation failed: ${missing.join(', ')} not coded`;
  if (conf < cfg.escalateBelowConfidence) return `low confidence (${d.confidence})`;
  const label =
    get<{ label: string | null }>(
      db,
      `SELECT ps.label FROM performance_scores ps JOIN platform_posts pp ON pp.id = ps.platform_post_id
       WHERE pp.content_id = ? ORDER BY ps.computed_at DESC LIMIT 1`,
      contentId
    )?.label ?? null;
  if (label && cfg.escalateLabels.includes(label) && conf < 0.6) return `${label.toLowerCase()} coded with only ${d.confidence} confidence`;
  return null;
}

async function escalateCoding(
  db: Db,
  contentId: number,
  args: { base: { runId: number; provider: string; model: string }; baseData: EnrichmentPayload; reason: string; budget?: BudgetGuard; request: NonNullable<ReturnType<typeof codingRequest>> }
): Promise<EscalationOutcome | null> {
  const stronger = candidatesFor('analysis')[0];
  if (!stronger) return null;
  try {
    const result = await runAi({
      db,
      workflow: 'enrichment_escalated',
      task: 'analysis',
      pin: stronger,
      budget: args.budget,
      promptSlug: 'content-enrichment',
      template: ENRICH_TEMPLATE,
      schemaVersion: 'enrichment-v1',
      system: args.request.system,
      prompt: args.request.prompt,
      images: stronger.provider.supportsImages ? args.request.images : undefined,
      schema: EnrichmentSchema,
      input: { ...args.request.input, escalatedFrom: args.base.runId, reason: args.reason },
      temperature: 0.1,
      maxOutputTokens: 2000,
      thinkingBudget: 0,
      parentRunId: args.base.runId,
      confidence: (d) => d.confidence,
    });
    const baseAttrs = (args.baseData.attributes ?? {}) as Record<string, unknown>;
    const newAttrs = (result.data.attributes ?? {}) as Record<string, unknown>;
    const disagreements: string[] = [];
    let compared = 0;
    for (const field of ESCALATION_FIELDS) {
      const a = baseAttrs[field];
      const b = newAttrs[field];
      if (a === null || a === undefined || a === '' || b === null || b === undefined || b === '') continue;
      compared++;
      if (String(a) !== String(b)) disagreements.push(`${field}: ${String(a)} → ${String(b)}`);
    }
    const agreed = compared - disagreements.length;
    // Substantial disagreement between two models is exactly the case a human
    // should look at — the stronger answer is stored, but it is not trusted quietly.
    const outcome = compared > 0 && agreed / compared < 0.6 ? 'human_review' : disagreements.length ? 'kept_stronger' : 'agreed';
    run(
      db,
      `INSERT INTO coding_escalations (content_id, reason, base_run_id, escalated_run_id, base_provider, base_model, escalated_provider, escalated_model, compared, agreed, disagreements_json, outcome)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      contentId,
      args.reason,
      args.base.runId,
      result.runId,
      args.base.provider,
      args.base.model,
      result.provider,
      result.model,
      compared,
      agreed,
      json(disagreements),
      outcome
    );
    return { outcome, data: result.data, runId: result.runId };
  } catch (err) {
    if (err instanceof BudgetPausedError) throw err;
    // The cheap coding still stands; the escalation simply did not happen.
    return null;
  }
}

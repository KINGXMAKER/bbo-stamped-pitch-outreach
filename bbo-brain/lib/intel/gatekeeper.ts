import { z } from 'zod';
import { all, get, json, nowIso, parseJson, run, type Db } from '@/lib/db/client';
import { runAi, type AiRunResult } from '@/lib/ai/run';
import { looseList, looseText, looseTextNullable } from '@/lib/ai/schema';
import { activeSkill } from '@/lib/ai/skills';
import { getSetting } from '@/lib/seed';
import { loadRelevantRules, rulesPromptBlock } from '@/lib/rules/load';
import { loadFacts } from './dataset';
import { median } from './stats';

export const AUTO_FAILS = [
  'unclear_speaker_context',
  'hook_needs_explanation',
  'no_payoff',
  'dead_setup_opening',
  'hook_payoff_mismatch',
  'near_duplicate',
  'weaker_opening_than_available',
] as const;

const ts = looseTextNullable().default(null);

export const EditPlanSchema = z.object({
  title: looseText(),
  opening: z.object({ source_timestamp: ts, line: looseText(), why: looseText() }),
  beats: z.array(z.object({ order: z.coerce.number(), source_in: ts, source_out: ts, text: looseText(), purpose: looseText() })).min(1),
  cuts: z.array(z.object({ source_in: ts, source_out: ts, reason: looseText() })).default([]),
  reaction_shots: z.array(z.object({ at: looseText(), description: looseText() })).default([]),
  text_hook: looseText(),
  caption: looseText(),
  cta: looseText(),
  packaging: z.array(z.object({ platform: looseText(), caption: looseText(), notes: looseText().default('') })).default([]),
  needs_new_material: looseList().default([]),
  estimated_length_s: z.coerce.number().nullable().default(null),
  self_check: z.object({ passed: z.coerce.boolean(), notes: looseList().default([]) }),
});
export type EditPlan = z.infer<typeof EditPlanSchema>;

const score = z.coerce.number().int().min(0).max(10);
export const VerdictSchema = z.object({
  scores: z.object({ hook: score, clarity: score, tension: score, payoff: score, shareability: score, comment_potential: score }),
  auto_fails: looseList().default([]),
  failure_reasons: looseList().default([]),
  summary: looseText(),
});
export type Verdict = z.infer<typeof VerdictSchema>;

export type GatekeeperDecision = { total: number; passed: boolean; autoFails: string[] };

/** Pure: the pass rule. Code decides pass/fail — the model only supplies scores and flags. */
export function evaluateVerdict(verdict: Verdict, passMark: number, extraAutoFails: string[] = []): GatekeeperDecision {
  const s = verdict.scores;
  const total = s.hook + s.clarity + s.tension + s.payoff + s.shareability + s.comment_potential;
  const autoFails = [...new Set([...verdict.auto_fails.filter((f) => (AUTO_FAILS as readonly string[]).includes(f)), ...extraAutoFails])];
  return { total, passed: total >= passMark && autoFails.length === 0, autoFails };
}

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length > 3));
}

/** Deterministic near-duplicate check against the last 30 days — not left to the model. */
export function nearDuplicateOf(db: Db, plan: EditPlan, now = new Date()): { contentId: number; title: string; overlap: number } | null {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const planTokens = tokens(`${plan.opening.line} ${plan.text_hook} ${plan.caption}`);
  if (planTokens.size < 4) return null;
  let best: { contentId: number; title: string; overlap: number } | null = null;
  for (const f of loadFacts(db, { since })) {
    const other = tokens(`${f.caption} ${f.attrs.opening_hook ?? ''} ${f.attrs.opening_transcript ?? ''}`);
    if (!other.size) continue;
    let inter = 0;
    for (const t of planTokens) if (other.has(t)) inter++;
    const overlap = inter / Math.min(planTokens.size, other.size);
    if (overlap >= 0.6 && (!best || overlap > best.overlap)) best = { contentId: f.contentId, title: f.title, overlap };
  }
  return best;
}

const EDITOR_TEMPLATE = `You are the BBO Viral Editor. Build ONE short-form edit plan from the source transcript, following the BBO Viral Content Skill and the active rules.
- Every beat cites source timestamps from the transcript. Never invent lines.
- Search the whole transcript for the strongest opening; psychological order beats recording order.
- Anything not present in the source (pickups, voiceover, B-roll) goes in needs_new_material.
- If a Gatekeeper rejected a previous attempt, fix every failure reason it gave.
Return JSON: {title, opening {source_timestamp, line, why}, beats[{order, source_in, source_out, text, purpose}], cuts[{source_in, source_out, reason}], reaction_shots[{at, description}], text_hook, caption, cta, packaging[{platform, caption, notes}], needs_new_material[], estimated_length_s, self_check {passed, notes[]}}.`;

const GATEKEEPER_TEMPLATE = `You are the BBO Content Gatekeeper, an independent reviewer. You did not write this plan.
Score HOOK, CLARITY, TENSION, PAYOFF, SHAREABILITY, COMMENT_POTENTIAL from 0-10 each against the source transcript.
Flag automatic failures using exactly these ids when they apply: ${AUTO_FAILS.join(', ')}.
Failure reasons must be specific and cite transcript timestamps. Never rewrite the plan.
Return JSON: {scores {hook, clarity, tension, payoff, shareability, comment_potential}, auto_fails[], failure_reasons[], summary}.`;

export type EditSessionInput = {
  title: string;
  transcript: string;
  contentId?: number | null;
  platform?: string | null;
  franchise?: string | null;
};

export async function runEditSession(db: Db, input: EditSessionInput): Promise<{ sessionId: number; status: string; attempts: number; finalTotal: number | null }> {
  const cfg = getSetting<{ passMark: number; maxAutoRetries: number }>(db, 'gatekeeper');
  const franchiseId = input.franchise ? get<{ id: number }>(db, 'SELECT id FROM franchises WHERE slug = ?', input.franchise)?.id ?? null : null;
  const { lastId: sessionId } = run(
    db,
    'INSERT INTO edit_sessions (content_id, title, platform_id, franchise_id, source_transcript) VALUES (?, ?, ?, ?, ?)',
    input.contentId ?? null,
    input.title,
    input.platform ?? 'instagram',
    franchiseId,
    input.transcript
  );

  const editorSkill = activeSkill(db, 'bbo-viral-content');
  const gateSkill = activeSkill(db, 'bbo-gatekeeper');
  const ctx = { franchise: input.franchise ?? null, platform: input.platform ?? 'instagram', format: 'reel' };
  const editorRules = loadRelevantRules(db, { workflow: 'viral_editor', ...ctx });
  const gateRules = loadRelevantRules(db, { workflow: 'gatekeeper', ...ctx });

  let feedback: string[] = [];
  let previousPlan: EditPlan | null = null;
  const maxAttempts = 1 + cfg.maxAutoRetries;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const editor: AiRunResult<EditPlan> = await runAi<EditPlan>({
        db,
        workflow: 'viral_editor',
        promptSlug: 'viral-editor',
        template: EDITOR_TEMPLATE,
        schemaVersion: 'edit-plan-v1',
        system: `${EDITOR_TEMPLATE}\n\nBBO VIRAL CONTENT SKILL (v${editorSkill?.version}):\n${editorSkill?.body}\n\n${rulesPromptBlock(editorRules)}`,
        prompt: [
          `EDIT: ${input.title} · platform ${ctx.platform} · franchise ${input.franchise ?? 'unspecified'}`,
          `SOURCE TRANSCRIPT:\n${input.transcript}`,
          previousPlan ? `YOUR PREVIOUS PLAN (rejected):\n${JSON.stringify(previousPlan)}` : '',
          feedback.length ? `GATEKEEPER FAILURE REASONS TO FIX:\n${feedback.map((f) => `- ${f}`).join('\n')}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
        schema: EditPlanSchema,
        input: { sessionId, attempt, contentId: input.contentId ?? null },
        skillVersionId: editorSkill?.id,
        ruleVersionIds: editorRules.map((r) => r.versionId),
        temperature: 0.7,
        maxOutputTokens: 5000,
        thinkingBudget: 2048,
      });

      // A separate invocation, separate instructions, separate skill: the editor never judges itself.
      const gate = await runAi({
        db,
        workflow: 'gatekeeper',
        promptSlug: 'gatekeeper',
        template: GATEKEEPER_TEMPLATE,
        schemaVersion: 'gatekeeper-v1',
        system: `${GATEKEEPER_TEMPLATE}\n\nBBO GATEKEEPER SKILL (v${gateSkill?.version}):\n${gateSkill?.body}\n\n${rulesPromptBlock(gateRules)}`,
        prompt: `SOURCE TRANSCRIPT:\n${input.transcript}\n\nEDIT PLAN UNDER REVIEW:\n${JSON.stringify(editor.data, null, 1)}`,
        schema: VerdictSchema,
        input: { sessionId, attempt, editorRunId: editor.runId },
        skillVersionId: gateSkill?.id,
        ruleVersionIds: gateRules.map((r) => r.versionId),
        parentRunId: editor.runId,
        temperature: 0.2,
        maxOutputTokens: 2000,
        thinkingBudget: 1024,
      });

      const duplicate = nearDuplicateOf(db, editor.data);
      const decision = evaluateVerdict(gate.data, cfg.passMark, duplicate ? ['near_duplicate'] : []);
      const reasons = [...gate.data.failure_reasons, ...(duplicate ? [`Near-duplicate of "${duplicate.title}" published in the last 30 days (${Math.round(duplicate.overlap * 100)}% wording overlap).`] : [])];
      if (!decision.passed && decision.total < cfg.passMark) reasons.push(`Total ${decision.total}/60 is below the ${cfg.passMark}/60 pass mark.`);

      run(
        db,
        `INSERT INTO gatekeeper_reviews (edit_session_id, attempt, editor_run_id, gatekeeper_run_id, edit_plan_json, hook, clarity, tension, payoff, shareability, comment_potential, total, auto_fails_json, passed, failure_reasons_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        sessionId,
        attempt,
        editor.runId,
        gate.runId,
        json(editor.data),
        gate.data.scores.hook,
        gate.data.scores.clarity,
        gate.data.scores.tension,
        gate.data.scores.payoff,
        gate.data.scores.shareability,
        gate.data.scores.comment_potential,
        decision.total,
        json(decision.autoFails),
        decision.passed ? 1 : 0,
        json(reasons)
      );

      if (decision.passed) {
        run(db, `UPDATE edit_sessions SET status = 'passed', attempts = ?, final_total = ?, updated_at = ? WHERE id = ?`, attempt, decision.total, nowIso(), sessionId);
        return { sessionId, status: 'passed', attempts: attempt, finalTotal: decision.total };
      }
      previousPlan = editor.data;
      feedback = reasons;
      run(db, 'UPDATE edit_sessions SET attempts = ?, final_total = ?, updated_at = ? WHERE id = ?', attempt, decision.total, nowIso(), sessionId);
    } catch (err) {
      run(db, `UPDATE edit_sessions SET status = 'error', attempts = ?, human_note = ?, updated_at = ? WHERE id = ?`, attempt, (err instanceof Error ? err.message : String(err)).slice(0, 500), nowIso(), sessionId);
      throw err;
    }
  }

  // Automatic retries exhausted — a human decides now.
  run(db, `UPDATE edit_sessions SET status = 'needs_human', updated_at = ? WHERE id = ?`, nowIso(), sessionId);
  const last = get<{ total: number }>(db, 'SELECT total FROM gatekeeper_reviews WHERE edit_session_id = ? ORDER BY attempt DESC LIMIT 1', sessionId);
  return { sessionId, status: 'needs_human', attempts: maxAttempts, finalTotal: last?.total ?? null };
}

export function decideEditSession(db: Db, sessionId: number, decision: 'approve' | 'reject', note?: string): void {
  const session = get<{ status: string }>(db, 'SELECT status FROM edit_sessions WHERE id = ?', sessionId);
  if (!session) throw new Error(`Edit session ${sessionId} not found.`);
  if (session.status === 'human_approved' || session.status === 'human_rejected') throw new Error('This session already has a human decision.');
  run(db, 'UPDATE edit_sessions SET status = ?, human_note = ?, updated_at = ? WHERE id = ?', decision === 'approve' ? 'human_approved' : 'human_rejected', note ?? null, nowIso(), sessionId);
}

export function linkPublishedContent(db: Db, sessionId: number, contentId: number): void {
  run(db, 'UPDATE edit_sessions SET published_content_id = ?, updated_at = ? WHERE id = ?', contentId, nowIso(), sessionId);
}

function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length < 3) return null;
  const rank = (v: number[]) => {
    const sorted = [...v].map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
    const r = new Array<number>(v.length);
    sorted.forEach((s, idx) => (r[s.i] = idx + 1));
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const d2 = rx.reduce((acc, r, i) => acc + (r - ry[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

/** "Does our Gatekeeper actually predict winners?" — only from published, scored sessions. */
export function gatekeeperCalibration(db: Db) {
  const pairs = all<{ session_id: number; title: string; final_total: number; content_id: number }>(
    db,
    `SELECT id AS session_id, title, final_total, published_content_id AS content_id FROM edit_sessions WHERE published_content_id IS NOT NULL AND final_total IS NOT NULL`
  );
  const facts = new Map(loadFacts(db, { contentIds: pairs.map((p) => p.content_id) }).map((f) => [f.contentId, f]));
  const scored = pairs.map((p) => ({ ...p, score: facts.get(p.content_id)?.score ?? null })).filter((p): p is typeof p & { score: number } => p.score !== null);
  const rho = spearman(scored.map((p) => p.final_total), scored.map((p) => p.score));
  const passMark = getSetting<{ passMark: number }>(db, 'gatekeeper').passMark;
  const passed = scored.filter((p) => p.final_total >= passMark).map((p) => p.score);
  const failed = scored.filter((p) => p.final_total < passMark).map((p) => p.score);
  return {
    n: scored.length,
    spearman: rho,
    medianScorePassed: median(passed),
    medianScoreFailed: median(failed),
    verdict: scored.length < 10 ? 'INSUFFICIENT_DATA — needs at least 10 published, scored edits.' : rho !== null && rho > 0.3 ? 'Gatekeeper totals are associated with performance.' : 'Gatekeeper totals do not yet track performance.',
    pairs: scored,
  };
}

export function sessionDetail(db: Db, sessionId: number) {
  const session = get<Record<string, unknown>>(db, 'SELECT * FROM edit_sessions WHERE id = ?', sessionId);
  const reviews = all<Record<string, unknown> & { edit_plan_json: string; auto_fails_json: string; failure_reasons_json: string }>(
    db,
    'SELECT * FROM gatekeeper_reviews WHERE edit_session_id = ? ORDER BY attempt',
    sessionId
  ).map((r) => ({ ...r, plan: parseJson<EditPlan | null>(r.edit_plan_json, null), autoFails: parseJson<string[]>(r.auto_fails_json, []), reasons: parseJson<string[]>(r.failure_reasons_json, []) }));
  return { session, reviews };
}

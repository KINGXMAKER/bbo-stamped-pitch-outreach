import { afterEach, describe, expect, it } from 'vitest';
import { all, get } from '@/lib/db/client';
import { setGenerator } from '@/lib/ai/run';
import type { GenerateRequest } from '@/lib/ai/gemini';
import { decideEditSession, evaluateVerdict, runEditSession, type Verdict } from '@/lib/intel/gatekeeper';
import { testDb } from './helpers';

const PLAN = {
  title: 'Test cut',
  opening: { source_timestamp: '00:41.0', line: "I didn't.", why: 'Strongest standalone line' },
  beats: [{ order: 1, source_in: '00:41.0', source_out: '00:43.0', text: "I didn't.", purpose: 'hook' }],
  cuts: [],
  reaction_shots: [],
  text_hook: 'THE LINE THAT ENDED THE DATE',
  caption: 'Would you have stayed?',
  cta: 'Stay or leave — comment which',
  packaging: [],
  needs_new_material: [],
  estimated_length_s: 24,
  self_check: { passed: true, notes: [] },
};

const verdict = (each: number, autoFails: string[] = []): Verdict => ({
  scores: { hook: each, clarity: each, tension: each, payoff: each, shareability: each, comment_potential: each },
  auto_fails: autoFails,
  failure_reasons: each < 8 ? ['Opening at 00:03 is weaker than 00:41.'] : [],
  summary: 'test',
});

function script(verdicts: Verdict[]) {
  const prompts: GenerateRequest[] = [];
  let gate = 0;
  setGenerator(async (req) => {
    prompts.push(req);
    const isGatekeeper = req.system.startsWith('You are the BBO Content Gatekeeper');
    return { text: JSON.stringify(isGatekeeper ? verdicts[gate++] : PLAN), model: 'scripted-test', provider: 'test' };
  });
  return prompts;
}

afterEach(() => setGenerator(null));

describe('evaluateVerdict thresholds', () => {
  it('passes at exactly 45/60 and fails at 44', () => {
    const v = verdict(7);
    expect(evaluateVerdict({ ...v, scores: { ...v.scores, hook: 10, clarity: 10, tension: 10, payoff: 5, shareability: 5, comment_potential: 5 } }, 45)).toMatchObject({ total: 45, passed: true });
    expect(evaluateVerdict({ ...v, scores: { ...v.scores, hook: 9, clarity: 10, tension: 10, payoff: 5, shareability: 5, comment_potential: 5 } }, 45)).toMatchObject({ total: 44, passed: false });
  });

  it('fails any automatic failure regardless of score, and ignores unknown flags', () => {
    expect(evaluateVerdict(verdict(10, ['no_payoff']), 45)).toMatchObject({ total: 60, passed: false, autoFails: ['no_payoff'] });
    expect(evaluateVerdict(verdict(10, ['made_up_flag']), 45)).toMatchObject({ passed: true, autoFails: [] });
    expect(evaluateVerdict(verdict(10), 45, ['near_duplicate']).passed).toBe(false);
  });
});

describe('editor → gatekeeper loop', () => {
  it('passes on the first attempt with separate editor and gatekeeper runs', async () => {
    const db = testDb();
    script([verdict(8)]);
    const result = await runEditSession(db, { title: 'x', transcript: '[00:41.0–00:43.0] I didn\'t.', franchise: 'podcast' });
    expect(result).toMatchObject({ status: 'passed', attempts: 1, finalTotal: 48 });
    const runs = all<{ id: number; workflow: string; parent_run_id: number | null; skill_version_id: number | null }>(db, 'SELECT id, workflow, parent_run_id, skill_version_id FROM ai_runs ORDER BY id');
    expect(runs.map((r) => r.workflow)).toEqual(['viral_editor', 'gatekeeper']);
    expect(runs[1].parent_run_id).toBe(runs[0].id);
    expect(runs[0].skill_version_id).not.toBe(runs[1].skill_version_id);
    // Rule versions used are recorded per run, including the podcast-scoped R-015.
    const codes = all<{ code: string }>(db, 'SELECT r.code FROM ai_run_rules arr JOIN rule_versions rv ON rv.id = arr.rule_version_id JOIN rules r ON r.id = rv.rule_id WHERE arr.ai_run_id = ?', runs[0].id).map((r) => r.code);
    expect(codes).toContain('R-015');
  });

  it('feeds failure reasons back and passes on a revision', async () => {
    const db = testDb();
    const prompts = script([verdict(5), verdict(8)]);
    const result = await runEditSession(db, { title: 'x', transcript: 't' });
    expect(result).toMatchObject({ status: 'passed', attempts: 2 });
    const secondEditorPrompt = prompts.filter((p) => !p.system.startsWith('You are the BBO Content Gatekeeper'))[1];
    expect(secondEditorPrompt.prompt).toContain('GATEKEEPER FAILURE REASONS TO FIX');
    expect(secondEditorPrompt.prompt).toContain('below the 45/60 pass mark');
  });

  it('stops after 2 automatic retries and requires a human', async () => {
    const db = testDb();
    script([verdict(5), verdict(6), verdict(6, ['dead_setup_opening'])]);
    const result = await runEditSession(db, { title: 'x', transcript: 't' });
    expect(result).toMatchObject({ status: 'needs_human', attempts: 3 });
    const reviews = all<{ attempt: number; passed: number; auto_fails_json: string }>(db, 'SELECT attempt, passed, auto_fails_json FROM gatekeeper_reviews ORDER BY attempt');
    expect(reviews).toHaveLength(3);
    expect(reviews.every((r) => r.passed === 0)).toBe(true);
    expect(JSON.parse(reviews[2].auto_fails_json)).toEqual(['dead_setup_opening']);

    decideEditSession(db, result.sessionId, 'approve', 'Taking it anyway — the line is the show.');
    expect(get<{ status: string }>(db, 'SELECT status FROM edit_sessions WHERE id = ?', result.sessionId)!.status).toBe('human_approved');
    expect(() => decideEditSession(db, result.sessionId, 'reject')).toThrow(/already has a human decision/);
  });

  it('respects a configured retry limit', async () => {
    const db = testDb();
    db.prepare(`UPDATE settings SET value_json = '{"passMark":45,"maxAutoRetries":0}' WHERE key = 'gatekeeper'`).run();
    script([verdict(5)]);
    expect(await runEditSession(db, { title: 'x', transcript: 't' })).toMatchObject({ status: 'needs_human', attempts: 1 });
  });
});

'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb, nowIso, run } from '@/lib/db/client';
import { editSkill, SKILL_SLUGS, type SkillSlug } from '@/lib/ai/skills';
import { decideCandidate } from '@/lib/entities/resolve';
import { setAttribute } from '@/lib/ingest/ingest';
import { analyzeContent } from '@/lib/intel/analysis';
import { askBbo, type AskResult } from '@/lib/intel/ask';
import { abandonExperiment, assignContent, completeExperiment, createExperiment, evaluateExperiment, startExperiment } from '@/lib/intel/experiments';
import { decideEditSession, linkPublishedContent, runEditSession } from '@/lib/intel/gatekeeper';
import { setLessonStatus, type LessonStatus } from '@/lib/intel/lessons';
import { generateOpportunities, setOpportunityStatus } from '@/lib/intel/opportunities';
import { buildMonthlyReview, buildWeeklyReview } from '@/lib/intel/reviews';
import type { MetricKey } from '@/lib/intel/dataset';
import { decideChallenge, decideProposal, type ChallengeDecision, type ProposalDecision } from '@/lib/rules/engine';
import { computeAllScores, createScoreVersion } from '@/lib/scoring/engine';
import type { LabelThresholds, ScoreFormula } from '@/lib/scoring/formula';
import { setSetting } from '@/lib/seed';

const str = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();
const num = (fd: FormData, key: string) => Number(fd.get(key));

/** Every action: do the work, then return to the page with a notice or the error text. */
function finish(back: string, error: string | null, notice: string): never {
  const base = back.startsWith('/') && !back.startsWith('//') ? back.split('?')[0] : '/';
  revalidatePath('/', 'layout');
  redirect(`${base}?${error ? `error=${encodeURIComponent(error)}` : `notice=${encodeURIComponent(notice)}`}`);
}

function attempt(fn: () => void | Promise<void>): Promise<string | null> {
  return Promise.resolve()
    .then(fn)
    .then(() => null)
    .catch((err: unknown) => (err instanceof Error ? err.message : String(err)));
}

export async function decideProposalAction(fd: FormData) {
  const action = str(fd, 'action') as ProposalDecision['action'];
  const text = str(fd, 'text');
  const note = str(fd, 'note') || undefined;
  const decision: ProposalDecision = action === 'edit_approve' ? { action, text, note } : ({ action, note } as ProposalDecision);
  const error = await attempt(() => {
    decideProposal(getDb(), num(fd, 'id'), decision, process.cwd());
  });
  finish(str(fd, 'back') || '/proposals', error, action === 'reject' ? 'Proposal rejected. No rule changed.' : action === 'observe' ? 'Kept observing. It will only be re-proposed when the evidence grows.' : 'Rule approved and active. Future AI runs will receive it.');
}

export async function decideChallengeAction(fd: FormData) {
  const action = str(fd, 'action') as ChallengeDecision['action'];
  const franchises = fd.getAll('franchises').map(String).filter(Boolean);
  const decision: ChallengeDecision =
    action === 'narrow'
      ? { action, appliesTo: { workflows: ['viral_editor', 'gatekeeper', 'content_analysis'], ...(franchises.length ? { franchises } : {}) }, text: str(fd, 'text') || undefined, note: str(fd, 'note') || undefined }
      : action === 'replace'
        ? { action, text: str(fd, 'text'), note: str(fd, 'note') || undefined }
        : ({ action, note: str(fd, 'note') || undefined } as ChallengeDecision);
  const error = await attempt(() => decideChallenge(getDb(), num(fd, 'id'), decision, process.cwd()));
  finish(str(fd, 'back') || '/rules', error, `Challenge resolved: ${action}.`);
}

export async function setLessonStatusAction(fd: FormData) {
  const error = await attempt(() => setLessonStatus(getDb(), num(fd, 'id'), str(fd, 'status') as LessonStatus, str(fd, 'note') || 'Changed by King Maker.'));
  finish(str(fd, 'back') || '/lessons', error, 'Lesson status updated.');
}

export async function createExperimentAction(fd: FormData) {
  let id = 0;
  const error = await attempt(() => {
    id = createExperiment(getDb(), {
      name: str(fd, 'name'),
      hypothesis: str(fd, 'hypothesis'),
      variableKey: str(fd, 'variableKey') || null,
      controlValue: str(fd, 'controlValue') || null,
      variantValue: str(fd, 'variantValue') || null,
      primaryMetric: (str(fd, 'primaryMetric') || 'performance_score') as MetricKey,
      franchiseSlug: str(fd, 'franchise') || null,
      topicSlug: str(fd, 'topic') || null,
      minSamplePerArm: num(fd, 'minSamplePerArm') || 5,
      origin: 'human',
    });
    if (!str(fd, 'name') || !str(fd, 'hypothesis')) throw new Error('Name and hypothesis are required.');
  });
  finish(error || !id ? '/experiments' : `/experiments/${id}`, error, 'Experiment created. Start it when the first test post is planned.');
}

export async function experimentStateAction(fd: FormData) {
  const id = num(fd, 'id');
  const op = str(fd, 'op');
  const db = getDb();
  const error = await attempt(() => {
    if (op === 'start') startExperiment(db, id, str(fd, 'startDate') ? new Date(str(fd, 'startDate')).toISOString() : nowIso());
    else if (op === 'abandon') abandonExperiment(db, id, str(fd, 'note') || 'Abandoned by King Maker.');
    else if (op === 'evaluate') evaluateExperiment(db, id);
    else if (op === 'complete') completeExperiment(db, id);
    else throw new Error('Unknown operation.');
  });
  finish(`/experiments/${id}`, error, op === 'complete' ? 'Experiment completed — its result is now a lesson.' : `Experiment ${op}ed.`);
}

export async function assignContentAction(fd: FormData) {
  const error = await attempt(() => assignContent(getDb(), num(fd, 'experimentId'), num(fd, 'contentId'), str(fd, 'arm') === 'variant' ? 'variant' : 'control'));
  finish(str(fd, 'back'), error, 'Assigned to the experiment.');
}

export async function decideEntityAction(fd: FormData) {
  const action = str(fd, 'action');
  const error = await attempt(() => {
    decideCandidate(getDb(), num(fd, 'id'), action === 'merge' ? { action: 'merge', entityId: str(fd, 'entityId') } : action === 'create' ? { action: 'create' } : { action: 'ignore' });
  });
  finish('/settings/entities', error, action === 'merge' ? 'Merged and alias learned.' : action === 'create' ? 'Created as a separate person.' : 'Ignored.');
}

export async function opportunityStatusAction(fd: FormData) {
  const error = await attempt(() => setOpportunityStatus(getDb(), num(fd, 'id'), str(fd, 'status') as 'open' | 'accepted' | 'dismissed' | 'made'));
  finish(str(fd, 'back') || '/next', error, 'Opportunity updated.');
}

export async function refreshOpportunitiesAction() {
  const error = await attempt(() => {
    generateOpportunities(getDb());
  });
  finish('/next', error, 'Opportunities recalculated from current data.');
}

export async function setAttributeAction(fd: FormData) {
  const contentId = num(fd, 'contentId');
  const error = await attempt(() => {
    const value = str(fd, 'value');
    if (!value) {
      run(getDb(), `DELETE FROM content_attributes WHERE content_id = ? AND key = ? AND source = 'human'`, contentId, str(fd, 'key'));
      return;
    }
    setAttribute(getDb(), contentId, str(fd, 'key'), value, 'human', 1);
  });
  finish(`/content/${contentId}`, error, 'Attribute saved as a human decision (outranks AI and heuristics).');
}

export async function setPersonAction(fd: FormData) {
  const id = num(fd, 'id');
  const error = await attempt(() => {
    run(getDb(), 'UPDATE people SET gender = ?, type = ?, canonical_name = ?, notes = ? WHERE id = ?', str(fd, 'gender') || null, str(fd, 'type') || 'guest', str(fd, 'name'), str(fd, 'notes') || null, id);
  });
  finish(`/people/${id}`, error, 'Person updated.');
}

export async function analyzeContentAction(fd: FormData) {
  const contentId = num(fd, 'contentId');
  let message = 'Analysis complete.';
  const error = await attempt(async () => {
    const r = await analyzeContent(getDb(), contentId);
    if (r.status === 'skipped') throw new Error(r.reason);
  });
  if (error) message = error;
  finish(`/content/${contentId}`, error, message);
}

export async function runEditSessionAction(fd: FormData) {
  let sessionId = 0;
  const error = await attempt(async () => {
    const transcript = str(fd, 'transcript');
    if (transcript.length < 40) throw new Error('Paste a transcript with timestamps (at least a few lines).');
    const r = await runEditSession(getDb(), {
      title: str(fd, 'title') || 'Untitled edit',
      transcript,
      contentId: num(fd, 'contentId') || null,
      franchise: str(fd, 'franchise') || null,
      platform: str(fd, 'platform') || 'instagram',
    });
    sessionId = r.sessionId;
  });
  finish(sessionId ? `/edit-lab/${sessionId}` : '/edit-lab', error, 'Editor and Gatekeeper finished.');
}

export async function decideEditSessionAction(fd: FormData) {
  const id = num(fd, 'id');
  const error = await attempt(() => {
    const op = str(fd, 'op');
    if (op === 'link') linkPublishedContent(getDb(), id, num(fd, 'contentId'));
    else decideEditSession(getDb(), id, op === 'approve' ? 'approve' : 'reject', str(fd, 'note') || undefined);
  });
  finish(`/edit-lab/${id}`, error, 'Decision recorded.');
}

export async function saveTriggersAction(fd: FormData) {
  const error = await attempt(() => {
    const value = {
      scoreHigh: num(fd, 'scoreHigh'),
      scoreLow: num(fd, 'scoreLow'),
      componentHigh: num(fd, 'componentHigh'),
      retentionLow: num(fd, 'retentionLow'),
      requireMature: fd.get('requireMature') === 'on',
      maxPerRun: num(fd, 'maxPerRun'),
    };
    if (Object.values(value).some((v) => typeof v === 'number' && !Number.isFinite(v))) throw new Error('Every trigger needs a number.');
    setSetting(getDb(), 'analysis_triggers', value);
    const passMark = num(fd, 'passMark');
    const maxAutoRetries = num(fd, 'maxAutoRetries');
    if (!(passMark >= 0 && passMark <= 60) || !(maxAutoRetries >= 0 && maxAutoRetries <= 5)) throw new Error('Pass mark must be 0–60 and retries 0–5.');
    setSetting(getDb(), 'gatekeeper', { passMark, maxAutoRetries });
  });
  finish('/settings', error, 'Settings saved (previous values kept in settings history).');
}

export async function editSkillAction(fd: FormData) {
  const slug = str(fd, 'slug') as SkillSlug;
  const error = await attempt(() => {
    if (!SKILL_SLUGS.includes(slug)) throw new Error('Unknown skill.');
    const changed = editSkill(getDb(), slug, String(fd.get('body') ?? ''), str(fd, 'notes') || 'Edited in Settings.');
    if (!changed) throw new Error('No changes to save.');
  });
  finish('/settings/skills', error, 'New skill version saved and active.');
}

export async function createScoreVersionAction(fd: FormData) {
  const error = await attempt(() => {
    const formula = JSON.parse(str(fd, 'formula')) as ScoreFormula;
    const thresholds = JSON.parse(str(fd, 'thresholds')) as LabelThresholds;
    if (!formula.weights || typeof thresholds.WINNER !== 'number') throw new Error('Formula needs weights; thresholds need BREAKOUT/WINNER/ABOVE_AVERAGE/AVERAGE_FLOOR/LOSER_CEILING.');
    const db = getDb();
    createScoreVersion(db, { version: str(fd, 'version'), formula, thresholds, notes: str(fd, 'notes'), activate: fd.get('activate') === 'on' });
    if (fd.get('activate') === 'on') computeAllScores(db);
  });
  finish('/performance', error, 'Score version created.');
}

export async function buildReviewAction(fd: FormData) {
  const kind = str(fd, 'kind');
  const error = await attempt(async () => {
    if (kind === 'monthly') await buildMonthlyReview(getDb());
    else await buildWeeklyReview(getDb());
  });
  finish('/reviews', error, `${kind === 'monthly' ? 'Monthly' : 'Weekly'} review generated.`);
}

export type AskState = { result: AskResult | null; error: string | null };

export async function askAction(_prev: AskState, fd: FormData): Promise<AskState> {
  const question = str(fd, 'question');
  if (question.length < 4) return { result: null, error: 'Ask a full question.' };
  try {
    return { result: await askBbo(getDb(), question), error: null };
  } catch (err) {
    return { result: null, error: err instanceof Error ? err.message : String(err) };
  }
}

import { all, get, json, nowIso, run, tx, type Db } from '@/lib/db/client';
import { setAttribute } from '@/lib/ingest/ingest';
import { corpusClass, type CorpusClass } from '@/lib/sync/media-queue';
import { loadFacts, type ContentFact } from './dataset';

/**
 * Human validation of AI coding.
 *
 * AI labels feed pattern mining, which feeds rule proposals — so before those
 * labels are trusted, a human checks a stratified sample and every correction
 * is kept, giving a measurable per-attribute agreement rate.
 */

export type ValidationStatus = 'UNREVIEWED' | 'APPROVED' | 'EDITED' | 'REJECTED';

/** Attributes a reviewer actually judges (controlled vocabularies + the key booleans). */
export const REVIEW_KEYS = [
  'hook_type',
  'opening_type',
  'opening_speaker_role',
  'guest_answer_opening',
  'question_opening',
  'payoff_first',
  'tension_type',
  'emotional_trigger',
  'controversy_type',
  'clarity_rating',
  'share_trigger_type',
  'comment_trigger_type',
  'curiosity_trigger_type',
  'reaction_shot_present',
  'reaction_timing',
  'opening_visual',
  'has_text_hook',
  'editing_style',
  'guest_gender_mix',
  'franchise',
] as const;

export type CodedRow = {
  contentId: number;
  title: string;
  label: string | null;
  score: number | null;
  publishedAt: string;
  franchise: string | null;
  corpusClass: CorpusClass;
  status: ValidationStatus;
  hasTranscript: boolean;
  topics: string[];
};

export function codedRows(db: Db, filter: { status?: ValidationStatus } = {}): CodedRow[] {
  const coded = new Map(
    all<{ id: number; coding_validation_status: ValidationStatus; coded_at: string | null }>(db, 'SELECT id, coding_validation_status, coded_at FROM content WHERE coded_at IS NOT NULL').map((r) => [r.id, r])
  );
  return loadFacts(db)
    .filter((f) => coded.has(f.contentId))
    .map((f) => ({
      contentId: f.contentId,
      title: f.title,
      label: f.label,
      score: f.score,
      publishedAt: f.publishedAt,
      franchise: f.franchiseName,
      corpusClass: corpusClass(f),
      status: coded.get(f.contentId)!.coding_validation_status,
      hasTranscript: f.hasTranscript,
      topics: f.topics.map((t) => t.name),
    }))
    .filter((r) => !filter.status || r.status === filter.status);
}

/**
 * A review sample that spans outcomes, franchises and topics — reviewing 25
 * winners would tell us nothing about how the AI codes a flop.
 */
export function validationSample(db: Db, size = 25): CodedRow[] {
  // Posts where two models substantially disagreed are the most informative
  // reviews available, so they go first; the stratified quotas fill the rest.
  const disputed = new Set(all<{ content_id: number }>(db, `SELECT DISTINCT content_id FROM coding_escalations WHERE outcome = 'human_review'`).map((r) => r.content_id));
  const rows = codedRows(db, { status: 'UNREVIEWED' }).sort((a, b) => Number(disputed.has(b.contentId)) - Number(disputed.has(a.contentId)));
  const quota: Record<CorpusClass, number> = {
    winner: Math.round(size * 0.35),
    loser: Math.round(size * 0.3),
    average: Math.round(size * 0.2),
    unusual: Math.round(size * 0.15),
    // Unscored posts (too recent or too little data to be labelled) teach us
    // nothing about winners vs losers, so they only fill leftover slots.
    other: 0,
  };
  const picked: CodedRow[] = [];
  const franchiseCount = new Map<string, number>();
  const topicCount = new Map<string, number>();
  const franchiseCap = Math.max(2, Math.ceil(size * 0.35));
  const topicCap = Math.max(2, Math.ceil(size * 0.3));

  const pass = (relaxed: boolean) => {
    for (const row of rows) {
      if (picked.length >= size) return;
      if (picked.some((p) => p.contentId === row.contentId)) continue;
      if (!relaxed && quota[row.corpusClass] <= 0) continue;
      const f = row.franchise ?? 'Unclassified';
      if (!relaxed && (franchiseCount.get(f) ?? 0) >= franchiseCap) continue;
      if (!relaxed && row.topics.some((t) => (topicCount.get(t) ?? 0) >= topicCap)) continue;
      picked.push(row);
      quota[row.corpusClass]--;
      franchiseCount.set(f, (franchiseCount.get(f) ?? 0) + 1);
      for (const t of row.topics) topicCount.set(t, (topicCount.get(t) ?? 0) + 1);
    }
  };
  pass(false);
  pass(true);
  return picked;
}

export type ReviewInput = {
  contentId: number;
  status: 'APPROVED' | 'EDITED' | 'REJECTED';
  note?: string;
  /** key → corrected value ('' clears a human override). Only used for EDITED. */
  values?: Record<string, string>;
};

export function recordReview(db: Db, input: ReviewInput): { changed: string[] } {
  return tx(db, () => {
    const content = get<{ id: number }>(db, 'SELECT id FROM content WHERE id = ?', input.contentId);
    if (!content) throw new Error(`Content ${input.contentId} not found.`);
    const current = new Map(
      all<{ key: string; value_text: string; source: string }>(db, 'SELECT key, value_text, source FROM content_attribute_current WHERE content_id = ?', input.contentId).map((r) => [r.key, r])
    );
    const changed: string[] = [];

    if (input.status === 'EDITED' && input.values) {
      for (const [key, raw] of Object.entries(input.values)) {
        if (!REVIEW_KEYS.includes(key as (typeof REVIEW_KEYS)[number])) continue;
        const value = raw.trim();
        const existing = current.get(key);
        if (value === (existing?.value_text ?? '')) continue;
        if (!value) {
          run(db, `DELETE FROM content_attributes WHERE content_id = ? AND key = ? AND source = 'human'`, input.contentId, key);
        } else {
          setAttribute(db, input.contentId, key, value, 'human', 1);
        }
        changed.push(key);
      }
    }

    const aiRun = get<{ id: number }>(db, `SELECT ai_run_id AS id FROM content_attributes WHERE content_id = ? AND source = 'ai' AND ai_run_id IS NOT NULL ORDER BY id DESC LIMIT 1`, input.contentId);
    run(
      db,
      'INSERT INTO coding_reviews (content_id, status, note, changed_json, ai_run_id) VALUES (?, ?, ?, ?, ?)',
      input.contentId,
      input.status,
      input.note ?? null,
      json(changed),
      aiRun?.id ?? null
    );
    run(
      db,
      // A rejected coding goes back in the queue: clearing coded_at re-queues it.
      `UPDATE content SET coding_validation_status = ?, coding_reviewed_at = ?, coded_at = CASE WHEN ? THEN NULL ELSE coded_at END WHERE id = ?`,
      input.status,
      nowIso(),
      input.status === 'REJECTED' ? 1 : 0,
      input.contentId
    );
    return { changed };
  });
}

/** Which attributes the AI gets right, measured only on reviewed posts. */
export function codingAccuracy(db: Db) {
  const reviewed = all<{ content_id: number }>(db, `SELECT DISTINCT content_id FROM coding_reviews WHERE status IN ('APPROVED','EDITED')`).map((r) => r.content_id);
  if (!reviewed.length) return { reviewed: 0, attributes: [] as Array<{ key: string; aiCoded: number; corrected: number; agreement: number | null }> };
  const ids = reviewed.join(',');
  const aiCounts = new Map(
    all<{ key: string; n: number }>(db, `SELECT key, COUNT(*) n FROM content_attributes WHERE source = 'ai' AND content_id IN (${ids}) GROUP BY key`).map((r) => [r.key, r.n])
  );
  const corrections = new Map(all<{ key: string; n: number }>(db, `SELECT key, COUNT(*) n FROM attribute_corrections WHERE content_id IN (${ids}) GROUP BY key`).map((r) => [r.key, r.n]));
  const keys = [...new Set([...aiCounts.keys(), ...corrections.keys()])].filter((k) => REVIEW_KEYS.includes(k as (typeof REVIEW_KEYS)[number]));
  return {
    reviewed: reviewed.length,
    attributes: keys
      .map((key) => {
        const aiCoded = aiCounts.get(key) ?? 0;
        const corrected = corrections.get(key) ?? 0;
        return { key, aiCoded, corrected, agreement: aiCoded ? 1 - corrected / aiCoded : null };
      })
      .sort((a, b) => (a.agreement ?? 1) - (b.agreement ?? 1)),
  };
}

/** Agreement with human review, per provider/model and attribute — the dataset that picks coding models. */
export function accuracyByModel(db: Db): Array<{ model: string; key: string; reviewed: number; agreed: number; agreement: number }> {
  return all<{ model: string; key: string; reviewed: number; agreed: number }>(
    db,
    `SELECT COALESCE(ai_provider, '?') || '/' || COALESCE(ai_model, '?') AS model, key, COUNT(*) AS reviewed, SUM(agreed) AS agreed
     FROM coding_agreement GROUP BY model, key HAVING COUNT(*) > 0 ORDER BY model, key`
  ).map((r) => ({ ...r, agreement: r.reviewed ? r.agreed / r.reviewed : 0 }));
}

/** "How much of BBO's historical content does BBO BRAIN actually understand?" */
export function coverageStats(db: Db) {
  const total = get<{ n: number }>(db, `SELECT COUNT(*) n FROM content WHERE status = 'published' AND is_demo = 0`)!.n;
  const one = (sql: string, ...params: unknown[]) => get<{ n: number }>(db, sql, ...params)!.n;
  const attr = (key: string) => one(`SELECT COUNT(*) n FROM content_attribute_current WHERE key = ?`, key);
  const attrBySource = (key: string, source: string) => one(`SELECT COUNT(*) n FROM content_attributes WHERE key = ? AND source = ?`, key, source);
  return {
    total,
    mediaAnalyzed: one('SELECT COUNT(*) n FROM content WHERE media_fetched_at IS NOT NULL'),
    transcripts: one('SELECT COUNT(DISTINCT content_id) n FROM transcripts'),
    coded: one('SELECT COUNT(*) n FROM content WHERE coded_at IS NOT NULL'),
    analysed: one('SELECT COUNT(DISTINCT content_id) n FROM content_analyses'),
    humanValidated: one(`SELECT COUNT(*) n FROM content WHERE coding_validation_status IN ('APPROVED','EDITED')`),
    rejected: one(`SELECT COUNT(*) n FROM content WHERE coding_validation_status = 'REJECTED'`),
    unreviewed: one(`SELECT COUNT(*) n FROM content WHERE coded_at IS NOT NULL AND coding_validation_status = 'UNREVIEWED'`),
    fields: [
      { key: 'hook_type', label: 'Hook type', coded: attr('hook_type'), ai: attrBySource('hook_type', 'ai'), human: attrBySource('hook_type', 'human') },
      { key: 'opening_type', label: 'Opening type', coded: attr('opening_type'), ai: attrBySource('opening_type', 'ai'), human: attrBySource('opening_type', 'human') },
      { key: 'tension_type', label: 'Tension type', coded: attr('tension_type'), ai: attrBySource('tension_type', 'ai'), human: attrBySource('tension_type', 'human') },
      { key: 'reaction_timing', label: 'Reaction data', coded: attr('reaction_timing'), ai: attrBySource('reaction_timing', 'ai'), human: attrBySource('reaction_timing', 'human') },
      { key: 'time_to_tension_bucket', label: 'Time to tension', coded: attr('time_to_tension_bucket'), ai: attrBySource('time_to_tension_bucket', 'ai'), human: attrBySource('time_to_tension_bucket', 'human') },
      { key: 'time_to_payoff_bucket', label: 'Time to payoff', coded: attr('time_to_payoff_bucket'), ai: attrBySource('time_to_payoff_bucket', 'ai'), human: attrBySource('time_to_payoff_bucket', 'human') },
      { key: 'dead_setup_bucket', label: 'Dead setup', coded: attr('dead_setup_bucket'), ai: attrBySource('dead_setup_bucket', 'ai'), human: attrBySource('dead_setup_bucket', 'human') },
      { key: 'caption_type', label: 'Caption type', coded: attr('caption_type'), ai: attrBySource('caption_type', 'ai'), human: attrBySource('caption_type', 'human') },
      { key: 'cta_type', label: 'CTA type', coded: attr('cta_type'), ai: attrBySource('cta_type', 'ai'), human: attrBySource('cta_type', 'human') },
      { key: 'duration_bucket', label: 'Duration', coded: attr('duration_bucket'), ai: attrBySource('duration_bucket', 'ai'), human: attrBySource('duration_bucket', 'human') },
      { key: 'franchise', label: 'Franchise', coded: attr('franchise'), ai: attrBySource('franchise', 'ai'), human: attrBySource('franchise', 'human') },
    ],
    topicsCoded: one('SELECT COUNT(DISTINCT content_id) n FROM content_topics'),
    topicsAi: one(`SELECT COUNT(DISTINCT content_id) n FROM content_topics WHERE source = 'ai'`),
  };
}

import { all, get, json, nowIso, run, tx, type Db } from '@/lib/db/client';
import { getSetting, setSetting } from '@/lib/seed';
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
  'content_bucket',
  'interview_format',
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
  // Only buckets BBO analyses are worth a human's review time.
  const ignored = new Set(all<{ content_id: number }>(db, `SELECT content_id FROM content_attribute_current WHERE key = 'content_bucket' AND value_text IN ('BADDIE_OF_THE_MONTH','OTHER_IGNORE')`).map((r) => r.content_id));
  const rows = codedRows(db, { status: 'UNREVIEWED' })
    .filter((r) => !ignored.has(r.contentId))
    .sort((a, b) => Number(disputed.has(b.contentId)) - Number(disputed.has(a.contentId)));
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
  const hookCount = new Map<string, number>();
  const hooks = new Map(all<{ content_id: number; value_text: string }>(db, `SELECT content_id, value_text FROM content_attribute_current WHERE key = 'hook_type'`).map((r) => [r.content_id, r.value_text]));
  const franchiseCap = Math.max(2, Math.ceil(size * 0.35));
  const topicCap = Math.max(2, Math.ceil(size * 0.3));
  const hookCap = Math.max(2, Math.ceil(size * 0.3));

  const pass = (relaxed: boolean, allowUnscored = true) => {
    for (const row of rows) {
      if (picked.length >= size) return;
      if (picked.some((p) => p.contentId === row.contentId)) continue;
      if (!relaxed && quota[row.corpusClass] <= 0) continue;
      if (!allowUnscored && row.corpusClass === 'other') continue;
      const f = row.franchise ?? 'Unclassified';
      if (!relaxed && (franchiseCount.get(f) ?? 0) >= franchiseCap) continue;
      if (!relaxed && row.topics.some((t) => (topicCount.get(t) ?? 0) >= topicCap)) continue;
      const hook = hooks.get(row.contentId) ?? '—';
      if (!relaxed && (hookCount.get(hook) ?? 0) >= hookCap) continue;
      picked.push(row);
      quota[row.corpusClass]--;
      hookCount.set(hook, (hookCount.get(hook) ?? 0) + 1);
      franchiseCount.set(f, (franchiseCount.get(f) ?? 0) + 1);
      for (const t of row.topics) topicCount.set(t, (topicCount.get(t) ?? 0) + 1);
    }
  };
  pass(false);
  pass(true, false); // scored posts first — an unscored post cannot tell us about winners vs losers
  pass(true);
  return picked;
}

export type ReviewInput = {
  contentId: number;
  status: 'APPROVED' | 'EDITED' | 'REJECTED';
  note?: string;
  /** key → corrected value ('' clears a human override). Only used for EDITED. */
  values?: Record<string, string>;
  /** Corrected topic names, first one primary. Only used for EDITED. */
  topics?: string[];
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

    if (input.status === 'EDITED' && input.topics) {
      // Topics live in their own table; the AI's list stays recoverable in ai_runs.output_json.
      const wanted = input.topics.map((t) => t.trim()).filter(Boolean);
      const ids = wanted
        .map((name) => get<{ id: number }>(db, 'SELECT id FROM topics WHERE lower(name) = lower(?) OR lower(slug) = lower(?)', name, name.replace(/\s+/g, '-'))?.id)
        .filter((id): id is number => typeof id === 'number');
      const before = all<{ topic_id: number }>(db, 'SELECT topic_id FROM content_topics WHERE content_id = ? ORDER BY is_primary DESC, topic_id', input.contentId).map((r) => r.topic_id);
      if (ids.length && (ids.length !== before.length || ids.some((id, i) => id !== before[i]))) {
        run(db, 'DELETE FROM content_topics WHERE content_id = ?', input.contentId);
        [...new Set(ids)].forEach((topicId, i) =>
          run(db, `INSERT INTO content_topics (content_id, topic_id, is_primary, source, confidence) VALUES (?, ?, ?, 'human', 1)`, input.contentId, topicId, i === 0 ? 1 : 0)
        );
        changed.push('topics');
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

export type ValidationBatch = { ids: number[]; createdAt: string; size: number };

/**
 * Freezes a stratified sample as the batch a human works through. A rolling
 * sample would swap in a new post every time one is reviewed; a fixed batch
 * has an end, so "25 reviewed" means something.
 */
export function createValidationBatch(db: Db, size = 25): ValidationBatch {
  const batch: ValidationBatch = { ids: validationSample(db, size).map((r) => r.contentId), createdAt: nowIso(), size };
  setSetting(db, 'validation_batch', batch);
  return batch;
}

export function currentValidationBatch(db: Db): { batch: ValidationBatch; rows: CodedRow[]; reviewed: number } | null {
  const batch = getSetting<ValidationBatch | undefined>(db, 'validation_batch');
  if (!batch?.ids?.length) return null;
  const wanted = new Set(batch.ids);
  const byId = new Map(codedRows(db).filter((r) => wanted.has(r.contentId)).map((r) => [r.contentId, r]));
  const rows = batch.ids.map((id) => byId.get(id)).filter((r): r is CodedRow => Boolean(r));
  // A rejected post leaves the coded set (it is re-queued) but still counts as reviewed.
  const reviewed = all<{ id: number }>(db, `SELECT id FROM content WHERE coding_validation_status != 'UNREVIEWED' AND id IN (${batch.ids.map(() => '?').join(',')})`, ...batch.ids).length;
  return { batch, rows, reviewed };
}

export type ValidationReport = {
  reviewed: number;
  batchSize: number;
  batchReviewed: number;
  overall: { compared: number; agreed: number; rate: number | null };
  fields: Array<{ key: string; compared: number; agreed: number; rate: number; confusions: Array<{ from: string; to: string; n: number }> }>;
  topics: { compared: number; agreed: number; rate: number | null };
  byMedia: Array<{ input: 'with media' | 'caption only'; compared: number; agreed: number; rate: number }>;
  byModel: Array<{ model: string; compared: number; agreed: number; rate: number }>;
  unreliable: string[];
};

/**
 * What human review says about the model's content understanding: agreement per
 * field, the confusions behind it, and whether media was available. Fields that
 * fall below the reliability bar stop feeding lesson mining (see unreliableCodedFields).
 */
export function validationReport(db: Db): ValidationReport {
  const rows = all<{ content_id: number; key: string; ai_value: string; human_value: string | null; agreed: number; ai_provider: string | null; ai_model: string | null }>(
    db,
    `SELECT content_id, key, ai_value, human_value, agreed, ai_provider, ai_model FROM coding_agreement WHERE key IN (${REVIEW_KEYS.map(() => '?').join(',')})`,
    ...REVIEW_KEYS
  );
  const media = new Map(
    all<{ id: number; has_media: number }>(
      db,
      `SELECT c.id, (c.thumb_path IS NOT NULL OR EXISTS (SELECT 1 FROM transcripts t WHERE t.content_id = c.id)) AS has_media FROM content c`
    ).map((r) => [r.id, r.has_media === 1])
  );
  const byKey = new Map<string, typeof rows>();
  for (const r of rows) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r]);

  const fields = [...byKey.entries()]
    .map(([key, list]) => {
      const agreed = list.filter((r) => r.agreed === 1).length;
      const confusions = new Map<string, number>();
      for (const r of list) {
        if (r.agreed === 1 || !r.human_value) continue;
        const k = `${r.ai_value}→${r.human_value}`;
        confusions.set(k, (confusions.get(k) ?? 0) + 1);
      }
      return {
        key,
        compared: list.length,
        agreed,
        rate: list.length ? agreed / list.length : 0,
        confusions: [...confusions.entries()]
          .map(([k, n]) => ({ from: k.split('→')[0], to: k.split('→')[1], n }))
          .sort((a, b) => b.n - a.n)
          .slice(0, 3),
      };
    })
    .sort((a, b) => a.rate - b.rate);

  const group = <T extends string>(pick: (r: (typeof rows)[number]) => T | null) => {
    const acc = new Map<T, { compared: number; agreed: number }>();
    for (const r of rows) {
      const k = pick(r);
      if (k === null) continue;
      const cur = acc.get(k) ?? { compared: 0, agreed: 0 };
      acc.set(k, { compared: cur.compared + 1, agreed: cur.agreed + (r.agreed === 1 ? 1 : 0) });
    }
    return [...acc.entries()].map(([k, v]) => ({ key: k, ...v, rate: v.compared ? v.agreed / v.compared : 0 }));
  };

  const reviewedPosts = all<{ n: number }>(db, `SELECT COUNT(DISTINCT content_id) AS n FROM coding_reviews WHERE status IN ('APPROVED','EDITED')`)[0]?.n ?? 0;
  const batch = currentValidationBatch(db);
  const topicRows = all<{ content_id: number; human: number }>(
    db,
    `SELECT ct.content_id, SUM(ct.source = 'human') AS human FROM content_topics ct
     WHERE ct.content_id IN (SELECT DISTINCT content_id FROM coding_reviews WHERE status IN ('APPROVED','EDITED')) GROUP BY ct.content_id`
  );
  return {
    reviewed: reviewedPosts,
    batchSize: batch?.rows.length ?? 0,
    batchReviewed: batch?.reviewed ?? 0,
    overall: { compared: rows.length, agreed: rows.filter((r) => r.agreed === 1).length, rate: rows.length ? rows.filter((r) => r.agreed === 1).length / rows.length : null },
    fields,
    // A reviewed post whose topics a human left alone counts as agreement.
    topics: { compared: topicRows.length, agreed: topicRows.filter((r) => r.human === 0).length, rate: topicRows.length ? topicRows.filter((r) => r.human === 0).length / topicRows.length : null },
    byMedia: group((r) => (media.get(r.content_id) ? 'with media' : 'caption only')).map((g) => ({ input: g.key as 'with media' | 'caption only', compared: g.compared, agreed: g.agreed, rate: g.rate })),
    byModel: group((r) => `${r.ai_provider ?? '?'}/${r.ai_model ?? '?'}`).map((g) => ({ model: g.key, compared: g.compared, agreed: g.agreed, rate: g.rate })),
    unreliable: unreliableCodedFields(db),
  };
}

/**
 * Fields human review has shown the model gets wrong too often to mine on.
 * Needs a real sample before it judges anything: below MIN_REVIEWS a field is
 * neither trusted nor distrusted on this basis.
 */
export const RELIABILITY_MIN_REVIEWS = 10;
export const RELIABILITY_MIN_AGREEMENT = 0.6;

export function unreliableCodedFields(db: Db): string[] {
  return all<{ key: string; n: number; agreed: number }>(
    db,
    `SELECT key, COUNT(*) AS n, SUM(agreed) AS agreed FROM coding_agreement WHERE key IN (${REVIEW_KEYS.map(() => '?').join(',')}) GROUP BY key`,
    ...REVIEW_KEYS
  )
    .filter((r) => r.n >= RELIABILITY_MIN_REVIEWS && r.agreed / r.n < RELIABILITY_MIN_AGREEMENT)
    .map((r) => r.key);
}

const vpct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);

/** The model-quality dataset, written down: what human review says the AI understands. */
export function renderValidationReport(r: ValidationReport): string {
  const lines: string[] = [];
  lines.push('# BBO BRAIN coding validation', '', `${r.reviewed} posts reviewed (batch ${r.batchReviewed}/${r.batchSize}) · ${r.overall.compared} labels compared`, '');
  lines.push(`**Overall agreement: ${vpct(r.overall.rate)}** (${r.overall.agreed}/${r.overall.compared} labels).`, '');
  const field = (key: string) => r.fields.find((f) => f.key === key);
  lines.push('| Headline | Agreement | Compared |', '|---|---|---|');
  for (const key of ['hook_type', 'opening_type']) {
    const f = field(key);
    lines.push(`| ${key.replace(/_/g, ' ')} | ${f ? vpct(f.rate) : '—'} | ${f?.compared ?? 0} |`);
  }
  lines.push(`| topics | ${vpct(r.topics.rate)} | ${r.topics.compared} |`, '');
  lines.push('## Every field, worst first', '', '| Field | Agreement | Compared | Most common confusions (AI → human) |', '|---|---|---|---|');
  for (const f of r.fields) {
    lines.push(`| ${f.key.replace(/_/g, ' ')} | ${vpct(f.rate)} | ${f.compared} | ${f.confusions.map((c) => `${c.from} → ${c.to} (${c.n})`).join('; ') || '—'} |`);
  }
  lines.push('');
  if (r.byMedia.length) {
    lines.push('## Accuracy by what the model could see', '', '| Input | Agreement | Compared |', '|---|---|---|');
    for (const m of r.byMedia) lines.push(`| ${m.input} | ${vpct(m.rate)} | ${m.compared} |`);
    lines.push('');
  }
  if (r.byModel.length) {
    lines.push('## Accuracy by model', '', '| Model | Agreement | Compared |', '|---|---|---|');
    for (const m of r.byModel) lines.push(`| ${m.model} | ${vpct(m.rate)} | ${m.compared} |`);
    lines.push('');
  }
  lines.push(
    r.unreliable.length
      ? `**Excluded from lesson mining:** ${r.unreliable.join(', ')} — below ${Math.round(RELIABILITY_MIN_AGREEMENT * 100)}% agreement on ${RELIABILITY_MIN_REVIEWS}+ reviews.`
      : `No field is below ${Math.round(RELIABILITY_MIN_AGREEMENT * 100)}% agreement on ${RELIABILITY_MIN_REVIEWS}+ reviews, so none is excluded from lesson mining.`,
    ''
  );
  return lines.join('\n');
}

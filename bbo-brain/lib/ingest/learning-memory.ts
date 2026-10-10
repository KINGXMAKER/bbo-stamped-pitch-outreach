import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { get, json, run, tx, type Db } from '@/lib/db/client';
import type { ConfidenceLabel } from '@/lib/intel/stats';

/**
 * Imports BBO's existing learnings (bbo_content_learning_memory.json, written by
 * the weekly audits 2026-08-08 → 2026-09-15) as first-class lessons with their
 * real belief history, plus the "next_test" of each as a proposed experiment.
 *
 * Status and confidence are translated conservatively: an audit's "medium" on
 * n=4 does not become MODERATE_SIGNAL here, because this system caps confidence
 * by sample size. The audit's own wording is kept verbatim in `evidence`.
 */

type Memory = {
  learnings: Array<Record<string, unknown> & { id: string; pattern: string; sample_size?: number; confidence?: string; date_range?: string }>;
  rejected_or_weakened: Array<{ id: string; claim: string; status: string; evidence: string; revised_view?: string }>;
};

export function defaultLearningMemoryPath(repoRoot = path.resolve(process.cwd(), '..')): string | null {
  const p = path.join(repoRoot, 'bbo_content_learning_memory.json');
  return existsSync(p) ? p : null;
}

export function confidenceFromAudit(text: string | undefined, sampleSize: number | undefined): ConfidenceLabel {
  const n = sampleSize ?? 0;
  if (n < 5) return 'INSUFFICIENT_DATA';
  const t = (text ?? '').toLowerCase();
  let label: ConfidenceLabel = t.startsWith('low') ? 'EARLY_SIGNAL' : t.startsWith('high') ? 'STRONG_SIGNAL' : t.startsWith('medium') ? 'MODERATE_SIGNAL' : 'EARLY_SIGNAL';
  if (label === 'STRONG_SIGNAL' && n < 15) label = 'MODERATE_SIGNAL';
  if (label === 'MODERATE_SIGNAL' && n < 8) label = 'EARLY_SIGNAL';
  return label;
}

type LessonSpec = {
  status: 'NEW' | 'OBSERVING' | 'SUPPORTED' | 'WEAKENED' | 'CONTRADICTED' | 'ARCHIVED';
  category: string;
  direction: 'positive' | 'negative' | 'mixed';
  /** Re-evaluable definition so the mining engine can keep testing the audit's claim. */
  pattern?: { key: string; group: string; compare?: string; metric: string };
  experiment?: { name: string; variable_key: string | null; control: string | null; variant: string | null; metric: string; topic?: string };
  updateNote?: string;
  /** The audit said the association is probably confounded — data may weaken it, never promote it. */
  confounded?: boolean;
};

const SPECS: Record<string, LessonSpec> = {
  L001: { status: 'SUPPORTED', category: 'topic', direction: 'positive', pattern: { key: 'audit_lane', group: 'sex_explicit', metric: 'share_rel' },
    experiment: { name: 'Woman-directed decision question vs pure shock admission (explicit frame)', variable_key: null, control: 'pure shock admission', variant: 'woman-directed decision question', metric: 'share_rel' } },
  L002: { status: 'OBSERVING', category: 'duration', direction: 'positive', pattern: { key: 'duration_bucket', group: '16-30s', metric: 'deep_action_rel' },
    experiment: { name: '25s dense cut vs 50s full cut of the same interview', variable_key: 'duration_bucket', control: '46-60s', variant: '16-30s', metric: 'deep_action_rel' } },
  L003: { status: 'OBSERVING', category: 'format', direction: 'mixed', pattern: { key: 'audit_lane', group: 'bbo_stamped_venue', metric: 'deep_action_rel' },
    experiment: { name: 'BBO Stamped "does it match the hype?" verdict vs standard recap', variable_key: null, control: 'endorsement recap', variant: 'verdict question', metric: 'share_rel' } },
  L004: { status: 'SUPPORTED', category: 'topic', direction: 'negative', pattern: { key: 'audit_lane', group: 'creator_business', metric: 'deep_action_rel' },
    experiment: { name: 'Business lesson reframed as a contrarian claim with a decision CTA', variable_key: 'hook_type', control: 'other', variant: 'contrarian_claim', metric: 'deep_action_rel' } },
  L005: { status: 'OBSERVING', category: 'cta', direction: 'positive', pattern: { key: 'cta_type', group: 'comment_specific', compare: 'none', metric: 'deep_action_rel' },
    experiment: { name: 'Specific decision CTA on five consecutive posts vs no-CTA cohort', variable_key: 'cta_type', control: 'none', variant: 'comment_specific', metric: 'deep_action_rel' } },
  L006: { status: 'WEAKENED', category: 'other', direction: 'mixed', updateNote: 'Save rate reversed from +22.4% to −25.0% vs baseline in the 2026-09-15 cycle.' },
  L007: { status: 'OBSERVING', category: 'packaging', direction: 'negative', confounded: true, pattern: { key: 'has_guest_tag', group: 'true', compare: 'false', metric: 'deep_action_rel' },
    experiment: { name: 'Guest-tagged vs untagged captions within relationship content only', variable_key: 'has_guest_tag', control: 'false', variant: 'true', metric: 'deep_action_rel', topic: 'relationships' } },
  L008: { status: 'OBSERVING', category: 'topic', direction: 'negative',
    experiment: { name: 'Catfish premise recut with higher personal stakes vs retire the premise', variable_key: null, control: 'original framing', variant: 'higher personal stakes', metric: 'deep_action_rel' } },
  L009: { status: 'NEW', category: 'captions', direction: 'positive', confounded: true, pattern: { key: 'caption_type', group: 'question', compare: 'claim_statement', metric: 'deep_action_rel' },
    experiment: { name: 'Same topic, caption opening question vs statement', variable_key: 'caption_type', control: 'claim_statement', variant: 'question', metric: 'deep_action_rel' } },
};

const REJECTED_STATUS: Record<string, 'WEAKENED' | 'CONTRADICTED' | 'ARCHIVED'> = {
  WEAKENED: 'WEAKENED',
  'REJECTED AS STATED': 'CONTRADICTED',
  REJECTED: 'ARCHIVED',
};

export function importLearningMemory(db: Db, file: string): { lessons: number; experiments: number; events: number } {
  const memory = JSON.parse(readFileSync(file, 'utf8')) as Memory;
  const out = { lessons: 0, experiments: 0, events: 0 };

  tx(db, () => {
    for (const l of memory.learnings) {
      const code = `A-${l.id}`;
      if (get(db, 'SELECT 1 FROM lessons WHERE code = ?', code)) continue;
      const spec = SPECS[l.id] ?? { status: 'OBSERVING', category: 'other', direction: 'mixed' };
      const reconfirmed = l.reconfirmed_2026_09_15 as { sample_size_added?: number; status?: string; note?: string } | undefined;
      const totalN = (l.sample_size ?? 0) + (reconfirmed?.sample_size_added ?? 0);
      const initialConfidence = confidenceFromAudit(l.confidence, l.sample_size);
      const currentConfidence = confidenceFromAudit(
        reconfirmed?.status?.match(/raised .* -> ([a-z-]+)/)?.[1] ?? l.confidence,
        totalN
      );
      const evidence = [
        l.vs_baseline,
        l.refined_hypothesis,
        Array.isArray(l.counterexamples) ? `Counterexamples: ${(l.counterexamples as string[]).join(' | ')}` : null,
        reconfirmed?.note ? `2026-09-15: ${reconfirmed.note}` : null,
        typeof l.status_2026_09_15 === 'string' ? `2026-09-15: ${l.status_2026_09_15}` : null,
        spec.updateNote ? `2026-09-15: ${spec.updateNote}` : null,
      ]
        .filter(Boolean)
        .join('\n\n');

      const { lastId } = run(
        db,
        `INSERT INTO lessons (code, text, category, status, confidence_label, origin, pattern_json, direction, comparison_group,
           sample_size, metrics_json, evidence, caveat, next_test, first_seen_at, last_evaluated_at)
         VALUES (?, ?, ?, ?, ?, 'imported_audit', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        code,
        l.pattern,
        spec.category,
        spec.status,
        currentConfidence,
        null, // imported audit claims keep their own wording; mining creates its own pattern lessons
        spec.direction,
        l.date_range ? `90-day audit baseline (${l.date_range})` : 'weekly audit cycle',
        totalN || null,
        json({
          median_outcomes: l.median_outcomes ?? l.median_outcomes_by_bucket ?? l.outcome ?? null,
          pattern: spec.pattern ?? null,
          windowStart: l.date_range?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null,
          confounded: spec.confounded ?? false,
        }),
        evidence,
        (l.brand_caveat as string) ?? (l.note as string) ?? null,
        (l.next_test as string) ?? null,
        '2026-08-08T12:00:00.000Z',
        '2026-09-15T12:00:00.000Z'
      );
      out.lessons++;

      run(
        db,
        `INSERT INTO lesson_events (lesson_id, from_status, to_status, from_confidence, to_confidence, sample_size, note, occurred_at)
         VALUES (?, NULL, ?, NULL, ?, ?, ?, '2026-08-08T12:00:00.000Z')`,
        lastId,
        l.id === 'L009' ? 'NEW' : 'OBSERVING',
        initialConfidence,
        l.sample_size ?? null,
        'Recorded by the V2 weekly audit (imported).'
      );
      out.events++;
      const changed = spec.status !== (l.id === 'L009' ? 'NEW' : 'OBSERVING') || currentConfidence !== initialConfidence;
      if (changed) {
        run(
          db,
          `INSERT INTO lesson_events (lesson_id, from_status, to_status, from_confidence, to_confidence, sample_size, note, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, '2026-09-15T12:00:00.000Z')`,
          lastId,
          l.id === 'L009' ? 'NEW' : 'OBSERVING',
          spec.status,
          initialConfidence,
          currentConfidence,
          totalN || null,
          reconfirmed?.status ?? spec.updateNote ?? (typeof l.status_2026_09_15 === 'string' ? l.status_2026_09_15.slice(0, 200) : 'Updated by the 2026-09-15 audit (imported).')
        );
        out.events++;
      }

      if (spec.experiment) {
        const expCode = `X-${l.id}`;
        if (!get(db, 'SELECT 1 FROM experiments WHERE code = ?', expCode)) {
          const topic = spec.experiment.topic ? get<{ id: number }>(db, 'SELECT id FROM topics WHERE slug = ?', spec.experiment.topic) : undefined;
          const { lastId: expId } = run(
            db,
            `INSERT INTO experiments (code, name, hypothesis, variable_key, control_value, variant_value, primary_metric,
               secondary_metrics_json, platform_id, topic_id, status, origin, lesson_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'instagram', ?, 'proposed', 'imported_audit', ?)`,
            expCode,
            spec.experiment.name,
            (l.next_test as string) ?? l.pattern,
            spec.experiment.variable_key,
            spec.experiment.control,
            spec.experiment.variant,
            spec.experiment.metric,
            json(['performance_score', 'share_rate', 'save_rate', 'comment_rate']),
            topic?.id ?? null,
            lastId
          );
          run(db, 'UPDATE lessons SET related_experiment_id = ? WHERE id = ?', expId, lastId);
          out.experiments++;
        }
      }
    }

    for (const r of memory.rejected_or_weakened) {
      const code = `A-${r.id}`;
      if (get(db, 'SELECT 1 FROM lessons WHERE code = ?', code)) continue;
      const status = REJECTED_STATUS[r.status] ?? 'WEAKENED';
      const { lastId } = run(
        db,
        `INSERT INTO lessons (code, text, category, status, confidence_label, origin, direction, evidence, caveat, first_seen_at, last_evaluated_at)
         VALUES (?, ?, 'other', ?, 'MODERATE_SIGNAL', 'imported_audit', 'mixed', ?, ?, '2026-08-01T12:00:00.000Z', '2026-08-08T12:00:00.000Z')`,
        code,
        r.claim,
        status,
        r.evidence,
        r.revised_view ?? null
      );
      run(
        db,
        `INSERT INTO lesson_events (lesson_id, from_status, to_status, from_confidence, to_confidence, note, occurred_at)
         VALUES (?, NULL, 'SUPPORTED', NULL, 'EARLY_SIGNAL', 'Asserted by the V1 audit (imported).', '2026-08-01T12:00:00.000Z'),
                (?, 'SUPPORTED', ?, 'EARLY_SIGNAL', 'MODERATE_SIGNAL', ?, '2026-08-08T12:00:00.000Z')`,
        lastId,
        lastId,
        status,
        (r.revised_view ?? r.evidence).slice(0, 300)
      );
      out.lessons++;
      out.events += 2;
    }
  });

  return out;
}

import { all, get, json, nowIso, parseJson, run, tx, type Db } from '@/lib/db/client';
import { comparable, loadFacts, type ContentFact } from './dataset';
import { loadLabels, valueLabel } from './patterns';
import { compareGroups, CONFIDENCE_ORDER, median, type ConfidenceLabel, type Observation } from './stats';

export type Recommendation = {
  format: string | null;
  hookStyle: string | null;
  lengthRange: string | null;
  captionDirection: string | null;
  nextContent: string;
};

export type Opportunity = {
  kind: 'topic_momentum' | 'topic_revival' | 'format_transfer' | 'guest_revisit' | 'duration_sweet_spot' | 'hook_pattern' | 'experiment_needed';
  title: string;
  why: string;
  supporting: Array<{ contentId: number; title: string; score: number | null }>;
  sampleSize: number;
  confidence: ConfidenceLabel;
  recommendation: Recommendation;
  experiment: { name: string; hypothesis: string } | null;
  priority: number;
};

const DAY = 86_400_000;
const obs = (facts: ContentFact[]): Observation[] => facts.map((f) => ({ value: f.score as number, at: f.publishedAt, contentId: f.contentId }));
const confWeight = (c: ConfidenceLabel) => [0.25, 0.6, 0.85, 1][CONFIDENCE_ORDER.indexOf(c)];

function mode(values: Array<string | undefined | null>): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}

/** The winning packaging inside a set of posts: most common value among its above-median posts. */
function packagingFrom(db: Db, facts: ContentFact[], all_: ContentFact[]): Omit<Recommendation, 'nextContent'> {
  const labels = loadLabels(db);
  const med = median(facts.map((f) => f.score as number)) ?? 1;
  const winners = facts.filter((f) => (f.score ?? 0) >= Math.max(med, 1));
  const pick = (key: string, pool: ContentFact[]) => {
    const v = mode(pool.map((f) => f.attrs[key]));
    return v ? valueLabel(labels, key, v) : null;
  };
  const bestDuration = (() => {
    const buckets = new Map<string, number[]>();
    for (const f of all_) if (f.attrs.duration_bucket) buckets.set(f.attrs.duration_bucket, [...(buckets.get(f.attrs.duration_bucket) ?? []), f.score as number]);
    return [...buckets.entries()].filter(([, s]) => s.length >= 5).sort((a, b) => (median(b[1]) ?? 0) - (median(a[1]) ?? 0))[0]?.[0] ?? null;
  })();
  return {
    format: mode(winners.map((f) => f.franchiseName)) ?? mode(facts.map((f) => f.franchiseName)),
    hookStyle: pick('hook_type', winners),
    lengthRange: pick('duration_bucket', winners) ?? bestDuration,
    captionDirection: [pick('caption_type', winners), pick('cta_type', winners)].filter(Boolean).join(' + ') || null,
  };
}

const top = (facts: ContentFact[], n = 3) =>
  [...facts].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, n).map((f) => ({ contentId: f.contentId, title: f.title, score: f.score }));

export function computeOpportunities(db: Db, now = new Date()): Opportunity[] {
  const facts = comparable(loadFacts(db));
  if (facts.length < 10) return [];
  const labels = loadLabels(db);
  const out: Opportunity[] = [];
  const t30 = new Date(now.getTime() - 30 * DAY).toISOString();
  const t14 = new Date(now.getTime() - 14 * DAY).toISOString();
  const t90 = new Date(now.getTime() - 90 * DAY).toISOString();

  // Topics: momentum and revival.
  const topics = new Map<string, { name: string; facts: ContentFact[] }>();
  for (const f of facts) for (const t of f.topics) topics.set(t.slug, { name: t.name, facts: [...(topics.get(t.slug)?.facts ?? []), f] });
  for (const [slug, { name, facts: tf }] of topics) {
    if (tf.length < 5) continue;
    const rest = facts.filter((f) => !f.topics.some((t) => t.slug === slug));
    const c = compareGroups(obs(tf), obs(rest), { asOf: now.toISOString() });
    if (c.verdict !== 'positive') continue;
    const last = tf.map((f) => f.publishedAt).sort().pop()!;
    const recent14 = tf.filter((f) => f.publishedAt >= t14).length;
    const pkg = packagingFrom(db, tf, facts);
    const shareRel = median(tf.map((f) => f.rates.share_rel).filter((v): v is number => typeof v === 'number'));
    const shareLine = shareRel ? ` Median share rate ${shareRel.toFixed(1)}x comparable posts.` : '';
    if (last < t30) {
      out.push({
        kind: 'topic_revival',
        title: `Bring back ${name}`,
        why: `${name} content scores ${c.effect!.toFixed(2)}x other posts (median across ${c.nGroup} vs ${c.nRest}) and hasn't been used since ${last.slice(0, 10)}.${shareLine}`,
        supporting: top(tf),
        sampleSize: c.nGroup,
        confidence: c.confidence,
        recommendation: { ...pkg, nextContent: `A ${pkg.format ?? 'short-form'} post on ${name}${pkg.hookStyle ? ` opening on a ${pkg.hookStyle}` : ''}.` },
        experiment: null,
        priority: c.effect! * confWeight(c.confidence) * 1.2,
      });
    } else {
      const saturation = recent14 >= 4 ? 0.6 : 1;
      out.push({
        kind: 'topic_momentum',
        title: `${name} is working — keep it in rotation${recent14 >= 4 ? ' (watch saturation)' : ''}`,
        why: `${name} scores ${c.effect!.toFixed(2)}x other posts across ${c.nGroup} vs ${c.nRest}; used ${recent14} time(s) in the last 14 days.${shareLine}`,
        supporting: top(tf),
        sampleSize: c.nGroup,
        confidence: c.confidence,
        recommendation: { ...pkg, nextContent: `Another ${name} angle with a new debate, not a repeat of ${top(tf, 1)[0]?.title ?? 'the last winner'}.` },
        experiment: null,
        priority: c.effect! * confWeight(c.confidence) * saturation,
      });
    }

    // Format transfer: strong in one franchise, absent from another active franchise.
    const byFranchise = new Map<string, ContentFact[]>();
    for (const f of tf) if (f.franchise) byFranchise.set(f.franchise, [...(byFranchise.get(f.franchise) ?? []), f]);
    const activeFranchises = new Set(facts.filter((f) => f.publishedAt >= t90 && f.franchise).map((f) => f.franchise!));
    for (const [from, ff] of byFranchise) {
      if (ff.length < 3 || (median(ff.map((f) => f.score as number)) ?? 0) < 1.2) continue;
      for (const to of activeFranchises) {
        if (to === from || byFranchise.has(to)) continue;
        const toCount = facts.filter((f) => f.franchise === to && f.publishedAt >= t90).length;
        if (toCount < 3) continue;
        out.push({
          kind: 'format_transfer',
          title: `Take ${name} from ${valueLabel(labels, 'franchise', from)} into ${valueLabel(labels, 'franchise', to)}`,
          why: `${name} in ${valueLabel(labels, 'franchise', from)} has a median score of ${median(ff.map((f) => f.score as number))!.toFixed(2)} across ${ff.length} posts, and ${valueLabel(labels, 'franchise', to)} (${toCount} posts in 90 days) has never covered it.`,
          supporting: top(ff),
          sampleSize: ff.length,
          confidence: ff.length >= 8 ? 'MODERATE_SIGNAL' : 'EARLY_SIGNAL',
          recommendation: { ...packagingFrom(db, ff, facts), format: valueLabel(labels, 'franchise', to), nextContent: `A ${valueLabel(labels, 'franchise', to)} episode built around the ${name} debate.` },
          experiment: { name: `${name}: ${valueLabel(labels, 'franchise', to)} vs ${valueLabel(labels, 'franchise', from)}`, hypothesis: `The ${name} topic transfers to ${valueLabel(labels, 'franchise', to)} without losing performance.` },
          priority: 0.9 * (ff.length >= 8 ? 0.85 : 0.6),
        });
      }
    }
  }

  // Guests worth bringing back.
  const guests = new Map<number, { name: string; facts: ContentFact[] }>();
  for (const f of facts) for (const p of f.people.filter((x) => x.role === 'guest')) guests.set(p.id, { name: p.name, facts: [...(guests.get(p.id)?.facts ?? []), f] });
  for (const [, { name, facts: gf }] of guests) {
    if (gf.length < 2) continue;
    const med = median(gf.map((f) => f.score as number))!;
    const last = gf.map((f) => f.publishedAt).sort().pop()!;
    if (med < 1.2 || last >= t30) continue;
    const shares = median(gf.map((f) => f.rates.share_rel).filter((v): v is number => typeof v === 'number'));
    out.push({
      kind: 'guest_revisit',
      title: `Bring ${name} back`,
      why: `Content featuring ${name} has a median score of ${med.toFixed(2)} across ${gf.length} appearances${shares ? `, median share rate ${shares.toFixed(1)}x comparable posts` : ''}; last appearance ${last.slice(0, 10)}.`,
      supporting: top(gf),
      sampleSize: gf.length,
      confidence: gf.length >= 5 ? 'MODERATE_SIGNAL' : gf.length >= 3 ? 'EARLY_SIGNAL' : 'INSUFFICIENT_DATA',
      recommendation: { ...packagingFrom(db, gf, facts), nextContent: `Book ${name} for a topic from their strongest appearance.` },
      experiment: null,
      priority: med * (gf.length >= 3 ? 0.6 : 0.3),
    });
  }

  // Duration and hook patterns from comparisons.
  for (const key of ['duration_bucket', 'hook_type', 'caption_type', 'cta_type'] as const) {
    const values = new Set(facts.map((f) => f.attrs[key]).filter(Boolean));
    for (const value of values) {
      const group = facts.filter((f) => f.attrs[key] === value);
      const rest = facts.filter((f) => f.attrs[key] !== undefined && f.attrs[key] !== value);
      if (group.length < 5 || rest.length < 5) continue;
      const c = compareGroups(obs(group), obs(rest), { asOf: now.toISOString() });
      if (c.verdict !== 'positive' || CONFIDENCE_ORDER.indexOf(c.confidence) < 1) continue;
      const label = labels.attr.get(key) ?? key;
      const shown = valueLabel(labels, key, value!);
      out.push({
        kind: key === 'duration_bucket' ? 'duration_sweet_spot' : 'hook_pattern',
        title: key === 'duration_bucket' ? `Cut to ${shown}` : `Use more ${label.toLowerCase()}: ${shown}`,
        why: `${label} = ${shown} is associated with ${c.effect!.toFixed(2)}x the performance score of other posts (${c.nGroup} vs ${c.nRest}).`,
        supporting: top(group),
        sampleSize: c.nGroup,
        confidence: c.confidence,
        recommendation: { ...packagingFrom(db, group, facts), nextContent: key === 'duration_bucket' ? `Edit the next podcast clips into the ${shown} range.` : `Package the next posts with ${label.toLowerCase()} "${shown}".` },
        experiment: c.confidence === 'EARLY_SIGNAL' ? { name: `${label}: ${shown} vs other`, hypothesis: `${shown} outperforms because of the ${label.toLowerCase()}, not the topic.` } : null,
        priority: c.effect! * confWeight(c.confidence) * 0.8,
      });
    }
  }

  // Running experiments that need posts.
  for (const e of all<{ id: number; code: string; name: string; variant_value: string | null; control_value: string | null; min_sample_per_arm: number; variable_key: string | null }>(db, `SELECT * FROM experiments WHERE status = 'running'`)) {
    const arms = all<{ arm: string; n: number }>(db, 'SELECT arm, COUNT(*) AS n FROM experiment_content WHERE experiment_id = ? GROUP BY arm', e.id);
    const variantN = arms.find((a) => a.arm === 'variant')?.n ?? 0;
    const controlN = arms.find((a) => a.arm === 'control')?.n ?? 0;
    const need = variantN < e.min_sample_per_arm ? 'variant' : controlN < e.min_sample_per_arm ? 'control' : null;
    if (!need) continue;
    const value = need === 'variant' ? e.variant_value : e.control_value;
    out.push({
      kind: 'experiment_needed',
      title: `Make one more ${need} post for ${e.code}`,
      why: `${e.name} has ${variantN} variant / ${controlN} control posts and needs ${e.min_sample_per_arm} each to read a result.`,
      supporting: [],
      sampleSize: variantN + controlN,
      confidence: 'INSUFFICIENT_DATA',
      recommendation: { format: null, hookStyle: null, lengthRange: null, captionDirection: null, nextContent: `Publish a post with ${e.variable_key?.replace(/_/g, ' ') ?? 'the tested variable'} = ${value?.replace(/_/g, ' ') ?? need}.` },
      experiment: { name: e.name, hypothesis: `Filling the ${need} arm of ${e.code}.` },
      priority: 0.7,
    });
  }

  return out.sort((a, b) => b.priority - a.priority);
}

/** Persists a new batch. Dismissed ideas stay dismissed across batches. */
export function generateOpportunities(db: Db, now = new Date()): { batchId: string; count: number } {
  const opportunities = computeOpportunities(db, now);
  const batchId = nowIso();
  const dismissed = new Set(all<{ kind: string; title: string }>(db, `SELECT kind, title FROM content_opportunities WHERE status = 'dismissed'`).map((d) => `${d.kind}|${d.title}`));
  tx(db, () => {
    for (const o of opportunities) {
      run(
        db,
        `INSERT INTO content_opportunities (batch_id, kind, title, why, supporting_json, sample_size, confidence_label, recommendation_json, experiment_json, priority, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        batchId,
        o.kind,
        o.title,
        o.why,
        json(o.supporting),
        o.sampleSize,
        o.confidence,
        json(o.recommendation),
        o.experiment ? json(o.experiment) : null,
        o.priority,
        dismissed.has(`${o.kind}|${o.title}`) ? 'dismissed' : 'open'
      );
    }
  });
  return { batchId, count: opportunities.length };
}

export function latestOpportunities(db: Db, includeDismissed = false) {
  const batch = get<{ batch_id: string }>(db, 'SELECT batch_id FROM content_opportunities ORDER BY id DESC LIMIT 1');
  if (!batch) return { batchId: null, items: [] };
  const items = all<{ id: number; kind: string; title: string; why: string; supporting_json: string; sample_size: number; confidence_label: ConfidenceLabel; recommendation_json: string; experiment_json: string | null; priority: number; status: string }>(
    db,
    `SELECT * FROM content_opportunities WHERE batch_id = ? ${includeDismissed ? '' : `AND status != 'dismissed'`} ORDER BY priority DESC`,
    batch.batch_id
  ).map((o) => ({
    ...o,
    supporting: parseJson<Opportunity['supporting']>(o.supporting_json, []),
    recommendation: parseJson<Recommendation>(o.recommendation_json, { format: null, hookStyle: null, lengthRange: null, captionDirection: null, nextContent: '' }),
    experiment: parseJson<Opportunity['experiment']>(o.experiment_json, null),
  }));
  return { batchId: batch.batch_id, items };
}

export function setOpportunityStatus(db: Db, id: number, status: 'open' | 'accepted' | 'dismissed' | 'made'): void {
  run(db, 'UPDATE content_opportunities SET status = ? WHERE id = ?', status, id);
}

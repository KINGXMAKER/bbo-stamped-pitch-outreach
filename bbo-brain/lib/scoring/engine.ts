import { all, get, nowIso, parseJson, run, tx, type Db } from '@/lib/db/client';
import { median, percentileRank } from '@/lib/intel/stats';
import {
  computeScore,
  deriveComponents,
  labelFor,
  RELATIVE_KEYS,
  type ComponentKey,
  type LabelThresholds,
  type RawMetrics,
  type ScoreFormula,
} from './formula';

export type ScoreVersion = { id: number; version: string; formula: ScoreFormula; thresholds: LabelThresholds; notes: string | null };

export function activeScoreVersion(db: Db): ScoreVersion {
  const row = get<{ id: number; version: string; formula_json: string; label_thresholds_json: string; notes: string | null }>(
    db,
    'SELECT * FROM performance_score_versions WHERE is_active = 1 ORDER BY id DESC LIMIT 1'
  );
  if (!row) throw new Error('No active performance score version. Run the seed.');
  return {
    id: row.id,
    version: row.version,
    formula: JSON.parse(row.formula_json) as ScoreFormula,
    thresholds: JSON.parse(row.label_thresholds_json) as LabelThresholds,
    notes: row.notes,
  };
}

type ScoringInput = {
  postId: number;
  platformId: string;
  formatClass: 'video' | 'static';
  publishedAt: string;
  observedAt: string | null;
  durationS: number | null;
  metrics: RawMetrics;
};

export function formatClass(format: string | null): 'video' | 'static' {
  return format === 'reel' || format === 'video' || format === 'short' ? 'video' : 'static';
}

export function loadScoringInputs(db: Db): ScoringInput[] {
  const posts = all<{ post_id: number; platform_id: string; published_at: string; format: string | null; duration_s: number | null }>(
    db,
    `SELECT pp.id AS post_id, pp.platform_id, pp.published_at, c.format, c.duration_s
     FROM platform_posts pp JOIN content c ON c.id = pp.content_id
     WHERE c.status = 'published' AND pp.published_at IS NOT NULL`
  );
  const latest = all<{ platform_post_id: number; metric: string; value: number; observed_at: string }>(db, 'SELECT * FROM content_metric_latest');
  const byPost = new Map<number, { metrics: RawMetrics; observedAt: string | null }>();
  for (const m of latest) {
    const entry = byPost.get(m.platform_post_id) ?? { metrics: {}, observedAt: null };
    (entry.metrics as Record<string, number>)[m.metric] = m.value;
    if (m.metric === 'reach') entry.observedAt = m.observed_at;
    byPost.set(m.platform_post_id, entry);
  }
  return posts.map((p) => ({
    postId: p.post_id,
    platformId: p.platform_id,
    formatClass: formatClass(p.format),
    publishedAt: p.published_at,
    observedAt: byPost.get(p.post_id)?.observedAt ?? null,
    durationS: p.duration_s,
    metrics: byPost.get(p.post_id)?.metrics ?? {},
  }));
}

export type ScoreRunResult = { versionId: number; total: number; scored: number; immature: number; unscored: number; noBaseline: number };

/**
 * Recomputes every post's score for a version. Scores are derived data: they
 * are replaced wholesale per version, while the metric history they read from
 * is never modified.
 */
export function computeAllScores(db: Db, version: ScoreVersion = activeScoreVersion(db), now = new Date()): ScoreRunResult {
  const { formula, thresholds } = version;
  const inputs = loadScoringInputs(db);
  const day = 86_400_000;

  const prepared = inputs.map((input) => {
    const age = (input.observedAt ? new Date(input.observedAt) : now).getTime() - new Date(input.publishedAt).getTime();
    return { ...input, time: new Date(input.publishedAt).getTime(), mature: age >= formula.maturityHours * 3_600_000, components: deriveComponents(input.metrics, input.durationS) };
  });

  const results: Array<{
    postId: number;
    platformId: string;
    formatClass: string;
    score: number | null;
    label: string;
    components: unknown;
    group: string;
    peerN: number;
    coverage: number;
    mature: boolean;
  }> = [];
  const counts = { scored: 0, immature: 0, unscored: 0, noBaseline: 0 };

  for (const post of prepared) {
    const candidates = prepared.filter(
      (o) => o.postId !== post.postId && o.mature && o.platformId === post.platformId && o.formatClass === post.formatClass
    );
    let peers = candidates.filter((o) => o.time < post.time && o.time >= post.time - formula.baseline.trailingDays * day);
    let group = `${post.platformId}·${post.formatClass}·trailing ${formula.baseline.trailingDays}d`;
    if (peers.length < formula.baseline.minPeers) {
      peers = candidates.filter((o) => Math.abs(o.time - post.time) <= formula.baseline.centeredDays * day);
      group = `${post.platformId}·${post.formatClass}·±${formula.baseline.centeredDays}d`;
    }
    if (peers.length < formula.baseline.minPeers) {
      peers = candidates;
      group = `${post.platformId}·${post.formatClass}·all time`;
    }

    if (peers.length < 3) {
      counts.noBaseline++;
      results.push({ postId: post.postId, platformId: post.platformId, formatClass: post.formatClass, score: null, label: post.mature ? 'UNSCORED' : 'IMMATURE', components: [], group, peerN: peers.length, coverage: 0, mature: post.mature });
      continue;
    }

    const peerMedians: Partial<Record<ComponentKey, number | null>> = {};
    for (const key of new Set([...(Object.keys(formula.weights) as ComponentKey[]), ...RELATIVE_KEYS])) {
      peerMedians[key] = median(peers.map((p) => p.components[key]).filter((v): v is number => typeof v === 'number'));
    }
    const scored = computeScore(post.components, peerMedians, formula);
    // Unweighted components are still stored as peer ratios (weight 0) for era-normalised comparisons.
    const weighted = new Set(scored.components.map((c) => c.key));
    const relativeOnly = RELATIVE_KEYS.filter((k) => !weighted.has(k)).flatMap((key) => {
      const value = post.components[key];
      const peer = peerMedians[key];
      return typeof value === 'number' && typeof peer === 'number' && peer > 0
        ? [{ key, value, peerMedian: peer, ratio: Math.min(Math.max(value / peer, formula.ratioFloor), formula.ratioCap), weight: 0 }]
        : [];
    });
    const label = labelFor(scored.score, post.mature, thresholds);
    if (label === 'IMMATURE') counts.immature++;
    else if (scored.score === null) counts.unscored++;
    else counts.scored++;
    results.push({
      postId: post.postId,
      platformId: post.platformId,
      formatClass: post.formatClass,
      score: scored.score,
      label,
      components: [...scored.components, ...relativeOnly],
      group,
      peerN: peers.length,
      coverage: scored.coverage,
      mature: post.mature,
    });
  }

  // Percentile among mature scored posts of the same platform and format class.
  const pools = new Map<string, number[]>();
  for (const r of results) {
    if (!r.mature || r.score === null) continue;
    const key = `${r.platformId}:${r.formatClass}`;
    pools.set(key, [...(pools.get(key) ?? []), r.score]);
  }

  const computedAt = nowIso();
  tx(db, () => {
    run(db, 'DELETE FROM performance_scores WHERE score_version_id = ?', version.id);
    const stmt = db.prepare(
      `INSERT INTO performance_scores (platform_post_id, score_version_id, score, label, components_json, baseline_group, peer_n, coverage, percentile, is_mature, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of results) {
      const pool = pools.get(`${r.platformId}:${r.formatClass}`) ?? [];
      const percentile = r.mature && r.score !== null ? percentileRank(r.score, pool) : null;
      stmt.run(r.postId, version.id, r.score, r.label, JSON.stringify(r.components), r.group, r.peerN, r.coverage, percentile, r.mature ? 1 : 0, computedAt);
    }
  });

  return { versionId: version.id, total: results.length, ...counts };
}

/** Creates a new score version (inactive unless activate). Formulas are never edited in place. */
export function createScoreVersion(
  db: Db,
  input: { version: string; formula: ScoreFormula; thresholds: LabelThresholds; notes: string; activate: boolean }
): number {
  return tx(db, () => {
    if (input.activate) run(db, 'UPDATE performance_score_versions SET is_active = 0');
    return run(
      db,
      `INSERT INTO performance_score_versions (version, formula_json, label_thresholds_json, notes, is_active) VALUES (?, ?, ?, ?, ?)`,
      input.version,
      JSON.stringify(input.formula),
      JSON.stringify(input.thresholds),
      input.notes,
      input.activate ? 1 : 0
    ).lastId;
  });
}

export function scoreVersions(db: Db) {
  return all<{ id: number; version: string; notes: string | null; is_active: number; created_at: string; formula_json: string; label_thresholds_json: string }>(
    db,
    'SELECT * FROM performance_score_versions ORDER BY id DESC'
  ).map((v) => ({ ...v, formula: parseJson<ScoreFormula | null>(v.formula_json, null), thresholds: parseJson<LabelThresholds | null>(v.label_thresholds_json, null) }));
}

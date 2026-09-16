import { all, json, nowIso, parseJson, run, tx, type Db } from '@/lib/db/client';
import { comparable, loadFacts } from './dataset';
import { parsePattern } from './patterns';
import { similarity } from './similar';

/**
 * Relational knowledge graph. Edges are materialised from the normalised tables
 * so the graph is queryable with plain SQL; the visual is secondary.
 */

export type NodeType = 'content' | 'person' | 'topic' | 'franchise' | 'platform' | 'experiment' | 'lesson' | 'rule' | 'skill';
export type Edge = { srcType: NodeType; srcId: string; rel: string; dstType: NodeType; dstId: string; weight?: number; evidence?: unknown };

export function rebuildGraph(db: Db): number {
  const edges: Edge[] = [];
  const add = (e: Edge) => edges.push(e);

  for (const r of all<{ person_id: number; content_id: number; role: string }>(db, `SELECT person_id, content_id, role FROM content_people WHERE role IN ('guest','host','cast','opening_speaker')`)) {
    add({ srcType: 'person', srcId: String(r.person_id), rel: 'APPEARED_IN', dstType: 'content', dstId: String(r.content_id), evidence: { role: r.role } });
  }
  for (const r of all<{ content_id: number; topic_id: number; is_primary: number; source: string }>(db, 'SELECT content_id, topic_id, is_primary, source FROM content_topics')) {
    add({ srcType: 'content', srcId: String(r.content_id), rel: 'ABOUT', dstType: 'topic', dstId: String(r.topic_id), weight: r.is_primary ? 1 : 0.5, evidence: { source: r.source } });
  }
  for (const r of all<{ id: number; franchise_id: number | null }>(db, 'SELECT id, franchise_id FROM content WHERE franchise_id IS NOT NULL')) {
    add({ srcType: 'content', srcId: String(r.id), rel: 'BELONGS_TO', dstType: 'franchise', dstId: String(r.franchise_id) });
  }
  for (const r of all<{ content_id: number; platform_id: string }>(db, 'SELECT content_id, platform_id FROM platform_posts')) {
    add({ srcType: 'content', srcId: String(r.content_id), rel: 'PUBLISHED_ON', dstType: 'platform', dstId: r.platform_id });
  }
  for (const r of all<{ experiment_id: number; content_id: number; arm: string }>(db, 'SELECT experiment_id, content_id, arm FROM experiment_content')) {
    add({ srcType: 'content', srcId: String(r.content_id), rel: 'TESTED', dstType: 'experiment', dstId: String(r.experiment_id), evidence: { arm: r.arm } });
  }
  for (const r of all<{ id: number; lesson_id: number }>(db, 'SELECT id, lesson_id FROM experiments WHERE lesson_id IS NOT NULL')) {
    add({ srcType: 'experiment', srcId: String(r.id), rel: 'PRODUCED', dstType: 'lesson', dstId: String(r.lesson_id) });
  }
  for (const r of all<{ lesson_id: number; content_id: number; relation: string }>(db, 'SELECT lesson_id, content_id, relation FROM lesson_content')) {
    if (r.relation === 'source') add({ srcType: 'content', srcId: String(r.content_id), rel: 'PRODUCED', dstType: 'lesson', dstId: String(r.lesson_id) });
    else add({ srcType: 'content', srcId: String(r.content_id), rel: r.relation === 'supporting' ? 'SUPPORTS' : 'CONTRADICTS', dstType: 'lesson', dstId: String(r.lesson_id) });
  }

  const rules = all<{ id: number; pattern_json: string | null; applies_to_json: string; status: string }>(
    db,
    `SELECT r.id, r.pattern_json, rv.applies_to_json, r.status FROM rules r JOIN rule_versions rv ON rv.id = r.current_version_id`
  );
  const lessons = all<{ id: number; status: string; related_rule_id: number | null; pattern_json: string | null; metrics_json: string | null; direction: string | null }>(db, 'SELECT id, status, related_rule_id, pattern_json, metrics_json, direction FROM lessons');
  for (const l of lessons) {
    if (l.related_rule_id) add({ srcType: 'lesson', srcId: String(l.id), rel: 'SUPPORTS', dstType: 'rule', dstId: String(l.related_rule_id) });
    const lp = parsePattern(l.pattern_json) ?? parsePattern(JSON.stringify(parseJson<{ pattern?: unknown }>(l.metrics_json, {}).pattern ?? null));
    if (!lp) continue;
    if (lp.key === 'topic') {
      const topic = all<{ id: number }>(db, 'SELECT id FROM topics WHERE slug = ?', lp.group)[0];
      if (topic) add({ srcType: 'topic', srcId: String(topic.id), rel: 'ASSOCIATED_WITH', dstType: 'lesson', dstId: String(l.id), evidence: { metric: lp.metric, direction: l.direction } });
    }
    if (l.status === 'CONTRADICTED' || l.status === 'WEAKENED') {
      for (const r of rules) {
        const rp = parsePattern(r.pattern_json);
        if (rp && rp.key === lp.key && rp.group === lp.group) add({ srcType: 'lesson', srcId: String(l.id), rel: 'CONTRADICTS', dstType: 'rule', dstId: String(r.id) });
      }
    }
  }
  const franchises = new Map(all<{ id: number; slug: string }>(db, 'SELECT id, slug FROM franchises').map((f) => [f.slug, f.id]));
  const skills = all<{ id: number; slug: string }>(db, 'SELECT id, slug FROM skills');
  for (const r of rules.filter((x) => x.status === 'active')) {
    const applies = parseJson<{ workflows?: string[]; franchises?: string[]; platforms?: string[] }>(r.applies_to_json, {});
    for (const slug of applies.franchises ?? []) if (franchises.has(slug)) add({ srcType: 'rule', srcId: String(r.id), rel: 'APPLIES_TO', dstType: 'franchise', dstId: String(franchises.get(slug)) });
    for (const p of applies.platforms ?? []) add({ srcType: 'rule', srcId: String(r.id), rel: 'APPLIES_TO', dstType: 'platform', dstId: p });
    for (const s of skills) {
      const workflow = s.slug === 'bbo-gatekeeper' ? 'gatekeeper' : 'viral_editor';
      const w = applies.workflows ?? ['*'];
      if (w.includes('*') || w.includes(workflow)) add({ srcType: 'rule', srcId: String(r.id), rel: 'GOVERNS', dstType: 'skill', dstId: String(s.id) });
    }
  }

  // Person ↔ topic co-occurrence (≥2 posts).
  for (const r of all<{ person_id: number; topic_id: number; n: number }>(
    db,
    `SELECT cp.person_id, ct.topic_id, COUNT(*) AS n FROM content_people cp JOIN content_topics ct ON ct.content_id = cp.content_id
     WHERE cp.role = 'guest' GROUP BY cp.person_id, ct.topic_id HAVING COUNT(*) >= 2`
  )) {
    add({ srcType: 'person', srcId: String(r.person_id), rel: 'ASSOCIATED_WITH', dstType: 'topic', dstId: String(r.topic_id), weight: r.n });
  }

  // OUTPERFORMED between genuinely similar posts (≤3 per post) so the relation carries meaning.
  const facts = comparable(loadFacts(db));
  for (const a of facts) {
    const pairs = facts
      .filter((b) => b.contentId !== a.contentId && (a.score ?? 0) >= 1.5 * (b.score ?? Infinity))
      .map((b) => ({ b, s: similarity(a, b) }))
      .filter((x) => x.s.score >= 5)
      .sort((x, y) => y.s.score - x.s.score)
      .slice(0, 3);
    for (const { b, s } of pairs) {
      add({ srcType: 'content', srcId: String(a.contentId), rel: 'OUTPERFORMED', dstType: 'content', dstId: String(b.contentId), weight: (a.score ?? 0) / (b.score ?? 1), evidence: { shared: s.shared } });
    }
  }

  const computedAt = nowIso();
  tx(db, () => {
    run(db, 'DELETE FROM graph_edges');
    const stmt = db.prepare(
      `INSERT INTO graph_edges (src_type, src_id, rel, dst_type, dst_id, weight, evidence_json, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
    );
    for (const e of edges) stmt.run(e.srcType, e.srcId, e.rel, e.dstType, e.dstId, e.weight ?? null, e.evidence === undefined ? null : json(e.evidence), computedAt);
  });
  return edges.length;
}

export type GraphNode = { type: NodeType; id: string; label: string };
export type GraphEdgeRow = { src: GraphNode; rel: string; dst: GraphNode; weight: number | null; evidence: unknown };

export function nodeLabels(db: Db, nodes: Array<{ type: string; id: string }>): Map<string, string> {
  const out = new Map<string, string>();
  const byType = new Map<string, string[]>();
  for (const n of nodes) byType.set(n.type, [...(byType.get(n.type) ?? []), n.id]);
  const q: Record<string, string> = {
    content: 'SELECT id, title AS label FROM content',
    person: 'SELECT id, canonical_name AS label FROM people',
    topic: 'SELECT id, name AS label FROM topics',
    franchise: 'SELECT id, name AS label FROM franchises',
    platform: 'SELECT id, name AS label FROM platforms',
    experiment: `SELECT id, code || ' ' || name AS label FROM experiments`,
    lesson: `SELECT id, code AS label FROM lessons`,
    rule: `SELECT r.id, r.code || ' v' || rv.version AS label FROM rules r JOIN rule_versions rv ON rv.id = r.current_version_id`,
    skill: 'SELECT id, name AS label FROM skills',
  };
  for (const [type, ids] of byType) {
    if (!q[type]) continue;
    const idList = type === 'platform' ? ids.map((i) => `'${i.replace(/'/g, "''")}'`).join(',') : ids.map(Number).filter(Number.isFinite).join(',');
    if (!idList) continue;
    for (const r of all<{ id: string | number; label: string }>(db, `SELECT * FROM (${q[type]}) WHERE id IN (${idList})`)) out.set(`${type}:${r.id}`, r.label);
  }
  return out;
}

/** Neighbours of one node, both directions, optionally filtered by relation. */
export function neighbors(db: Db, type: NodeType, id: string, rel?: string, limit = 200): GraphEdgeRow[] {
  const rows = all<{ src_type: NodeType; src_id: string; rel: string; dst_type: NodeType; dst_id: string; weight: number | null; evidence_json: string | null }>(
    db,
    `SELECT * FROM graph_edges WHERE ((src_type = ? AND src_id = ?) OR (dst_type = ? AND dst_id = ?)) ${rel ? 'AND rel = ?' : ''} LIMIT ?`,
    type,
    id,
    type,
    id,
    ...(rel ? [rel] : []),
    limit
  );
  const labels = nodeLabels(db, rows.flatMap((r) => [{ type: r.src_type, id: r.src_id }, { type: r.dst_type, id: r.dst_id }]));
  return rows.map((r) => ({
    src: { type: r.src_type, id: r.src_id, label: labels.get(`${r.src_type}:${r.src_id}`) ?? r.src_id },
    rel: r.rel,
    dst: { type: r.dst_type, id: r.dst_id, label: labels.get(`${r.dst_type}:${r.dst_id}`) ?? r.dst_id },
    weight: r.weight,
    evidence: parseJson(r.evidence_json, null),
  }));
}

export function graphStats(db: Db) {
  return all<{ rel: string; src_type: string; dst_type: string; n: number }>(db, 'SELECT rel, src_type, dst_type, COUNT(*) AS n FROM graph_edges GROUP BY rel, src_type, dst_type ORDER BY n DESC');
}

/** A bounded subgraph for the visualisation: the most-connected non-content nodes plus their edges. */
export function overviewSubgraph(db: Db, maxNodes = 60) {
  const hubs = all<{ type: string; id: string; degree: number }>(
    db,
    `SELECT type, id, SUM(n) AS degree FROM (
       SELECT src_type AS type, src_id AS id, COUNT(*) AS n FROM graph_edges WHERE src_type != 'content' GROUP BY src_type, src_id
       UNION ALL SELECT dst_type, dst_id, COUNT(*) FROM graph_edges WHERE dst_type != 'content' GROUP BY dst_type, dst_id
     ) GROUP BY type, id ORDER BY degree DESC LIMIT ?`,
    maxNodes
  );
  const keys = new Set(hubs.map((h) => `${h.type}:${h.id}`));
  // Connect hubs through shared content: topic/person/franchise that co-occur on posts.
  const links = all<{ a_type: string; a_id: string; b_type: string; b_id: string; n: number }>(
    db,
    `SELECT e1.dst_type AS a_type, e1.dst_id AS a_id, CASE WHEN e2.src_type = 'content' THEN e2.dst_type ELSE e2.src_type END AS b_type,
            CASE WHEN e2.src_type = 'content' THEN e2.dst_id ELSE e2.src_id END AS b_id, COUNT(*) AS n
     FROM graph_edges e1 JOIN graph_edges e2 ON (e2.src_type = 'content' AND e2.src_id = e1.src_id) OR (e2.dst_type = 'content' AND e2.dst_id = e1.src_id)
     WHERE e1.src_type = 'content' AND e1.dst_type IN ('topic','franchise') AND e2.rel IN ('ABOUT','BELONGS_TO','APPEARED_IN')
     GROUP BY 1,2,3,4 HAVING n >= 2`
  ).filter((l) => keys.has(`${l.a_type}:${l.a_id}`) && keys.has(`${l.b_type}:${l.b_id}`) && `${l.a_type}:${l.a_id}` < `${l.b_type}:${l.b_id}`);
  const direct = all<{ src_type: string; src_id: string; dst_type: string; dst_id: string; rel: string }>(db, `SELECT src_type, src_id, dst_type, dst_id, rel FROM graph_edges WHERE src_type != 'content' AND dst_type != 'content'`).filter(
    (e) => keys.has(`${e.src_type}:${e.src_id}`) && keys.has(`${e.dst_type}:${e.dst_id}`)
  );
  const labels = nodeLabels(db, hubs);
  return {
    nodes: hubs.map((h) => ({ key: `${h.type}:${h.id}`, type: h.type, id: h.id, label: labels.get(`${h.type}:${h.id}`) ?? h.id, degree: h.degree })),
    links: [
      ...links.map((l) => ({ source: `${l.a_type}:${l.a_id}`, target: `${l.b_type}:${l.b_id}`, rel: 'CO_OCCURS', weight: l.n })),
      ...direct.map((e) => ({ source: `${e.src_type}:${e.src_id}`, target: `${e.dst_type}:${e.dst_id}`, rel: e.rel, weight: 1 })),
    ],
  };
}

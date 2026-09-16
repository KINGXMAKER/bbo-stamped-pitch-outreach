import { all, run, tx, type Db } from '@/lib/db/client';

export type SearchHit = { entityType: string; entityId: string; title: string; snippet: string; rank: number };

/** Full rebuild of the FTS5 index. Cheap at BBO's scale (thousands of rows). */
export function rebuildSearchIndex(db: Db): number {
  let n = 0;
  tx(db, () => {
    run(db, 'DELETE FROM search_index');
    const stmt = db.prepare('INSERT INTO search_index (entity_type, entity_id, title, body) VALUES (?, ?, ?, ?)');
    const insert = (type: string, id: string | number, title: string, body: string) => {
      stmt.run(type, String(id), title, body);
      n++;
    };
    for (const c of all<{ id: number; title: string; caption: string | null; transcript: string | null; franchise: string | null }>(
      db,
      `SELECT c.id, c.title, pp.caption, (SELECT text FROM transcripts t WHERE t.content_id = c.id ORDER BY id DESC LIMIT 1) AS transcript, f.name AS franchise
       FROM content c LEFT JOIN platform_posts pp ON pp.id = c.primary_post_id LEFT JOIN franchises f ON f.id = c.franchise_id`
    )) {
      insert('content', c.id, c.title, [c.franchise, c.caption, c.transcript].filter(Boolean).join('\n'));
    }
    for (const p of all<{ id: number; canonical_name: string; aliases: string | null; notes: string | null }>(
      db,
      `SELECT p.id, p.canonical_name, p.notes, (SELECT group_concat(alias, ' ') FROM entity_aliases a WHERE a.entity_type = 'person' AND a.entity_id = CAST(p.id AS TEXT)) AS aliases FROM people p`
    )) {
      insert('person', p.id, p.canonical_name, [p.aliases, p.notes].filter(Boolean).join('\n'));
    }
    for (const t of all<{ id: number; name: string; aliases: string | null }>(
      db,
      `SELECT t.id, t.name, (SELECT group_concat(alias, ' ') FROM entity_aliases a WHERE a.entity_type = 'topic' AND a.entity_id = CAST(t.id AS TEXT)) AS aliases FROM topics t`
    )) {
      insert('topic', t.id, t.name, t.aliases ?? '');
    }
    for (const l of all<{ id: number; code: string; text: string; evidence: string | null; status: string }>(db, 'SELECT id, code, text, evidence, status FROM lessons')) {
      insert('lesson', l.id, `${l.code} · ${l.status}`, `${l.text}\n${l.evidence ?? ''}`);
    }
    for (const r of all<{ id: number; code: string; text: string; reason: string | null }>(db, 'SELECT r.id, r.code, rv.text, rv.reason FROM rules r JOIN rule_versions rv ON rv.id = r.current_version_id')) {
      insert('rule', r.id, r.code, `${r.text}\n${r.reason ?? ''}`);
    }
    for (const e of all<{ id: number; code: string; name: string; hypothesis: string; result_summary: string | null }>(db, 'SELECT id, code, name, hypothesis, result_summary FROM experiments')) {
      insert('experiment', e.id, `${e.code} ${e.name}`, `${e.hypothesis}\n${e.result_summary ?? ''}`);
    }
    for (const a of all<{ id: number; content_id: number; actual_topic: string | null; underlying_debate: string | null; outcome_explanation: string | null; reusable_lesson: string | null }>(
      db,
      'SELECT id, content_id, actual_topic, underlying_debate, outcome_explanation, reusable_lesson FROM content_analyses'
    )) {
      insert('analysis', a.content_id, a.actual_topic ?? 'Analysis', [a.underlying_debate, a.outcome_explanation, a.reusable_lesson].filter(Boolean).join('\n'));
    }
  });
  return n;
}

/** Sanitises free text into an FTS5 prefix query: every word must match. */
export function toFtsQuery(q: string): string | null {
  const words = q
    .toLowerCase()
    .replace(/["*^():]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}']/gu, ''))
    .filter((w) => w.length >= 2)
    .slice(0, 8);
  return words.length ? words.map((w) => `"${w}"*`).join(' AND ') : null;
}

export function search(db: Db, q: string, opts: { types?: string[]; limit?: number } = {}): SearchHit[] {
  const fts = toFtsQuery(q);
  if (!fts) return [];
  const types = opts.types?.length ? `AND entity_type IN (${opts.types.map((t) => `'${t.replace(/'/g, "''")}'`).join(',')})` : '';
  return all<{ entity_type: string; entity_id: string; title: string; snippet: string; rank: number }>(
    db,
    `SELECT entity_type, entity_id, title, snippet(search_index, 3, '⟪', '⟫', '…', 14) AS snippet, bm25(search_index, 0, 0, 4, 1) AS rank
     FROM search_index WHERE search_index MATCH ? ${types} ORDER BY rank LIMIT ?`,
    fts,
    opts.limit ?? 40
  ).map((r) => ({ entityType: r.entity_type, entityId: r.entity_id, title: r.title, snippet: r.snippet, rank: r.rank }));
}

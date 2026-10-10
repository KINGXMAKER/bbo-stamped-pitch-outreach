import { all, get, run, tx, type Db } from '@/lib/db/client';
import { normalizeName, REVIEW_SIMILARITY, similarity, squash } from './normalize';

export type EntityType = 'person' | 'topic' | 'franchise' | 'platform' | 'brand';

export type Resolution =
  | { kind: 'matched'; entityId: string; via: 'alias' }
  | { kind: 'review'; candidateId: number; suggestedEntityId: string; similarity: number }
  | { kind: 'unknown'; norm: string };

/**
 * normalize → exact alias (spaced or squashed) → near match → unknown.
 *
 * A near match is NEVER merged here: it becomes a pending review candidate and
 * the caller must not link the entity until a human resolves it.
 */
export function resolveEntity(
  db: Db,
  type: EntityType,
  raw: string,
  context?: { contentId?: number; text?: string }
): Resolution {
  const norm = normalizeName(raw);
  if (!norm) return { kind: 'unknown', norm };

  const exact = get<{ entity_id: string }>(
    db,
    `SELECT entity_id FROM entity_aliases
     WHERE entity_type = ? AND (alias_norm = ? OR replace(alias_norm, ' ', '') = ?)
     LIMIT 1`,
    type,
    norm,
    squash(norm)
  );
  if (exact) return { kind: 'matched', entityId: String(exact.entity_id), via: 'alias' };

  const aliases = all<{ entity_id: string; alias_norm: string }>(
    db,
    'SELECT entity_id, alias_norm FROM entity_aliases WHERE entity_type = ?',
    type
  );
  let best: { entityId: string; score: number } | null = null;
  for (const alias of aliases) {
    const score = similarity(norm, alias.alias_norm);
    if (score >= REVIEW_SIMILARITY && (!best || score > best.score)) {
      best = { entityId: String(alias.entity_id), score };
    }
  }
  if (!best) return { kind: 'unknown', norm };

  const existing = get<{ id: number }>(
    db,
    `SELECT id FROM entity_resolution_candidates WHERE entity_type = ? AND raw_norm = ? AND status = 'pending'`,
    type,
    norm
  );
  if (existing) {
    return { kind: 'review', candidateId: existing.id, suggestedEntityId: best.entityId, similarity: best.score };
  }
  const { lastId } = run(
    db,
    `INSERT INTO entity_resolution_candidates
       (entity_type, raw_value, raw_norm, suggested_entity_id, similarity, context_content_id, context)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    type,
    raw,
    norm,
    best.entityId,
    Math.round(best.score * 1000) / 1000,
    context?.contentId ?? null,
    context?.text?.slice(0, 500) ?? null
  );
  return { kind: 'review', candidateId: lastId, suggestedEntityId: best.entityId, similarity: best.score };
}

export function addAlias(db: Db, type: EntityType, entityId: string | number, alias: string, source = 'seed'): void {
  const norm = normalizeName(alias);
  if (!norm) return;
  run(
    db,
    `INSERT INTO entity_aliases (entity_type, entity_id, alias, alias_norm, source) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (entity_type, alias_norm) DO NOTHING`,
    type,
    String(entityId),
    alias,
    norm,
    source
  );
}

export type CandidateDecision =
  | { action: 'merge'; entityId: string }
  | { action: 'create' }
  | { action: 'ignore' };

/**
 * Human decision on a pending candidate. 'merge' records the raw value as an
 * alias of the chosen entity; 'create' makes a new person (people are the only
 * type created from review — topics/franchises are curated reference data).
 * When the candidate came from a piece of content, the link is written too.
 */
export function decideCandidate(db: Db, candidateId: number, decision: CandidateDecision): string | null {
  return tx(db, () => {
    const candidate = get<{
      id: number;
      entity_type: EntityType;
      raw_value: string;
      raw_norm: string;
      context_content_id: number | null;
      status: string;
    }>(db, 'SELECT * FROM entity_resolution_candidates WHERE id = ?', candidateId);
    if (!candidate) throw new Error(`Candidate ${candidateId} not found.`);
    if (candidate.status !== 'pending') throw new Error(`Candidate ${candidateId} is already ${candidate.status}.`);

    let entityId: string | null = null;
    let status: 'merged' | 'created' | 'ignored' = 'ignored';

    if (decision.action === 'merge') {
      entityId = decision.entityId;
      addAlias(db, candidate.entity_type, entityId, candidate.raw_value, 'human_review');
      status = 'merged';
    } else if (decision.action === 'create') {
      if (candidate.entity_type !== 'person') {
        throw new Error('Only people can be created from review. Add topics and franchises in Settings.');
      }
      entityId = String(createPerson(db, candidate.raw_value, 'human_review'));
      status = 'created';
    }

    if (entityId && candidate.entity_type === 'person' && candidate.context_content_id) {
      run(
        db,
        `INSERT INTO content_people (content_id, person_id, role, source, confidence)
         VALUES (?, ?, CASE WHEN (SELECT type FROM people WHERE id = ?) = 'host' THEN 'host' ELSE 'guest' END, 'human', 1) ON CONFLICT DO NOTHING`,
        candidate.context_content_id,
        Number(entityId),
        Number(entityId)
      );
    }

    run(
      db,
      `UPDATE entity_resolution_candidates SET status = ?, resolved_entity_id = ?, resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      status,
      entityId,
      candidateId
    );
    return entityId;
  });
}

/** Creates a person from an Instagram handle or a display name, with its alias. */
export function createPerson(db: Db, raw: string, source: string, type = 'guest'): number {
  const handle = raw.startsWith('@') || /^[a-z0-9._]+$/i.test(raw) ? raw.replace(/^@+/, '').toLowerCase() : null;
  const base = normalizeName(raw).replace(/ /g, '-') || 'person';
  let slug = base;
  for (let i = 2; get(db, 'SELECT 1 FROM people WHERE slug = ?', slug); i++) slug = `${base}-${i}`;
  const { lastId } = run(
    db,
    'INSERT INTO people (slug, canonical_name, type, instagram_handle) VALUES (?, ?, ?, ?)',
    slug,
    handle ? `@${handle}` : raw,
    type,
    handle
  );
  addAlias(db, 'person', lastId, raw, source);
  if (handle) addAlias(db, 'person', lastId, `@${handle}`, source);
  return lastId;
}

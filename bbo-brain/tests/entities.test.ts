import { describe, expect, it } from 'vitest';
import { get, run } from '@/lib/db/client';
import { linkPerson } from '@/lib/ingest/ingest';
import { AnalysisSchema } from '@/lib/intel/analysis';
import { seedReference } from '@/lib/seed';
import { normalizeName, similarity, squash } from '@/lib/entities/normalize';
import { createPerson, decideCandidate, resolveEntity } from '@/lib/entities/resolve';
import { makePost, testDb } from './helpers';

describe('normalizeName', () => {
  it('collapses case, punctuation, handles and underscores', () => {
    expect(normalizeName('@Cozy_Homies_Studio_')).toBe('cozy homies studio');
    expect(normalizeName('BBO  Court!!')).toBe('bbo court');
    expect(squash(normalizeName('BBOCourt'))).toBe(squash(normalizeName('BBO Court')));
  });

  it('scores near names as similar and different names as not', () => {
    expect(similarity('unghetto', 'un ghetto')).toBeGreaterThan(0.85);
    expect(similarity('essowrld', 'cozy homies studio')).toBeLessThan(0.5);
  });
});

describe('resolveEntity', () => {
  it('maps every seeded alias variation to the canonical franchise', () => {
    const db = testDb();
    const court = get<{ id: number }>(db, `SELECT id FROM franchises WHERE slug = 'bbo-court'`)!.id;
    for (const raw of ['BBO Court', 'Court', 'BBOCourt', 'bbo court show', 'BBO-COURT']) {
      const r = resolveEntity(db, 'franchise', raw);
      expect(r).toEqual({ kind: 'matched', entityId: String(court), via: 'alias' });
    }
  });

  it('maps brand aliases to BBO', () => {
    const db = testDb();
    expect(resolveEntity(db, 'brand', 'Bad Bitches Only Show')).toMatchObject({ kind: 'matched', entityId: 'bbo' });
  });

  it('flags a questionable person match for review and never merges it', () => {
    const db = testDb();
    const personId = createPerson(db, '@unghetto', 'test');
    const { contentId } = makePost(db);
    const r = resolveEntity(db, 'person', 'Un Ghettoo', { contentId });
    expect(r.kind).toBe('review');
    expect(get(db, 'SELECT 1 FROM content_people WHERE content_id = ?', contentId)).toBeUndefined();
    // Asking again reuses the pending candidate instead of duplicating it.
    const again = resolveEntity(db, 'person', 'un ghettoo', { contentId });
    expect(again.kind === 'review' && r.kind === 'review' && again.candidateId === r.candidateId).toBe(true);
    expect(r.kind === 'review' && r.suggestedEntityId).toBe(String(personId));
  });

  it('merges only when a human decides, then learns the alias', () => {
    const db = testDb();
    const personId = createPerson(db, '@unghetto', 'test');
    const { contentId } = makePost(db);
    const r = resolveEntity(db, 'person', 'Un Ghettoo', { contentId });
    if (r.kind !== 'review') throw new Error('expected review');
    decideCandidate(db, r.candidateId, { action: 'merge', entityId: String(personId) });
    expect(get(db, 'SELECT 1 FROM content_people WHERE content_id = ? AND person_id = ?', contentId, personId)).toBeTruthy();
    expect(resolveEntity(db, 'person', 'Un Ghettoo')).toMatchObject({ kind: 'matched', entityId: String(personId) });
    expect(() => decideCandidate(db, r.candidateId, { action: 'ignore' })).toThrow(/already merged/);
  });

  it('returns unknown for genuinely new names', () => {
    const db = testDb();
    expect(resolveEntity(db, 'person', '@somebodynew').kind).toBe('unknown');
  });
});

describe('BBO hosts', () => {
  const hostId = (db: ReturnType<typeof testDb>) => get<{ id: number; type: string }>(db, `SELECT id, type FROM people WHERE instagram_handle = 'kingmakerslurrty'`)!;

  it('seeds the hosts as hosts, never guests', () => {
    const db = testDb();
    expect(hostId(db).type).toBe('host');
    expect(get<{ type: string }>(db, `SELECT type FROM people WHERE instagram_handle = 'mstrillionairet'`)?.type).toBe('host');
  });

  it('links a tagged host as host, and turns an old guest tag into a host tag', () => {
    const db = testDb();
    const { contentId } = makePost(db);
    linkPerson(db, contentId, hostId(db).id, 'guest', 'heuristic', 0.7);
    expect(get<{ role: string }>(db, 'SELECT role FROM content_people WHERE content_id = ?', contentId)?.role).toBe('host');

    // A guest tag written before the host was known is corrected on the next seed.
    const other = makePost(db).contentId;
    run(db, `INSERT INTO content_people (content_id, person_id, role, source, confidence) VALUES (?, ?, 'guest', 'heuristic', 0.7)`, other, hostId(db).id);
    seedReference(db, process.cwd());
    expect(get<{ role: string }>(db, 'SELECT role FROM content_people WHERE content_id = ?', other)?.role).toBe('host');
  });

  it('folds a "host" opening into "interviewer" — one person, one label', () => {
    const parsed = AnalysisSchema.parse({ confidence: 'high', attributes: { opening_speaker_role: 'host' } });
    expect(parsed.attributes.opening_speaker_role).toBe('interviewer');
  });
});

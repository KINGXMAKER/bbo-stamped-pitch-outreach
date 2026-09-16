import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { all, get, run, tx, type Db } from '@/lib/db/client';

export const SKILL_SLUGS = ['bbo-viral-content', 'bbo-gatekeeper'] as const;
export type SkillSlug = (typeof SKILL_SLUGS)[number];

export type SkillVersion = { id: number; skillId: number; slug: string; version: number; body: string };

function skillFile(slug: string, root = process.cwd()): string {
  return path.join(root, 'skills', slug, 'SKILL.md');
}

function checksum(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 16);
}

function frontmatter(body: string): { name?: string; description?: string } {
  const match = body.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/**
 * Imports SKILL.md files. A file whose content differs from the active version
 * becomes a new version — so editing the file in a text editor is versioned too.
 */
export function syncSkillsFromFiles(db: Db, root = process.cwd()): number {
  let created = 0;
  for (const slug of SKILL_SLUGS) {
    const file = skillFile(slug, root);
    if (!existsSync(file)) continue;
    const body = readFileSync(file, 'utf8');
    const meta = frontmatter(body);
    run(
      db,
      `INSERT INTO skills (slug, name, description) VALUES (?, ?, ?)
       ON CONFLICT (slug) DO UPDATE SET description = excluded.description`,
      slug,
      meta.name ?? slug,
      meta.description ?? null
    );
    if (recordSkillVersion(db, slug, body, 'imported from skills/' + slug + '/SKILL.md')) created++;
  }
  return created;
}

/** Returns true when a new version was written (content changed). */
export function recordSkillVersion(db: Db, slug: string, body: string, notes: string): boolean {
  return tx(db, () => {
    const skill = get<{ id: number }>(db, 'SELECT id FROM skills WHERE slug = ?', slug);
    if (!skill) throw new Error(`Unknown skill ${slug}`);
    const sum = checksum(body);
    const active = get<{ checksum: string }>(
      db,
      'SELECT checksum FROM skill_versions WHERE skill_id = ? AND is_active = 1',
      skill.id
    );
    if (active?.checksum === sum) return false;
    const next = (get<{ v: number | null }>(db, 'SELECT MAX(version) AS v FROM skill_versions WHERE skill_id = ?', skill.id)?.v ?? 0) + 1;
    run(db, 'UPDATE skill_versions SET is_active = 0 WHERE skill_id = ?', skill.id);
    run(
      db,
      'INSERT INTO skill_versions (skill_id, version, body, checksum, notes, is_active) VALUES (?, ?, ?, ?, ?, 1)',
      skill.id,
      next,
      body,
      sum,
      notes
    );
    return true;
  });
}

/** UI edit: new DB version, and the file is rewritten so the two never drift. */
export function editSkill(db: Db, slug: SkillSlug, body: string, notes: string, root = process.cwd()): boolean {
  const changed = recordSkillVersion(db, slug, body, notes);
  if (changed) writeFileSync(skillFile(slug, root), body, 'utf8');
  return changed;
}

export function activeSkill(db: Db, slug: SkillSlug): SkillVersion | null {
  const row = get<{ id: number; skill_id: number; version: number; body: string }>(
    db,
    `SELECT sv.id, sv.skill_id, sv.version, sv.body FROM skill_versions sv
     JOIN skills s ON s.id = sv.skill_id WHERE s.slug = ? AND sv.is_active = 1`,
    slug
  );
  return row ? { id: row.id, skillId: row.skill_id, slug, version: row.version, body: row.body } : null;
}

export function skillHistory(db: Db, slug: string) {
  return all<{ id: number; version: number; notes: string | null; created_at: string; is_active: number; checksum: string }>(
    db,
    `SELECT sv.id, sv.version, sv.notes, sv.created_at, sv.is_active, sv.checksum FROM skill_versions sv
     JOIN skills s ON s.id = sv.skill_id WHERE s.slug = ? ORDER BY sv.version DESC`,
    slug
  );
}

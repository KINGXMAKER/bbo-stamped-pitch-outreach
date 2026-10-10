import type { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from '@/db/migrations';

/**
 * Forward-only migrations. Each runs once, inside a transaction, recorded in
 * schema_migrations. Migrations are TS modules (not .sql files) so they bundle
 * identically in Next, vitest and the CLI scripts without runtime fs lookups.
 */
export function runMigrations(db: DatabaseSync): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map(
      (row) => Number(row.version)
    )
  );
  const ran: number[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(
        migration.version,
        migration.name
      );
      db.exec('COMMIT');
      ran.push(migration.version);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(
        `Migration ${migration.version} (${migration.name}) failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return ran;
}

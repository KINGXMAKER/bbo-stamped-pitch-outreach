import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { runMigrations } from './migrate';

export type Db = DatabaseSync;
type Row = Record<string, unknown>;

const globalForDb = globalThis as unknown as { __bboBrainDb?: DatabaseSync };

export function dbPath(): string {
  return process.env.BRAIN_DB_PATH?.trim() || path.join(process.cwd(), 'data', 'brain.db');
}

/** Opens a database, applies pragmas and pending migrations. ':memory:' for tests. */
export function openDb(file: string): DatabaseSync {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  runMigrations(db);
  return db;
}

/** Process-wide singleton. Survives Next dev hot reloads via globalThis. */
export function getDb(): DatabaseSync {
  if (!globalForDb.__bboBrainDb) globalForDb.__bboBrainDb = openDb(dbPath());
  return globalForDb.__bboBrainDb;
}

export function all<T = Row>(db: Db, sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...(params as never[])) as T[];
}

export function get<T = Row>(db: Db, sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...(params as never[])) as T | undefined;
}

export function run(db: Db, sql: string, ...params: unknown[]): { changes: number; lastId: number } {
  const result = db.prepare(sql).run(...(params as never[]));
  return { changes: Number(result.changes), lastId: Number(result.lastInsertRowid) };
}

/** Runs fn inside a transaction; nested calls join the outer transaction. */
export function tx<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

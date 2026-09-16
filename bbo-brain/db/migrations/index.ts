import * as m0001 from './0001_init';

export type Migration = { version: number; name: string; sql: string };

/** Append new migrations here in order. Never edit an applied migration. */
export const MIGRATIONS: Migration[] = [{ version: 1, name: m0001.name, sql: m0001.sql }];

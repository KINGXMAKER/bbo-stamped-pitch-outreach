import * as m0001 from './0001_init';
import * as m0002 from './0002_coding';
import * as m0003 from './0003_providers';
import * as m0004 from './0004_escalation';
import * as m0005 from './0005_model_quality';
import * as m0006 from './0006_three_buckets';
import * as m0007 from './0007_true_corrections';

export type Migration = { version: number; name: string; sql: string };

/** Append new migrations here in order. Never edit an applied migration. */
export const MIGRATIONS: Migration[] = [
  { version: 1, name: m0001.name, sql: m0001.sql },
  { version: 2, name: m0002.name, sql: m0002.sql },
  { version: 3, name: m0003.name, sql: m0003.sql },
  { version: 4, name: m0004.name, sql: m0004.sql },
  { version: 5, name: m0005.name, sql: m0005.sql },
  { version: 6, name: m0006.name, sql: m0006.sql },
  { version: 7, name: m0007.name, sql: m0007.sql },
];

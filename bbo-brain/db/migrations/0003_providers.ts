export const name = 'providers';

/**
 * Multi-provider AI: per-run provenance deep enough to answer "which model said
 * this, how hard did it try, and what did it cost", plus a place to keep
 * benchmark output that must never be confused with real coding.
 */
export const sql = `
ALTER TABLE ai_runs ADD COLUMN task_class TEXT;
ALTER TABLE ai_runs ADD COLUMN input_tokens INTEGER;
ALTER TABLE ai_runs ADD COLUMN output_tokens INTEGER;
ALTER TABLE ai_runs ADD COLUMN estimated_cost_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE ai_runs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_runs ADD COLUMN fallback_reason TEXT;

CREATE INDEX idx_ai_runs_cost ON ai_runs(created_at, estimated_cost_usd);

CREATE TABLE benchmark_runs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  task_class TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  params_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at TEXT,
  notes TEXT
);

CREATE TABLE benchmark_codings (
  id INTEGER PRIMARY KEY,
  benchmark_run_id INTEGER NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE,
  content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('ok','schema_failed','error')),
  output_json TEXT,
  error TEXT,
  taxonomy_violations_json TEXT NOT NULL DEFAULT '[]',
  missing_fields_json TEXT NOT NULL DEFAULT '[]',
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (benchmark_run_id, content_id)
);

CREATE INDEX idx_benchmark_codings_run ON benchmark_codings(benchmark_run_id);
`;

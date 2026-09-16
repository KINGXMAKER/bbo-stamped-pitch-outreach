export const name = 'escalation';

/**
 * Disagreement escalation: when a cheap coding model is unsure, a stronger one
 * re-codes the same post. Both answers are kept so "the models disagreed here"
 * is a fact on the record rather than a silent overwrite.
 */
export const sql = `
CREATE TABLE coding_escalations (
  id INTEGER PRIMARY KEY,
  content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  base_run_id INTEGER REFERENCES ai_runs(id),
  escalated_run_id INTEGER REFERENCES ai_runs(id),
  base_provider TEXT,
  base_model TEXT,
  escalated_provider TEXT,
  escalated_model TEXT,
  compared INTEGER NOT NULL DEFAULT 0,
  agreed INTEGER NOT NULL DEFAULT 0,
  disagreements_json TEXT NOT NULL DEFAULT '[]',
  outcome TEXT NOT NULL CHECK (outcome IN ('agreed','kept_stronger','human_review')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_coding_escalations_content ON coding_escalations(content_id);
`;

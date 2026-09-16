/**
 * 0002 — structured coding + human validation.
 *
 * Adds media-fetch bookkeeping (for daily throughput limits), a validation
 * status per content record, a review log, and a view that pairs every AI
 * value with the human value that replaced it — so we can measure which
 * attributes the AI routinely gets wrong.
 */
export const name = 'coding_validation';

export const sql = /* sql */ `
ALTER TABLE content ADD COLUMN media_fetched_at TEXT;
ALTER TABLE content ADD COLUMN coded_at TEXT;
ALTER TABLE content ADD COLUMN coding_validation_status TEXT NOT NULL DEFAULT 'UNREVIEWED';
ALTER TABLE content ADD COLUMN coding_reviewed_at TEXT;

CREATE INDEX idx_content_validation ON content(coding_validation_status);
CREATE INDEX idx_content_media_fetched ON content(media_fetched_at);

CREATE TABLE coding_reviews (
  id INTEGER PRIMARY KEY,
  content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('APPROVED','EDITED','REJECTED')),
  note TEXT,
  changed_json TEXT NOT NULL DEFAULT '[]',
  ai_run_id INTEGER REFERENCES ai_runs(id),
  reviewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_coding_reviews_content ON coding_reviews(content_id);

-- Every attribute where a human overrode the AI: the AI value, the human value, when.
CREATE VIEW attribute_corrections AS
SELECT h.content_id, h.key, ai.value_text AS ai_value, h.value_text AS human_value, ai.confidence AS ai_confidence, h.created_at AS corrected_at
FROM content_attributes h
JOIN content_attributes ai ON ai.content_id = h.content_id AND ai.key = h.key AND ai.source = 'ai'
WHERE h.source = 'human';

-- Backfill: anything already carrying a thumbnail had its media fetched.
UPDATE content SET media_fetched_at = updated_at WHERE thumb_path IS NOT NULL AND media_fetched_at IS NULL;
UPDATE content SET coded_at = updated_at WHERE coded_at IS NULL AND EXISTS (SELECT 1 FROM content_attributes a WHERE a.content_id = content.id AND a.source = 'ai');
`;

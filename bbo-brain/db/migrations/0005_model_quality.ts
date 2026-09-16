export const name = 'model_quality';

/**
 * Human review becomes a model-quality dataset: every reviewed (post, attribute)
 * pair records the AI's label, the human's label when it differs, and exactly
 * which provider and model produced the AI label.
 */
export const sql = `
DROP VIEW IF EXISTS attribute_corrections;

CREATE VIEW attribute_corrections AS
SELECT h.content_id, h.key, ai.value_text AS ai_value, h.value_text AS human_value, ai.confidence AS ai_confidence,
       h.created_at AS corrected_at, r.provider AS ai_provider, r.model AS ai_model, ai.ai_run_id
FROM content_attributes h
JOIN content_attributes ai ON ai.content_id = h.content_id AND ai.key = h.key AND ai.source = 'ai'
LEFT JOIN ai_runs r ON r.id = ai.ai_run_id
WHERE h.source = 'human';

CREATE VIEW coding_agreement AS
SELECT ai.content_id, ai.key, ai.value_text AS ai_value, h.value_text AS human_value,
       CASE WHEN h.value_text IS NULL OR h.value_text = ai.value_text THEN 1 ELSE 0 END AS agreed,
       r.provider AS ai_provider, r.model AS ai_model, ai.confidence AS ai_confidence, cr.reviewed_at
FROM content_attributes ai
JOIN (SELECT content_id, MAX(reviewed_at) AS reviewed_at FROM coding_reviews WHERE status IN ('APPROVED','EDITED') GROUP BY content_id) cr
  ON cr.content_id = ai.content_id
LEFT JOIN content_attributes h ON h.content_id = ai.content_id AND h.key = ai.key AND h.source = 'human'
LEFT JOIN ai_runs r ON r.id = ai.ai_run_id
WHERE ai.source = 'ai';
`;

export const name = 'true_corrections';

/**
 * A human label that matches the AI's is a confirmation, not a correction.
 * 0005 documented the view as recording the human label "when it differs" but
 * never checked it, so confirming a post's bucket counted as the AI getting it
 * wrong and the review page warned about fields it had in fact got right.
 */
export const sql = `
DROP VIEW IF EXISTS attribute_corrections;

CREATE VIEW attribute_corrections AS
SELECT h.content_id, h.key, ai.value_text AS ai_value, h.value_text AS human_value, ai.confidence AS ai_confidence,
       h.created_at AS corrected_at, r.provider AS ai_provider, r.model AS ai_model, ai.ai_run_id
FROM content_attributes h
JOIN content_attributes ai ON ai.content_id = h.content_id AND ai.key = h.key AND ai.source = 'ai'
LEFT JOIN ai_runs r ON r.id = ai.ai_run_id
WHERE h.source = 'human' AND h.value_text IS NOT ai.value_text;
`;

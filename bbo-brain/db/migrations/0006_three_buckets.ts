export const name = 'three_buckets';

/**
 * Baddie of the Month folds into OTHER_IGNORE (operator decision, 2026-09-17).
 * Only the bucket value changes; provenance, confidence and run links are kept.
 */
export const sql = `
UPDATE content_attributes SET value_text = 'OTHER_IGNORE' WHERE key = 'content_bucket' AND value_text = 'BADDIE_OF_THE_MONTH';
`;

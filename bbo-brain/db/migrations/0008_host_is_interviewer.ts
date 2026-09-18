export const name = 'host_is_interviewer';

/**
 * On a BBO clip the host is the interviewer (operator, 2026-09-18), so the two
 * opening-speaker labels were one person split roughly in half at random. They
 * fold into "interviewer" — the value rule R-015 tests — so every clip a host
 * opens is compared, not only the half that happened to be called interviewer.
 * Only the value changes; provenance, confidence and run links are kept.
 */
export const sql = `
UPDATE content_attributes SET value_text = 'interviewer' WHERE key = 'opening_speaker_role' AND value_text = 'host';
`;

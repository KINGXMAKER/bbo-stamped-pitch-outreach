import { all, parseJson, type Db } from '@/lib/db/client';
import { parsePattern, valuesFor } from '@/lib/intel/patterns';
import type { ContentFact } from '@/lib/intel/dataset';

export type Violation = { ruleId: number; code: string; text: string };

/**
 * A post "violates" an active rule when it carries the attribute value the rule
 * says to avoid (a pattern that expects lower performance), within the rule's
 * franchise scope. Principle-only rules cannot be checked automatically.
 */
export function ruleViolations(db: Db, facts: ContentFact[]): Map<number, Violation[]> {
  const rules = all<{ id: number; code: string; text: string; pattern_json: string | null; applies_to_json: string; direction: string | null }>(
    db,
    `SELECT r.id, r.code, rv.text, r.pattern_json, rv.applies_to_json,
            (SELECT l.direction FROM rule_proposals p JOIN lessons l ON l.id = p.lesson_id WHERE p.pattern_json = r.pattern_json LIMIT 1) AS direction
     FROM rules r JOIN rule_versions rv ON rv.id = r.current_version_id
     WHERE r.status = 'active' AND r.pattern_json IS NOT NULL`
  );
  const out = new Map<number, Violation[]>();
  for (const rule of rules) {
    const pattern = parsePattern(rule.pattern_json);
    if (!pattern) continue;
    const expected = parseJson<{ expected?: string }>(rule.pattern_json, {}).expected ?? (rule.direction === 'negative' ? 'lower' : 'higher');
    if (expected !== 'lower') continue;
    const franchises = parseJson<{ franchises?: string[] }>(rule.applies_to_json, {}).franchises;
    for (const f of facts) {
      if (franchises?.length && (!f.franchise || !franchises.includes(f.franchise))) continue;
      if (pattern.franchise && f.franchise !== pattern.franchise) continue;
      if (!valuesFor(f, pattern.key)?.includes(pattern.group)) continue;
      out.set(f.contentId, [...(out.get(f.contentId) ?? []), { ruleId: rule.id, code: rule.code, text: rule.text }]);
    }
  }
  return out;
}

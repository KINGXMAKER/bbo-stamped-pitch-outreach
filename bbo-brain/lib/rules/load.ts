import { all, parseJson, type Db } from '@/lib/db/client';

export type AppliesTo = { workflows?: string[]; franchises?: string[]; platforms?: string[]; formats?: string[] };

export type ActiveRule = {
  ruleId: number;
  code: string;
  category: string;
  versionId: number;
  version: number;
  text: string;
  appliesTo: AppliesTo;
};

export type RuleContext = { workflow: string; franchise?: string | null; platform?: string | null; format?: string | null };

function allActive(db: Db): ActiveRule[] {
  return all<{ id: number; code: string; category: string; version_id: number; version: number; text: string; applies_to_json: string }>(
    db,
    `SELECT r.id, r.code, r.category, rv.id AS version_id, rv.version, rv.text, rv.applies_to_json
     FROM rules r JOIN rule_versions rv ON rv.id = r.current_version_id
     WHERE r.status = 'active' AND rv.approval_status = 'approved' AND rv.activated_at IS NOT NULL AND rv.deactivated_at IS NULL
     ORDER BY r.code`
  ).map((r) => ({
    ruleId: r.id,
    code: r.code,
    category: r.category,
    versionId: r.version_id,
    version: r.version,
    text: r.text,
    appliesTo: parseJson<AppliesTo>(r.applies_to_json, {}),
  }));
}

function scopeMatches(list: string[] | undefined, value: string | null | undefined): boolean {
  if (!list?.length) return true; // unscoped on this dimension
  if (list.includes('*')) return true;
  return value ? list.includes(value) : false; // scoped rules never leak into unknown contexts
}

/**
 * Only approved, active rule versions whose scope matches the workflow context.
 * A podcast clip editor gets global rules + podcast rules; it never receives
 * rules scoped to another franchise or platform.
 */
export function loadRelevantRules(db: Db, ctx: RuleContext): ActiveRule[] {
  return allActive(db).filter(
    (r) =>
      scopeMatches(r.appliesTo.workflows, ctx.workflow) &&
      scopeMatches(r.appliesTo.franchises, ctx.franchise) &&
      scopeMatches(r.appliesTo.platforms, ctx.platform) &&
      scopeMatches(r.appliesTo.formats, ctx.format)
  );
}

export function allActiveRules(db: Db): ActiveRule[] {
  return allActive(db);
}

export function rulesPromptBlock(rules: ActiveRule[]): string {
  if (!rules.length) return 'ACTIVE BBO RULES: none apply to this workflow.';
  return ['ACTIVE BBO RULES (human-approved; follow them):', ...rules.map((r) => `- [${r.code} v${r.version}] ${r.text}`)].join('\n');
}

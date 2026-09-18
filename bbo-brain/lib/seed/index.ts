import { get, json, run, tx, type Db } from '@/lib/db/client';
import { addAlias } from '@/lib/entities/resolve';
import { syncSkillsFromFiles } from '@/lib/ai/skills';
import { DEFAULT_FORMULA_V1, DEFAULT_THRESHOLDS_V1 } from '@/lib/scoring/formula';
import {
  ATTRIBUTE_DEFINITIONS,
  BBO_HOSTS,
  BRAND_ALIASES,
  DEFAULT_TRIGGERS,
  FRANCHISES,
  INTEGRATIONS,
  PLATFORMS,
  SEED_RULES,
  TOPICS,
} from './reference';

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  analysis_triggers: DEFAULT_TRIGGERS,
  gatekeeper: { passMark: 45, maxAutoRetries: 2 },
  lesson_promotion: {
    // A lesson becomes a rule proposal only with repeated, moderate-or-better evidence.
    minConfidence: 'MODERATE_SIGNAL',
    minSample: 8,
    consecutiveEvaluations: 2,
  },
  rule_challenge: { recentDays: 60, minRecentSample: 8 },
};

/** Idempotent. Safe to run on every boot — reference data only, never metrics. */
export function seedReference(db: Db, root = process.cwd()): void {
  tx(db, () => {
    run(db, `INSERT INTO users (id, display_name, role) VALUES (1, 'King Maker', 'owner') ON CONFLICT DO NOTHING`);

    for (const p of PLATFORMS) {
      run(db, 'INSERT INTO platforms (id, name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING', p.id, p.name);
      addAlias(db, 'platform', p.id, p.name);
      addAlias(db, 'platform', p.id, p.id);
    }
    addAlias(db, 'platform', 'instagram', 'IG');
    addAlias(db, 'platform', 'youtube', 'YT');

    for (const f of FRANCHISES) {
      run(
        db,
        'INSERT INTO franchises (slug, name, description) VALUES (?, ?, ?) ON CONFLICT (slug) DO NOTHING',
        f.slug,
        f.name,
        f.description
      );
      const id = get<{ id: number }>(db, 'SELECT id FROM franchises WHERE slug = ?', f.slug)!.id;
      for (const alias of [f.name, ...f.aliases]) addAlias(db, 'franchise', id, alias);
    }

    for (const [slug, name] of TOPICS) {
      run(db, 'INSERT INTO topics (slug, name) VALUES (?, ?) ON CONFLICT (slug) DO NOTHING', slug, name);
    }
    for (const [slug, name, parent, keywords] of TOPICS) {
      const id = get<{ id: number }>(db, 'SELECT id FROM topics WHERE slug = ?', slug)!.id;
      if (parent) {
        run(db, 'UPDATE topics SET parent_id = (SELECT id FROM topics WHERE slug = ?) WHERE id = ? AND parent_id IS NULL', parent, id);
      }
      for (const alias of [name, ...keywords]) addAlias(db, 'topic', id, alias);
    }

    for (const alias of BRAND_ALIASES) addAlias(db, 'brand', 'bbo', alias);

    for (const a of ATTRIBUTE_DEFINITIONS) {
      run(
        db,
        `INSERT INTO attribute_definitions (key, label, value_type, allowed_values_json, attr_group, description, is_comparable)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET label = excluded.label, value_type = excluded.value_type,
           allowed_values_json = excluded.allowed_values_json, attr_group = excluded.attr_group,
           description = excluded.description, is_comparable = excluded.is_comparable`,
        a.key,
        a.label,
        a.type,
        a.values ? json(a.values) : null,
        a.group,
        a.description ?? null,
        a.comparable === false ? 0 : 1
      );
    }

    if (!get(db, `SELECT 1 FROM performance_score_versions WHERE version = 'v1'`)) {
      run(
        db,
        `INSERT INTO performance_score_versions (version, formula_json, label_thresholds_json, notes, is_active)
         VALUES ('v1', ?, ?, ?, ?)`,
        json(DEFAULT_FORMULA_V1),
        json(DEFAULT_THRESHOLDS_V1),
        'Initial formula. Weighted geometric mean of ratios to peer-group medians. Follows weight 0: not exposed per Reel by Instagram.',
        get(db, 'SELECT 1 FROM performance_score_versions WHERE is_active = 1') ? 0 : 1
      );
    }

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      run(db, 'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO NOTHING', key, json(value));
    }

    for (const i of INTEGRATIONS) {
      run(
        db,
        `INSERT INTO integrations (id, name, provider, status, capabilities_json, limitations_json)
         VALUES (?, ?, ?, 'not_connected', ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, provider = excluded.provider,
           capabilities_json = excluded.capabilities_json, limitations_json = excluded.limitations_json`,
        i.id,
        i.name,
        i.provider,
        json(i.capabilities),
        json(i.limitations)
      );
    }

    for (const rule of SEED_RULES) {
      if (get(db, 'SELECT 1 FROM rules WHERE code = ?', rule.code)) continue;
      const { lastId: ruleId } = run(
        db,
        'INSERT INTO rules (code, category, status, pattern_json) VALUES (?, ?, ?, ?)',
        rule.code,
        rule.category,
        'active',
        rule.pattern ? json(rule.pattern) : null
      );
      const scoped = Boolean(rule.appliesTo.franchises?.length || rule.appliesTo.platforms?.length || rule.appliesTo.formats?.length);
      const { lastId: versionId } = run(
        db,
        `INSERT INTO rule_versions (rule_id, version, text, reason, scope, applies_to_json, proposed_by, approval_status, activated_at)
         VALUES (?, 1, ?, ?, ?, ?, 'seed', 'approved', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
        ruleId,
        rule.text,
        'Initial BBO operating rule supplied by King Maker.',
        scoped ? 'scoped' : 'global',
        json(rule.appliesTo)
      );
      run(db, 'UPDATE rules SET current_version_id = ? WHERE id = ?', versionId, ruleId);
    }
    // Seed rules nobody has revised keep tracking the current seed pattern definition.
    for (const rule of SEED_RULES) {
      if (!rule.pattern) continue;
      run(
        db,
        `UPDATE rules SET pattern_json = ? WHERE code = ? AND NOT EXISTS (SELECT 1 FROM rule_versions rv WHERE rv.rule_id = rules.id AND rv.proposed_by != 'seed')`,
        json(rule.pattern),
        rule.code
      );
    }

    seedHosts(db);
  });

  syncSkillsFromFiles(db, root);
}

/** BBO's hosts are hosts wherever a caption tagged them — never guests in a guest comparison. */
function seedHosts(db: Db): void {
  for (const h of BBO_HOSTS) {
    const existing = get<{ id: number }>(db, 'SELECT id FROM people WHERE instagram_handle = ? OR canonical_name = ?', h.handle, `@${h.handle}`);
    const id =
      existing?.id ??
      run(db, `INSERT INTO people (slug, canonical_name, type, instagram_handle) VALUES (?, ?, 'host', ?)`, h.handle, `@${h.handle}`, h.handle).lastId;
    run(
      db,
      `UPDATE people SET type = 'host', gender = ?, instagram_handle = COALESCE(instagram_handle, ?), notes = COALESCE(notes, ?) WHERE id = ?`,
      h.gender,
      h.handle,
      h.note,
      id
    );
    addAlias(db, 'person', id, `@${h.handle}`);
    run(
      db,
      `INSERT OR IGNORE INTO content_people (content_id, person_id, role, source, confidence)
       SELECT content_id, person_id, 'host', source, confidence FROM content_people WHERE person_id = ? AND role = 'guest'`,
      id
    );
    run(db, `DELETE FROM content_people WHERE person_id = ? AND role = 'guest'`, id);
  }
}

export function getSetting<T>(db: Db, key: string): T {
  const row = get<{ value_json: string }>(db, 'SELECT value_json FROM settings WHERE key = ?', key);
  if (!row) return DEFAULT_SETTINGS[key] as T;
  return JSON.parse(row.value_json) as T;
}

export function setSetting(db: Db, key: string, value: unknown): void {
  tx(db, () => {
    run(
      db,
      `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      key,
      json(value)
    );
    run(db, 'INSERT INTO settings_history (key, value_json) VALUES (?, ?)', key, json(value));
  });
}

/**
 * 0001 — BBO BRAIN core schema.
 *
 * Written for SQLite (node:sqlite) but deliberately portable: no SQLite-only
 * column tricks beyond INTEGER PRIMARY KEY and FTS5. Timestamps are ISO-8601
 * UTC strings. JSON columns hold only provider payloads, AI metadata and
 * flexible evidence — every field the product filters or sorts on is a column.
 */
export const name = 'init';

export const sql = /* sql */ `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE settings_history (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Reference entities ───────────────────────────────────────────────────
CREATE TABLE platforms (
  id TEXT PRIMARY KEY,               -- 'instagram', 'tiktok', 'youtube'
  name TEXT NOT NULL
);

CREATE TABLE franchises (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE topics (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  description TEXT
);
CREATE INDEX idx_topics_parent ON topics(parent_id);

CREATE TABLE people (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  canonical_name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'guest'
    CHECK (type IN ('guest','host','cast','creator','editor','other')),
  gender TEXT CHECK (gender IN ('female','male','nonbinary','unknown')),
  instagram_handle TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_people_ig ON people(instagram_handle) WHERE instagram_handle IS NOT NULL;

-- Canonical-name lookup for every resolvable entity type.
CREATE TABLE entity_aliases (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('person','topic','franchise','platform','brand')),
  entity_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  alias_norm TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'seed',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (entity_type, alias_norm)
);
CREATE INDEX idx_aliases_entity ON entity_aliases(entity_type, entity_id);

-- Questionable matches wait here for a human. Nothing merges silently.
CREATE TABLE entity_resolution_candidates (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  raw_value TEXT NOT NULL,
  raw_norm TEXT NOT NULL,
  suggested_entity_id TEXT,
  similarity REAL,
  context_content_id INTEGER REFERENCES content(id) ON DELETE SET NULL,
  context TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','merged','created','ignored')),
  resolved_entity_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at TEXT
);
CREATE UNIQUE INDEX idx_erc_pending ON entity_resolution_candidates(entity_type, raw_norm) WHERE status = 'pending';

-- ── Content ──────────────────────────────────────────────────────────────
-- A content record is the creative piece. Its publications live in
-- platform_posts, so one clip cross-posted to three platforms is one content
-- row with three posts, each with its own native caption and metrics.
CREATE TABLE content (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft','scheduled','published','archived','deleted')),
  format TEXT,                        -- reel | carousel | image | video | story | short
  franchise_id INTEGER REFERENCES franchises(id) ON DELETE SET NULL,
  series TEXT,
  episode_ref TEXT,
  asset_ref TEXT,                     -- local media path or storage key
  thumb_path TEXT,                    -- local first-frame thumbnail (platform CDN URLs expire)
  frames_json TEXT,                   -- [{atS, path}] hook frames for analysis
  duration_s REAL,
  original_footage_length_s REAL,
  primary_post_id INTEGER,            -- set after the first platform_post is written
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_content_franchise ON content(franchise_id);
CREATE INDEX idx_content_status ON content(status);

CREATE TABLE platform_posts (
  id INTEGER PRIMARY KEY,
  content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  external_id TEXT NOT NULL,
  source_url TEXT,
  media_type TEXT,
  media_product_type TEXT,
  caption TEXT,
  thumbnail_url TEXT,
  published_at TEXT,
  posting_dow INTEGER,                -- 0=Sunday, America/New_York
  posting_hour INTEGER,               -- 0-23, America/New_York
  raw_json TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_synced_at TEXT,
  UNIQUE (platform_id, external_id)   -- the dedupe key for every sync
);
CREATE INDEX idx_posts_content ON platform_posts(content_id);
CREATE INDEX idx_posts_published ON platform_posts(platform_id, published_at);

-- Registry of extensible content attributes. New attributes are rows, not migrations.
CREATE TABLE attribute_definitions (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('text','number','boolean','enum')),
  allowed_values_json TEXT,
  attr_group TEXT NOT NULL DEFAULT 'structure',
  description TEXT,
  is_comparable INTEGER NOT NULL DEFAULT 1   -- included in pattern mining
);

-- One value per (content, attribute, source). The current value is picked by
-- source precedence in content_attribute_current (human > measured > ai > ...).
CREATE TABLE content_attributes (
  id INTEGER PRIMARY KEY,
  content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  key TEXT NOT NULL REFERENCES attribute_definitions(key),
  value_text TEXT,
  value_num REAL,
  source TEXT NOT NULL CHECK (source IN ('human','measured','ai','audit_v2','heuristic')),
  confidence REAL,
  ai_run_id INTEGER REFERENCES ai_runs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (content_id, key, source)
);
CREATE INDEX idx_attr_key_value ON content_attributes(key, value_text);

CREATE VIEW content_attribute_current AS
SELECT content_id, key, value_text, value_num, source, confidence FROM (
  SELECT ca.*, ROW_NUMBER() OVER (
    PARTITION BY content_id, key
    ORDER BY CASE source WHEN 'human' THEN 0 WHEN 'measured' THEN 1 WHEN 'ai' THEN 2
                         WHEN 'audit_v2' THEN 3 ELSE 4 END, created_at DESC
  ) AS rn FROM content_attributes ca
) WHERE rn = 1;

CREATE TABLE transcripts (
  id INTEGER PRIMARY KEY,
  content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  source TEXT NOT NULL,               -- whisper_cpp | manual | platform
  model TEXT,
  language TEXT,
  text TEXT NOT NULL,
  segments_json TEXT,                 -- [{start, end, text}]
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (content_id, source)
);

CREATE TABLE content_people (
  content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('guest','host','cast','creator','editor','mentioned','opening_speaker')),
  source TEXT NOT NULL DEFAULT 'heuristic',
  confidence REAL,
  PRIMARY KEY (content_id, person_id, role)
);
CREATE INDEX idx_cp_person ON content_people(person_id);

CREATE TABLE content_topics (
  content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  is_primary INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'heuristic',
  confidence REAL,
  PRIMARY KEY (content_id, topic_id)
);
CREATE INDEX idx_ct_topic ON content_topics(topic_id);

CREATE TABLE content_comments (
  id INTEGER PRIMARY KEY,
  platform_post_id INTEGER NOT NULL REFERENCES platform_posts(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  text TEXT,
  like_count INTEGER,
  commented_at TEXT,
  fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (platform_post_id, external_id)
);

-- ── Performance ──────────────────────────────────────────────────────────
-- Append-only. A metric snapshot is never overwritten; curves come from history.
CREATE TABLE content_metrics (
  id INTEGER PRIMARY KEY,
  platform_post_id INTEGER NOT NULL REFERENCES platform_posts(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  value REAL,
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL,               -- composio_instagram | audit_archive | derived | manual
  UNIQUE (platform_post_id, metric, observed_at, source)
);
CREATE INDEX idx_metrics_post_metric ON content_metrics(platform_post_id, metric, observed_at);

CREATE VIEW content_metric_latest AS
SELECT platform_post_id, metric, value, observed_at, source FROM (
  SELECT m.*, ROW_NUMBER() OVER (PARTITION BY platform_post_id, metric ORDER BY observed_at DESC, id DESC) AS rn
  FROM content_metrics m WHERE value IS NOT NULL
) WHERE rn = 1;

CREATE TABLE account_metrics (
  id INTEGER PRIMARY KEY,
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  metric TEXT NOT NULL,
  value REAL,
  -- '' (not NULL) when a point has no period: SQLite treats NULLs as distinct in
  -- UNIQUE, which would let a re-import duplicate account totals.
  period_start TEXT NOT NULL DEFAULT '',
  period_end TEXT NOT NULL DEFAULT '',
  breakdown_json TEXT,
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL,
  UNIQUE (platform_id, metric, period_start, period_end, observed_at, source)
);

CREATE TABLE performance_score_versions (
  id INTEGER PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  formula_json TEXT NOT NULL,
  label_thresholds_json TEXT NOT NULL,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE performance_scores (
  platform_post_id INTEGER NOT NULL REFERENCES platform_posts(id) ON DELETE CASCADE,
  score_version_id INTEGER NOT NULL REFERENCES performance_score_versions(id),
  score REAL,
  label TEXT,                          -- BREAKOUT | WINNER | ABOVE_AVERAGE | AVERAGE | BELOW_AVERAGE | LOSER | IMMATURE | UNSCORED
  components_json TEXT NOT NULL,
  baseline_group TEXT NOT NULL,
  peer_n INTEGER NOT NULL,
  coverage REAL NOT NULL,
  percentile REAL,
  is_mature INTEGER NOT NULL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (platform_post_id, score_version_id)
);
CREATE INDEX idx_scores_label ON performance_scores(score_version_id, label);

-- ── AI system ────────────────────────────────────────────────────────────
CREATE TABLE skills (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT
);

CREATE TABLE skill_versions (
  id INTEGER PRIMARY KEY,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  checksum TEXT NOT NULL,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (skill_id, version)
);

CREATE TABLE prompt_versions (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL,
  version INTEGER NOT NULL,
  template TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (slug, version),
  UNIQUE (slug, checksum)
);

-- Every model call. Concise inputs/outputs only — never chain-of-thought.
CREATE TABLE ai_runs (
  id INTEGER PRIMARY KEY,
  workflow TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','error')),
  provider TEXT,
  model TEXT,
  prompt_version_id INTEGER REFERENCES prompt_versions(id),
  skill_version_id INTEGER REFERENCES skill_versions(id),
  score_version_id INTEGER REFERENCES performance_score_versions(id),
  input_json TEXT NOT NULL,           -- content ids, evidence record ids, parameters
  output_json TEXT,
  confidence TEXT,
  approval_state TEXT,
  error TEXT,
  latency_ms INTEGER,
  usage_json TEXT,
  parent_run_id INTEGER REFERENCES ai_runs(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_ai_runs_workflow ON ai_runs(workflow, created_at);

CREATE TABLE content_analyses (
  id INTEGER PRIMARY KEY,
  content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  platform_post_id INTEGER REFERENCES platform_posts(id) ON DELETE SET NULL,
  ai_run_id INTEGER REFERENCES ai_runs(id),
  trigger_reasons_json TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('winner','loser','notable')),
  evidence_basis TEXT NOT NULL,       -- transcript+caption | caption_only | video
  actual_topic TEXT,
  underlying_debate TEXT,
  emotional_trigger TEXT,
  hook_mechanics TEXT,
  tension TEXT,
  payoff TEXT,
  dead_setup TEXT,
  reaction_timing TEXT,
  speaker_dynamics TEXT,
  comment_trigger TEXT,
  share_trigger TEXT,
  curiosity_trigger TEXT,
  outcome_explanation TEXT,
  strongest_moment_json TEXT,
  strongest_opening_json TEXT,
  strongest_standalone_json TEXT,
  retention_strengths_json TEXT,
  retention_weaknesses_json TEXT,
  editing_opportunities_json TEXT,
  reusable_lesson TEXT,
  recommended_experiment TEXT,
  confidence TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_analyses_content ON content_analyses(content_id);

CREATE TABLE edit_sessions (
  id INTEGER PRIMARY KEY,
  content_id INTEGER REFERENCES content(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  platform_id TEXT REFERENCES platforms(id),
  franchise_id INTEGER REFERENCES franchises(id),
  source_transcript TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','passed','needs_human','human_approved','human_rejected','error')),
  attempts INTEGER NOT NULL DEFAULT 0,
  final_total INTEGER,
  published_content_id INTEGER REFERENCES content(id) ON DELETE SET NULL,
  human_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE gatekeeper_reviews (
  id INTEGER PRIMARY KEY,
  edit_session_id INTEGER NOT NULL REFERENCES edit_sessions(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  editor_run_id INTEGER REFERENCES ai_runs(id),
  gatekeeper_run_id INTEGER REFERENCES ai_runs(id),
  edit_plan_json TEXT NOT NULL,
  hook INTEGER, clarity INTEGER, tension INTEGER, payoff INTEGER,
  shareability INTEGER, comment_potential INTEGER,
  total INTEGER,
  auto_fails_json TEXT NOT NULL DEFAULT '[]',
  passed INTEGER NOT NULL,
  failure_reasons_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (edit_session_id, attempt)
);

-- ── Learning system ──────────────────────────────────────────────────────
CREATE TABLE experiments (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  variable_key TEXT REFERENCES attribute_definitions(key),
  control_value TEXT,
  variant_value TEXT,
  primary_metric TEXT NOT NULL,
  secondary_metrics_json TEXT NOT NULL DEFAULT '[]',
  platform_id TEXT REFERENCES platforms(id),
  franchise_id INTEGER REFERENCES franchises(id),
  topic_id INTEGER REFERENCES topics(id),
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','running','completed','abandoned')),
  min_sample_per_arm INTEGER NOT NULL DEFAULT 5,
  start_date TEXT,
  end_date TEXT,
  result_json TEXT,
  result_summary TEXT,
  sample_size INTEGER,
  confidence_label TEXT,
  lesson_id INTEGER REFERENCES lessons(id),
  rule_proposal_id INTEGER REFERENCES rule_proposals(id),
  origin TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE experiment_content (
  experiment_id INTEGER NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  arm TEXT NOT NULL CHECK (arm IN ('control','variant')),
  assigned_by TEXT NOT NULL CHECK (assigned_by IN ('auto','human')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (experiment_id, content_id)
);

CREATE TABLE lessons (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  text TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEW'
    CHECK (status IN ('NEW','OBSERVING','SUPPORTED','WEAKENED','CONTRADICTED','PROMOTED_TO_RULE','ARCHIVED')),
  confidence_label TEXT NOT NULL DEFAULT 'INSUFFICIENT_DATA'
    CHECK (confidence_label IN ('INSUFFICIENT_DATA','EARLY_SIGNAL','MODERATE_SIGNAL','STRONG_SIGNAL')),
  origin TEXT NOT NULL CHECK (origin IN ('pattern_mining','ai_analysis','experiment','imported_audit','human')),
  pattern_json TEXT,                  -- machine-checkable definition; null = not re-evaluable
  direction TEXT CHECK (direction IN ('positive','negative','mixed')),
  comparison_group TEXT,
  sample_size INTEGER,
  effect REAL,                        -- ratio of group median to comparison median
  metrics_json TEXT,
  evidence TEXT,
  caveat TEXT,
  next_test TEXT,
  source_content_id INTEGER REFERENCES content(id) ON DELETE SET NULL,
  related_experiment_id INTEGER REFERENCES experiments(id) ON DELETE SET NULL,
  related_rule_id INTEGER REFERENCES rules(id) ON DELETE SET NULL,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_evaluated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_lessons_pattern ON lessons(pattern_json) WHERE pattern_json IS NOT NULL;

CREATE TABLE lesson_content (
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('source','supporting','contradicting')),
  PRIMARY KEY (lesson_id, content_id, relation)
);

-- Belief history: how every lesson's status and confidence moved over time.
CREATE TABLE lesson_events (
  id INTEGER PRIMARY KEY,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  from_confidence TEXT,
  to_confidence TEXT NOT NULL,
  sample_size INTEGER,
  effect REAL,
  note TEXT,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_lesson_events_time ON lesson_events(occurred_at);

CREATE TABLE rules (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  current_version_id INTEGER,
  pattern_json TEXT,                  -- machine-checkable evidence query; null = principle, not testable
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE rule_versions (
  id INTEGER PRIMARY KEY,
  rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  text TEXT NOT NULL,
  reason TEXT,
  scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global','scoped')),
  applies_to_json TEXT NOT NULL DEFAULT '{}',   -- {workflows,franchises,platforms,formats}
  evidence_summary TEXT,
  sample_size INTEGER,
  confidence_label TEXT,
  proposed_by TEXT NOT NULL CHECK (proposed_by IN ('seed','ai','human')),
  proposal_id INTEGER REFERENCES rule_proposals(id),
  approval_status TEXT NOT NULL CHECK (approval_status IN ('approved','rejected')),
  proposed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  activated_at TEXT,
  deactivated_at TEXT,
  superseded_by_version_id INTEGER REFERENCES rule_versions(id),
  UNIQUE (rule_id, version)
);

CREATE TABLE rule_content (
  rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('supporting','contradicting','violation')),
  PRIMARY KEY (rule_id, content_id, relation)
);

CREATE TABLE ai_run_rules (
  ai_run_id INTEGER NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  rule_version_id INTEGER NOT NULL REFERENCES rule_versions(id),
  PRIMARY KEY (ai_run_id, rule_version_id)
);

CREATE TABLE rule_proposals (
  id INTEGER PRIMARY KEY,
  proposed_text TEXT NOT NULL,
  category TEXT NOT NULL,
  applies_to_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL,
  lesson_id INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
  target_rule_id INTEGER REFERENCES rules(id) ON DELETE SET NULL,
  pattern_json TEXT,
  supporting_json TEXT NOT NULL DEFAULT '[]',
  contradicting_json TEXT NOT NULL DEFAULT '[]',
  metric_difference_json TEXT,
  sample_size INTEGER,
  confidence_label TEXT,
  affected_rule_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','edited_approved','rejected','observing')),
  decided_text TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  decided_at TEXT
);
CREATE UNIQUE INDEX idx_proposals_lesson_pending ON rule_proposals(lesson_id) WHERE status = 'pending';

CREATE TABLE rule_challenges (
  id INTEGER PRIMARY KEY,
  rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  rule_version_id INTEGER NOT NULL REFERENCES rule_versions(id),
  summary TEXT NOT NULL,
  new_evidence_json TEXT NOT NULL,
  supporting_json TEXT NOT NULL DEFAULT '[]',
  contradicting_json TEXT NOT NULL DEFAULT '[]',
  sample_size INTEGER,
  confidence_label TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','kept','narrowed','replaced','deactivated','observing')),
  decision_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  decided_at TEXT
);
CREATE UNIQUE INDEX idx_challenges_open ON rule_challenges(rule_id) WHERE status = 'open';

-- ── Reviews & opportunities ──────────────────────────────────────────────
CREATE TABLE weekly_reviews (
  id INTEGER PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  narrative_json TEXT,
  ai_run_id INTEGER REFERENCES ai_runs(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (period_start, period_end)
);

CREATE TABLE monthly_reviews (
  id INTEGER PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  narrative_json TEXT,
  ai_run_id INTEGER REFERENCES ai_runs(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (period_start, period_end)
);

CREATE TABLE content_opportunities (
  id INTEGER PRIMARY KEY,
  batch_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  why TEXT NOT NULL,
  supporting_json TEXT NOT NULL DEFAULT '[]',
  sample_size INTEGER NOT NULL,
  confidence_label TEXT NOT NULL,
  recommendation_json TEXT NOT NULL,
  experiment_json TEXT,
  priority REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','dismissed','made')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_opps_batch ON content_opportunities(batch_id, priority);

-- ── Sync engine ──────────────────────────────────────────────────────────
CREATE TABLE integrations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('connected','not_connected','needs_attention')),
  account_ref TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  limitations_json TEXT NOT NULL DEFAULT '[]',
  last_sync_at TEXT,
  last_success_at TEXT,
  records_synced INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sync_jobs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','partial','failed')),
  params_json TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 1,
  records_seen INTEGER NOT NULL DEFAULT 0,
  records_written INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  log_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX idx_jobs_kind ON sync_jobs(kind, started_at);

-- ── Knowledge graph ──────────────────────────────────────────────────────
CREATE TABLE graph_edges (
  id INTEGER PRIMARY KEY,
  src_type TEXT NOT NULL,
  src_id TEXT NOT NULL,
  rel TEXT NOT NULL,
  dst_type TEXT NOT NULL,
  dst_id TEXT NOT NULL,
  weight REAL,
  evidence_json TEXT,
  computed_at TEXT NOT NULL,
  UNIQUE (src_type, src_id, rel, dst_type, dst_id)
);
CREATE INDEX idx_edges_src ON graph_edges(src_type, src_id);
CREATE INDEX idx_edges_dst ON graph_edges(dst_type, dst_id);

-- ── Search ───────────────────────────────────────────────────────────────
CREATE VIRTUAL TABLE search_index USING fts5(
  entity_type UNINDEXED, entity_id UNINDEXED, title, body, tokenize = 'porter unicode61'
);
`;

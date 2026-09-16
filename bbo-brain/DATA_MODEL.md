# Data model

Schema: `db/migrations/0001_init.ts` (SQLite via `node:sqlite`). Timestamps are ISO-8601 UTC strings. JSON columns hold provider payloads, AI metadata and flexible evidence only — anything filtered or sorted on is a column.

## Content

| Table | Purpose | Invariants |
|---|---|---|
| `content` | The creative piece: title, status, format, franchise, duration, media refs, `is_demo` | One row per piece, however many platforms it is on. `franchise_id` mirrors the highest-precedence `franchise` attribute. |
| `platform_posts` | A publication of content on a platform: external id, URL, caption, posting day/hour (New York) | **`UNIQUE(platform_id, external_id)`** — the dedupe key for every sync. |
| `attribute_definitions` | Registry of extensible attributes (type, allowed values, group, comparable) | New attributes are rows, not migrations. |
| `content_attributes` | One value per `(content, key, source)` with confidence and the AI run that set it | Sources: `human`, `measured`, `ai`, `audit_v2`, `heuristic`. |
| `content_attribute_current` (view) | The winning value per attribute | Precedence **human > measured > ai > audit_v2 > heuristic**. A re-sync can never undo a human decision. |
| `transcripts` | Text + timestamped segments per content and source | `UNIQUE(content_id, source)`. |
| `content_people`, `content_topics` | Guests/hosts/editors and topics per content, with source + confidence | |
| `content_comments` | Comment text | `UNIQUE(post, external_id)`; archive comments use a content hash id. |

## Performance

| Table | Purpose | Invariants |
|---|---|---|
| `content_metrics` | **Append-only** metric snapshots: post, metric, value, observed_at, source | `UNIQUE(post, metric, observed_at, source)`. Never updated or deleted. Missing metrics are absent, never zero. |
| `content_metric_latest` (view) | Latest non-null value per post and metric | |
| `account_metrics` | Account-level points (net follower change, reach, demographics breakdowns) | Period columns are `''` not NULL so UNIQUE holds (SQLite treats NULLs as distinct). |
| `performance_score_versions` | Versioned formula + label thresholds | Formulas are never edited; create a new version. One active. |
| `performance_scores` | Score, label, per-component peer ratios, baseline group, peer n, coverage, percentile | Derived: replaced wholesale per version from the metric history. |

## AI

| Table | Purpose |
|---|---|
| `skills`, `skill_versions` | Versioned skill bodies (files are mirrors); one active version per skill. |
| `prompt_versions` | Versioned prompt templates, deduplicated by checksum. |
| `ai_runs` | Every model call: workflow, status, provider, model, prompt/skill/score versions, inputs, validated output, confidence, error, latency, usage, parent run. No chain-of-thought. |
| `ai_run_rules` | The exact rule versions each run received. |
| `content_analyses` | Structured winner/loser analyses (topic, debate, hook mechanics, strongest moments, retention strengths/weaknesses, triggers…). |
| `edit_sessions`, `gatekeeper_reviews` | Editor → Gatekeeper attempts with every plan, score, auto-fail, failure reason and the human decision; `published_content_id` links an edit to its real performance. |

## Learning

| Table | Purpose | Invariants |
|---|---|---|
| `lessons` | Observation + evidence + sample size + effect + confidence + status + origin | `pattern_json` is unique when present (one lesson per machine-checkable claim). |
| `lesson_content` | Source / supporting / contradicting posts | |
| `lesson_events` | **Belief history**: every status/confidence change with time and reason | Powers “what did we believe that we no longer believe?”. |
| `rules`, `rule_versions` | Rule identity + versioned text, scope, evidence summary, provenance, activation/deactivation, supersession | Only an approved decision creates an active version. |
| `rule_content` | Supporting / contradicting / violating posts | |
| `rule_proposals` | Proposed rule with why, evidence, metric difference, sample, confidence, scope, affected rules, decision | One pending proposal per lesson. |
| `rule_challenges` | New evidence against an active rule, with the human resolution | One open challenge per rule. |
| `experiments`, `experiment_content` | Hypothesis, variable, control/variant, metrics, scope, arms, result, lesson | Human assignments are never overwritten by auto-assignment. |

## Reviews, opportunities, system

| Table | Purpose |
|---|---|
| `weekly_reviews`, `monthly_reviews` | Evidence JSON + narrative per period; `UNIQUE(period_start, period_end)` so a re-run updates the same period. |
| `content_opportunities` | Ranked opportunity batches; dismissals carry across batches. |
| `people`, `topics`, `franchises`, `platforms` | Reference entities. Topics have a `parent_id` hierarchy. |
| `entity_aliases` | Canonical-name lookup per entity type (`UNIQUE(type, alias_norm)`). |
| `entity_resolution_candidates` | Near-matches awaiting a human (one pending per normalized value). |
| `integrations`, `sync_jobs` | Connection status/limitations and the job log. |
| `graph_edges` | Materialised relationships (`src → rel → dst`) with weight and evidence. |
| `search_index` | FTS5 over content, transcripts, people, topics, lessons, rules, experiments, analyses. |
| `settings`, `settings_history`, `users` | Triggers, Gatekeeper settings, lesson promotion thresholds — with history. |

## Migrations

Forward-only. Add `db/migrations/000N_name.ts` exporting `name` and `sql`, and register it in `db/migrations/index.ts`. `openDb()` applies pending migrations in a transaction and records them in `schema_migrations`. Never edit an applied migration.

## Porting to Postgres

The schema avoids SQLite-only features apart from `INTEGER PRIMARY KEY`, `strftime` defaults, partial unique indexes (supported in Postgres) and FTS5 (replace with `tsvector`). `lib/db/client.ts` is the only module that talks to the driver (`all/get/run/tx`), so a Postgres port is a client swap plus migration translation.

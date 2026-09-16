# Architecture

## Decisions

| Decision | Why |
|---|---|
| **New app at `bbo-brain/`**, not inside `bbo-stamped` or the pitch app | `bbo-stamped` is a shoot-day venue tool with IndexedDB storage; the pitch app is outreach. BBO BRAIN is about content, needs server-side persistence and jobs, and must not touch pitch/CRM code. |
| **Next.js 16 (App Router) + React 19 + zod + vitest** | Same stack as `bbo-stamped`, so conventions, tokens and tooling carry over. |
| **SQLite via Node's built-in `node:sqlite`** (local-first) | Zero native dependencies, FTS5 search, WAL concurrency, one file to back up. The project's Supabase exposes only PostgREST with pitch tables — no DDL access for migrations. The schema is portable SQL (see DATA_MODEL.md). |
| **Composio over REST** (`/api/v3/tools/execute/proxy`) | No Python bridge; one code path for media, insights, comments and account data; errors classified from structured fields. |
| **Gemini over REST** with a model fallback chain | Keys already in the repo `.env`; multimodal (hook frames). |
| **whisper.cpp + ffmpeg locally** | Free, private, already installed. |

## Layers

```
app/                 UI (server components read the DB directly) + server actions + /api/jobs, /api/media, /api/unlock
components/          UI primitives, charts (server SVG), client islands (job buttons, Ask console, graph view)
lib/
  adapters/          provider-neutral interfaces + Composio/Instagram, media (ffmpeg), whisper.cpp
  ingest/            upsert posts, append metrics, attributes with provenance, caption heuristics, archive + learning imports
  scoring/           formula (pure), engine (peer baselines, versioned scores), context sentences
  intel/             dataset (evidence table), stats, patterns, lessons, analysis, gatekeeper, experiments,
                     opportunities, reviews, ask, graph, search, similar, queries (page data)
  rules/             rule loading by scope, proposals/approvals/challenges, violations
  ai/                Gemini provider, runAi (provenance), skills (versioned)
  entities/          normalisation + alias resolution + human review
  sync/              job runner (locks, retries, logs), registry + daily pipeline, Instagram sync
  seed/              reference data: franchises, topics, attributes, 15 founding rules, score v1, triggers, integrations
db/migrations/       forward-only TS migrations
skills/  knowledge/  versioned skill files, generated CONSTRAINTS.md
scripts/             with-env launcher, migrate, job CLI, launchd template
```

**Evidence flows one way.** Adapters → ingest tables → scores → `loadFacts()` (the evidence table) → intelligence modules → UI. AI never produces evidence; it receives packages the code calculated and returns structured interpretations that are stored separately (`content_analyses`, `ai_runs`).

## Runtime

- **Pages** are dynamic server components (`dynamic = 'force-dynamic'`) that call `getDb()` — a process-wide `node:sqlite` handle kept on `globalThis` across hot reloads.
- **Human decisions** (approve rule, resolve challenge, merge entity, start experiment, override an attribute…) are server actions in `app/actions.ts`. Each redirects back with a notice or the error text.
- **Long jobs** start via `POST /api/jobs` and run in the background inside the Node process; the UI polls `GET /api/jobs?kind=`. The CLI (`npm run job -- <kind>`) runs the same registry.
- **Environment**: `scripts/with-env.mjs` loads `../.env` then `.env.local` before starting Next or tsx. (Node rejects `--env-file` inside `NODE_OPTIONS`, which Next's worker processes inherit.)
- **Security**: binds to `127.0.0.1`. Set `BRAIN_ACCESS_PASSWORD` before exposing it (e.g. on Tailscale) — `proxy.ts` then gates every page and API. No secret is ever `NEXT_PUBLIC_`. Thumbnails are served only from inside the media directory.

## Sync engine

`lib/sync/jobs.ts` wraps every job: a `sync_jobs` row, a one-at-a-time lock per kind (stale locks released after 2h), up to 3 attempts for transient source errors, capped logs, and integration status updates. Jobs are idempotent: posts dedupe on `(platform, external_id)`, metric snapshots on `(post, metric, observed_at, source)`, comments on `(post, external_id)`, archive imports and learning imports on stable ids/codes.

Daily pipeline: `instagram-content → instagram-metrics → instagram-account → media-transcripts → score → ai-enrich → analyze → mine-lessons → rule-proposals → rule-challenges → experiments → opportunities → graph → search`. If content or metrics sync fails, later steps are skipped rather than reasoning over stale data.

## How to extend

**Another social platform** (e.g. TikTok once connected in Composio)
1. Implement `ContentSourceAdapter` + `AnalyticsSourceAdapter` in `lib/adapters/<platform>.ts`, mapping provider fields onto `CANONICAL_METRICS`.
2. Add a sync module like `lib/sync/instagram.ts` and register jobs in `lib/sync/registry.ts`.
3. The platform row and integration card already exist in `lib/seed/reference.ts`. Scoring baselines are per platform automatically.

**Another metric**
1. Add it to `CANONICAL_METRICS` and the adapter's metric map. Snapshots start accruing on the next sync.
2. To score it, add a component in `lib/scoring/formula.ts` (`ComponentKey`, `deriveComponents`, label) and **create a new score version** (Performance page) — never edit v1.
3. To mine it, add a relative key in `lib/intel/dataset.ts` and include it in `MINING_METRICS`.

**Another AI skill**
1. Add `skills/<slug>/SKILL.md` and the slug to `SKILL_SLUGS` in `lib/ai/skills.ts` (imported as version 1 on next boot).
2. Call it through `runAi()` with `skillVersionId` so every run records the version.

**Another rule type** — rules are data. Give a rule a machine-checkable `pattern_json` `{key, group, compare?, metric, expected}` to make it testable and challengeable; scope it with `applies_to_json` `{workflows, franchises, platforms, formats}`. New workflow names just need to be passed to `loadRelevantRules()`.

**Another experiment** — create it in the UI or with `createExperiment()`. Experiments on an attribute auto-assign; others take human assignment.

**Another content attribute** — add an entry to `ATTRIBUTE_DEFINITIONS` (key, type, allowed values, group). No migration: attributes are rows. Comparable enum/boolean attributes are mined automatically; AI coding picks up enum values from the definitions.

**Another entity relationship** — add an edge builder in `lib/intel/graph.ts` `rebuildGraph()`. Edges are materialised, so they are immediately queryable on the Graph page.

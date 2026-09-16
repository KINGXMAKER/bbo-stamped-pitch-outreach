# AI system

## Principle: the AI explains evidence; it never produces it

Code calculates. Models interpret. Every number a user sees comes from a stored record; models receive packages of those records and return structured interpretations that are stored separately and labelled as AI.

## Provider

`lib/ai/gemini.ts` — Gemini REST, JSON mode, model chain from env (`GEMINI_MODEL_PRIMARY` then `GEMINI_MODEL_FALLBACKS`). Failures are classified from the HTTP status: 429/408/409/5xx → retry once then next model; 404 → next model; 400/401/403 → stop (a bad key will not fix itself); timeouts → next model. Thinking budget is set per workflow on 2.5 models; thought parts are dropped and never stored.

## `runAi()` — the only way to call a model

`lib/ai/run.ts` records every call in `ai_runs`, success or failure:

- workflow, provider, model, latency, reported usage
- **prompt version** (template text + schema version, checksum-deduplicated in `prompt_versions`)
- **skill version** (`skill_versions`)
- **rule versions** loaded (`ai_run_rules`)
- **score version** in force
- inputs (content ids, evidence ids, parameters) and the **zod-validated structured output**
- confidence, parent run (editor → gatekeeper)

Outputs failing validation get one repair pass, then the run is recorded as an error. Tests inject a scripted generator with `setGenerator()` and never hit a real model.

## Workflows

| Workflow | Input | Output | Where |
|---|---|---|---|
| `enrichment` | transcript + hook frames + caption | attributes (hook type, opening speaker, tension, emotional trigger…), topics, franchise, opening hook | `lib/intel/analysis.ts` · job `ai-enrich` |
| `content_analysis` | transcript, frames, caption, comments, peer ratios, context sentences, similar winners/losers, relevant rules, BBO Viral Content Skill | structured analysis stored in `content_analyses`; a sample-size-1 lesson; AI attributes | job `analyze` or “Run AI analysis” |
| `viral_editor` | timestamped transcript, skill, scoped rules, previous plan + failure reasons | edit plan (opening, beats with source in/out, cuts, reactions, text hook, caption, CTA, packaging) | Edit Lab |
| `gatekeeper` | transcript + plan, Gatekeeper skill, scoped rules | scores ×6, auto-fail flags, failure reasons | Edit Lab |
| `weekly_review` / `monthly_review` | calculated review evidence | narrative sections | Reviews |
| `ask_classify` / `ask` | question → evidence package | intent / explanation | Ask BBO |

**Grounding rules baked into prompts:** determine the topic from the transcript/frames (never filename, caption alone, or one quote); say what could not be observed; correlation language only; attribute values must come from the allowed lists (unknown values become null, not guesses).

**Analysis only runs on real footage.** A post with neither a transcript nor frames is skipped with the reason (BBO rule R-003), and the media job prioritises winners/losers waiting for media.

## Dynamic analysis triggers

Configurable in Settings (`analysis_triggers`): score ≥ 1.5 or ≤ 0.5; shares, comments or retention ≥ 2.0x peers; retention ≤ 0.5x peers; mature posts only; max per run. Mixed signals (e.g. winner with collapsing retention) are marked *notable*. Average posts are not deep-analysed.

## Editor → Gatekeeper

1. The **Viral Editor** writes a plan (skill `bbo-viral-content`, editing rules for the franchise).
2. The **Gatekeeper** — a separate invocation with its own instructions and skill (`bbo-gatekeeper`) — scores HOOK, CLARITY, TENSION, PAYOFF, SHAREABILITY, COMMENT POTENTIAL (/10 each).
3. **Code decides**: pass = total ≥ pass mark (default 45/60) **and** no automatic failure. Unknown flags are ignored. A **near-duplicate check runs in code** against the last 30 days of captions/openings.
4. On failure, reasons (plus “total below pass mark”) go back to the editor. Up to 2 automatic revisions (configurable), then the session waits for a human.
5. Every attempt stores plan, scores, auto-fails, reasons, both run ids; the human decision is stored too.
6. Linking a session to the post it became feeds `gatekeeperCalibration()` — Spearman correlation of Gatekeeper totals with real performance, reported as INSUFFICIENT_DATA until 10 published edits exist.

## Ask BBO

```
question
 → deterministic intent router (high-precision patterns; AI classifier only if no match)
 → evidence builder (SQL + stats: tables, sample size, date range, baseline, confidence, supporting posts, rules, experiments)
 → AI explanation constrained to the evidence JSON (or a deterministic answer when AI is unavailable)
 → UI shows the answer next to the evidence tables
```

Questions spanning history use era-normalised metrics (see PERFORMANCE_SCORING.md). When data cannot answer, the answer says so and names the missing data.

## Rule loading

`loadRelevantRules({workflow, franchise, platform, format})` returns only approved, active rule versions whose scope matches. Scoped rules never leak into contexts where the scope is unknown. See RULE_ENGINE.md.

## Adding an AI skill

Add `skills/<slug>/SKILL.md`, add the slug to `SKILL_SLUGS`, load it with `activeSkill()`, and pass `skillVersionId` to `runAi()`. Edits in Settings → Skills create new versions and rewrite the file.

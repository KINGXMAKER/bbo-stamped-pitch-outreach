# Data depth, coding and validation

BBO BRAIN has performance data for **every** post. It only has *understanding*
of the posts it has watched, transcribed and coded. This document covers the
machinery that closes that gap: which posts get analysed first, how fast, with
which vocabulary, and how the resulting labels are proved trustworthy.

Related: [ARCHITECTURE.md](ARCHITECTURE.md) · [DATA_MODEL.md](DATA_MODEL.md) · [AI_SYSTEM.md](AI_SYSTEM.md) · [RULE_ENGINE.md](RULE_ENGINE.md)

---

## 1. The priority queue (`lib/sync/media-queue.ts`)

Media and coding are **never** processed in chronological or arbitrary order.
`buildQueue(db, { limit, stage })` ranks every candidate into six tiers:

| Tier | What it is | Why it is worth the spend |
|---|---|---|
| 1 | BREAKOUT / WINNER / LOSER from the last 90 days | Recent and decided — the strongest signal about what works *now* |
| 2 | Historical breakout or winner | Why winners won |
| 3 | Historical loser | Why losers lost — the other half of every comparison |
| 4 | Unusual share / comment / save / retention ratio (era-normalised) | Outliers that no label captures |
| 5 | AVERAGE | Controls, without which "winners do X" means nothing |
| 6 | Everything else (unscored, too recent, not enough data) | Backfill |

Two stages use the same queue: `stage: 'media'` (needs download / frames /
transcript) and `stage: 'coding'` (has media, no structured coding yet).

### Balance is enforced, not hoped for

A queue sorted purely by tier would spend the entire first run on winners. Four
constraints prevent that:

- **Per-class corpus targets** — `CORPUS_TARGETS`: 40 winners, 40 losers, 30 average controls, 20 unusual. A class at its target stops being drawn.
- **Class interleaving** — classes are drawn round-robin weighted by what each class still needs, so a run that stops early (daily cap, API quota, interrupted job) still leaves a *comparable* corpus rather than 40 winners and nothing to compare them with.
- **Franchise cap** — `max(4, ceil(limit × 0.35))` per run, so one franchise cannot define the corpus.
- **Guest cap** — 3 per run, for the same reason.

When the caps or targets make it impossible to fill a run, the remaining slots
fall back to plain priority order — balance is a preference, not a reason to
waste a run. Tests: `tests/coding-queue.test.ts`.

---

## 2. Throughput

Measured on this machine (Apple M1, 8 cores, 8 GB RAM):

| Step | Cost |
|---|---|
| Download + ffprobe + hook frames + whisper `base.en` | ≈2.5–2.9 s per post at concurrency 1 |
| 150 posts of media work | ≈6 minutes wall clock |
| Gemini structured coding | ≈2–4 s per post, ≈$0.50 per 150 posts at public Flash rates |

RAM is the binding constraint (whisper.cpp holds ≈1 GB per process alongside the
dev server), so concurrency defaults stay low deliberately.

| Variable | Default | Meaning |
|---|---|---|
| `MEDIA_ANALYSIS_DAILY_LIMIT` | 150 | Max posts to fetch media/transcripts for per day |
| `MEDIA_ANALYSIS_CONCURRENCY` | 2 | Parallel media workers |
| `WHISPER_THREADS` | 4 | `-t` passed to whisper.cpp |
| `AI_ANALYSIS_DAILY_LIMIT` | 150 | Max posts to code per day |
| `AI_ANALYSIS_CONCURRENCY` | 2 | Parallel Gemini workers |

Daily caps count real work done today (`content.media_fetched_at`,
`content.coded_at`), so restarting a job cannot blow through the budget.

### Provider limits are a real constraint

The Gemini key in use is on the free tier. A 140-post coding run exhausted the
daily request quota (HTTP 429) after 36 posts. Model chain notes:

- `gemini-2.0-flash` was **retired** by Google and returns HTTP 404 — as the last fallback it masked the real 429. The brain-local chain is now `gemini-2.5-flash` → `gemini-2.5-flash-lite` → `gemini-flash-latest` (set in `bbo-brain/.env.local`, which is loaded after the repo-root `.env` so the pitch application is untouched).
- Fallbacks do not defeat a per-project daily quota — every model shares it. Coding resumes when the quota resets, or immediately on a billed key.

---

## 3. Structured content coding

`lib/intel/analysis.ts` codes ~30 named attributes per post from the transcript,
hook frames, caption and measured facts. Every categorical attribute uses a
**closed vocabulary** defined once in `lib/seed/reference.ts`, enforced by the
zod schema (`enumOf`) and asserted by tests — the model cannot invent forty
names for the same hook.

**Hook type** — confession · controversial_statement · direct_opinion ·
question · accusation · disagreement · surprising_fact · story_opening ·
challenge · emotional_statement · sexual_relationship_tension ·
status_clout_statement · humor · curiosity_gap · payoff_first · other

**Opening type** — interviewer_question · guest_answer · host_statement ·
reaction · argument_in_progress · text_first · visual_first · other

Alongside those: opening speaker role, opening visual, text hook, clarity,
tension type, controversy type, emotional trigger, share / comment / curiosity
trigger, editing style, reaction shot and timing, guest gender mix, franchise —
plus numeric timings (seconds to understandable, to tension, to payoff, dead
setup, each with a bucket) and verbatim quotes (exact opening line, strongest
moment, strongest possible opening, and whether the current opening is already
the strongest).

Every categorical vocabulary carries an `other` escape hatch so "none of these"
never becomes a new label.

---

## 4. Human validation (`/validation`)

AI labels feed pattern mining, which can end in a rule proposal. Before that is
trusted, a human reviews a **stratified sample** — `validationSample()` targets
35% winners, 30% losers, 20% average, 15% unusual, with franchise and topic caps,
and unscored posts only fill leftover slots. The queue page says so out loud when
the sample cannot meet those quotas because the coded corpus is itself skewed.

Each review shows the video link, the stored hook frames, the transcript, the
AI's measured numbers and quotes, and every coded label as an editable field.

| Decision | Effect |
|---|---|
| **Approve** | `coding_validation_status = APPROVED`. No human attributes written — agreement is recorded by the absence of corrections. |
| **Save corrections** | `EDITED`. Only fields that actually differ are written with `source = 'human'`, which outranks `ai` everywhere (`content_attribute_current`). |
| **Reject & re-analyse** | `REJECTED` and `coded_at` is cleared, so the post returns to the coding queue. |

Every decision is an immutable row in `coding_reviews` (status, note, changed
keys, the `ai_run_id` that produced the coding). The `attribute_corrections`
view pairs each human value with the AI value it replaced, which is what
`codingAccuracy()` turns into a per-attribute agreement rate. Attributes below
80% agreement are surfaced on both `/validation` and `/coverage` — a lesson
resting mainly on a field the AI routinely gets wrong deserves a harder look.

Validation is a **sample**, not a gate: nothing requires every record to be
reviewed, and unreviewed AI labels still participate in mining.

---

## 5. Coverage dashboard (`/coverage`)

Answers one question: *how much of BBO's historical content does BBO BRAIN
actually understand?* Content records, media analysed, structurally coded, human
validated; first-corpus progress per class against target; per-attribute
coverage as a share of the **whole catalogue** (not of the coded sample); and
measured AI accuracy once reviews exist.

---

## 6. Daily sequence

`npm run job -- daily` runs, in dependency order:

1. `instagram-content` — new and updated posts
2. `instagram-metrics` — fresh metric snapshots
3. `instagram-account` — account-level data
4. `media-transcripts` — priority queue, media + frames + transcript (local, no AI spend)
5. `score` — era-normalised scoring and labels
6. `provider-health` — one tiny JSON call per configured AI provider, plus the budget position
7. `ai-enrich` — structured coding on the validated coding model, priority queue, stops at `AI_CODING_CORPUS_LIMIT`
8. `analyze` — deep analysis of the posts that warrant it (analysis-class model)
9. `mine-lessons` — patterns with sample size, effect, p-value, FDR control
10. `rule-proposals` → `rule-challenges` — proposals for **human** approval only
11. `experiments` → `opportunities` → `graph` → `search`

**What happens when AI is unavailable.** Content, metrics, media, scoring,
mining, graph and search never depend on a model. If every AI provider refuses,
`ai-enrich` reports FAILED and its posts stay queued for tomorrow; if the budget
is spent, it reports BUDGET PAUSED without making a single paid call. Either
way the loop carries on (tests: `tests/daily-resilience.test.ts`). Only a failed
Instagram content or metrics sync stops the loop, because everything after it
would reason over stale data.

### Scheduling (nothing is installed until you install it)

`scripts/launchd/com.bbo.brain.daily.plist` is a template. Installing it would
add exactly one file, `~/Library/LaunchAgents/com.bbo.brain.daily.plist`, with a
single job: at 07:30 local time run `npm run job -- daily` then
`npm run job -- weekly-review` in this directory, appending to `data/daily.log`.
It adds no login item, no network listener, and no other system change.

```bash
cp scripts/launchd/com.bbo.brain.daily.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.bbo.brain.daily.plist
```

Remove it with `launchctl unload ~/Library/LaunchAgents/com.bbo.brain.daily.plist`.

### Before exposing BBO BRAIN to anything but localhost

The server binds to `127.0.0.1`. `BRAIN_ACCESS_PASSWORD` **must** be set before
it is reachable from anywhere else (Tailscale, LAN, a tunnel): `proxy.ts` gates
every page and every API route, returning 401 for API calls and redirecting
pages to `/unlock`. With the variable unset there is no gate at all — never
expose an unsecured instance. The Settings page shows whether it is configured.

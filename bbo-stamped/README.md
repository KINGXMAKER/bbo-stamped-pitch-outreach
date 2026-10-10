# BBO Stamped — Reel Production OS

Arrive at a business knowing exactly what footage you need, so the Reels you
planned can actually be edited afterwards.

BBO Stamped works backward from the finished edit:

```
BUSINESS → LOCATION PHOTOS → AI SCOUTS THE SPACE → REEL CONCEPTS
        → YOU PICK THE REELS → DEDUPLICATED MASTER SHOT LIST
        → SHOOT MODE → LIVE COVERAGE → "CAN WE LEAVE?" → EDIT BLUEPRINT
```

You never tell it what kind of business it is, and you never pick a vibe. It
reads that off the photos and says how confident it is.

## What it does

- **AI location scout** — reads every photo together, classifies the business
  (hybrids included), maps physical filming zones, calls out lighting, props,
  visible products and filming problems. Every conclusion cites the photo IDs
  behind it, and those thumbnails are clickable throughout the app.
- **Reel builder** — real timelines, beat by beat, with clock times, on-screen
  text, dialogue and editing direction. Not a list of content ideas.
- **Master shot list** — one deduplicated list across every Reel you selected.
  A setup that serves three Reels is one shot with a `3× coverage` badge, not
  three near-identical shots.
- **Photo plan** — stills are their own deliverable with their own coverage:
  hero food untouched, the full spread, the group hero, the best venue frame,
  and every client must-have. Each frame carries a `timing` that says when it
  stops being possible.
- **Kitchen access** — process coverage (chef hands, plating, the pass) is
  gated on the venue actually approving it. Denied or unconfirmed, none of it
  is planned as required footage.
- **Coverage tracking** — percentages and READY TO EDIT are computed locally
  from ticked captures, never by asking a model.
- **Shoot mode** — mobile-first, big targets, zone filter (`I'm at…`), and
  `NEXT BEST CAPTURE` across video *and* stills. Two switches — "food is out",
  "everyone is here" — change what is urgent, so once service starts an
  untouched hero frame outranks ordinary optional B-roll.
- **Can we leave?** — a hard gate that names the exact missing capture:
  Reel-critical footage, the group hero photo, a client request, a kitchen
  process MUST, or the final BBO verdict. Optional captures never block it.
- **Edit blueprint** — clip order with in/out points, only ever referencing
  footage you actually captured, plus a copy-paste prompt for another AI editor.
- **Skit lab** — comedy built from the physical room, with one-tap rewrites
  (funnier, messier, easier to film, turn into POV…).
- **Saved activations** — everything persists in IndexedDB on the device.
- **Pitch intel** — secondary tool. It infers the category and gives a
  qualitative fit (`STRONG FIT` … `INSUFFICIENT DATA`). It does not read their
  Instagram or website, and it says so instead of inventing a fit score.

## Install

```bash
npm install
cp .env.example .env.local   # then add at least one provider key
npm run dev                  # http://localhost:3100
```

## Environment variables

All keys are **server-side only**. They are read exclusively inside
`app/api/ai/*` route handlers. Nothing is ever prefixed `NEXT_PUBLIC_`, and no
key is stored in the browser.

| Variable | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter key |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI Studio / Gemini key |
| `NVIDIA_API_KEY` | NVIDIA NIM key |
| `AI_VISION_PROVIDER` | First choice for photo analysis — `google` \| `openrouter` \| `nvidia` |
| `AI_CREATIVE_PROVIDER` | First choice for Reels, shots, skits, blueprints |
| `AI_FALLBACK_PROVIDER` | Tried immediately after the primary |
| `GOOGLE_VISION_MODEL` / `GOOGLE_CREATIVE_MODEL` | Model ids (default `gemini-2.5-flash`) |
| `OPENROUTER_VISION_MODEL` / `OPENROUTER_CREATIVE_MODEL` | Defaults `google/gemini-2.5-flash`, `anthropic/claude-sonnet-4.5` |
| `NVIDIA_VISION_MODEL` / `NVIDIA_CREATIVE_MODEL` | Defaults `meta/llama-3.2-90b-vision-instruct`, `nvidia/nemotron-3-super-120b-a12b` |

At least one provider key is required. With none set, the app returns a plain
`No AI provider is set up on the server yet` rather than faking an analysis.

### Changing models

Set the matching `*_VISION_MODEL` / `*_CREATIVE_MODEL` variable and restart. A
vision model must genuinely accept images — a text-only id there fails the
location scout.

### How fallback works

`lib/ai/router.ts` builds a chain per capability from `lib/ai/models.ts`:
configured primary, then the configured creative fallback, then the built-in
order, with any provider dropped that has no key — or no model able to do the
job. Defaults:

```
vision    google → openrouter → nvidia
creative  openrouter → nvidia → google
```

For each provider it tries once, retries once on a transient failure, and moves
on. Failures are classified from the **HTTP status the provider returned** —
never by scanning the message for digits, because retry-delay hints and quota
values contain three-digit numbers that a substring check misreads as a hard
400.

| Status | Class | Behaviour |
|---|---|---|
| 429, 408, 409, 5xx, timeout | transient | retry once, then next provider |
| 404 | model-unavailable | next provider, no retry |
| 400, 401, 403 | hard | next provider, no retry |
| valid HTTP, invalid payload | bad-output | one repair pass, then next provider |
| upstream error inside a 200 body | classified by its embedded code | as above |

Two guards keep the chain honest:

- **Budget slicing.** No provider may spend the whole budget. Each gets a slice
  sized so every remaining provider still gets a real turn, never smaller than
  one full attempt — otherwise a slow primary silently deletes the fallback it
  exists to protect against.
- **No pointless timeout retries.** A model that timed out is simply too slow
  today; repeating the identical call would burn the fallback's turn.

If every provider fails, the operator gets a plain sentence. The app never
invents a canned "AI analysis", and a failed stage never touches the rest of the
activation — a skit failure leaves the venue analysis, Reels, shot list, photo
plan and every edit exactly where they were.

### Observability

Every stage records a `GenerationInfo`: provider, model, latency, whether it
fell back, whether Zod passed on the first answer, per-attempt results, and any
token usage or cost the provider reported. **Settings → Provider debug** shows
the live routing chain and each stage's run. Nothing technical appears in the
shoot-day interface, and no key or authorization header is ever logged.

Cost is only ever what a provider reported. OpenRouter returns one; Google does
not, so none is shown for Google rather than estimated.

### Measured latency and cost

One live three-Reel food activation, OpenRouter primary on
`anthropic/claude-sonnet-4.5`:

| Stage | Latency | Reported cost |
|---|---:|---:|
| Location scout (Gemini) | 24s | not reported |
| Reels | 95s | $0.084 |
| Shots (3 parallel + dedupe) | 110s | $0.320 |
| Photo plan | 57s | $0.064 |
| Skits | 69s | $0.060 |
| Edit blueprint | 58s | $0.053 |
| Pitch intel | 39s | $0.027 |

The shot list is the only stage that grows with the shoot. Planning every Reel
in one call took **5.0 minutes**; `lib/ai/shot-pipeline.ts` now plans each Reel
in parallel and merges the shared camera setups in a separate fast pass, which
brought it to **110s** with no change to the model or the output detail.

If you want it faster, the model is one environment variable. Measured on the
same generation: `anthropic/claude-sonnet-4.5` 53s, `openai/gpt-4.1` 13s,
`google/gemini-2.5-flash` 12s, `meta-llama/llama-4-maverick` 15s. Claude is slow
here because it writes 2-3× more content, which is the reason it is the default
— swap it only if you would rather have the speed.

## Architecture

```
app/
  page.tsx                     app shell (tabbed workspace)
  activation/[id]/page.tsx     deep link into one saved activation
  api/ai/
    analyze-location/          stage 1 — vision, once per photo set
    generate-reels/            stage 2 — Reel concepts + timelines
    build-shots/               stage 3 — per-Reel in parallel, then deduplicated
    build-photo-plan/          stage 4 — the stills deliverable
    generate-skits/            location-specific comedy
    edit-blueprint/            assembly order from captured footage
    pitch-intel/               partnership angle

components/bbo/                ActivationStore, PhotoUploader, PhotoViewer,
                               LocationScout, ReelCard, ShotCard, ShotFilters,
                               ReelCoverage, SkitCard, TalentRoster, ShootMode,
                               LeaveCheck, EditBlueprint, PitchIntel, AppShell

lib/ai/       models (the only place model ids live), router, schemas (Zod),
              typed provider adapters, shot pipeline, prompts
lib/coverage/ deterministic coverage for video and stills, next-best-capture,
              leave check
lib/storage/  IndexedDB persistence + regeneration guards
lib/export/   shoot plan and edit-prompt text builders
types/        the single BBOActivation model
```

Rules the codebase holds to:

- React components never call a provider, and never see a provider's response
  shape. They call our own routes and receive normalised types.
- Model ids live in `lib/ai/models.ts` only. No route handler, prompt or
  component names a model.
- Photos are resized in the browser to a 1568px max edge at quality 0.82 — the
  most detail that survives an upload, since 1568 is the largest edge the
  providers keep. A 4032×3024 phone photo becomes ~70 KB, so a full 20-photo
  set is ~1.8 MB, posted **once**, to the vision stage. Every later stage
  reuses the saved venue analysis and sends photo *ids* only.
- The model designs structure; application code tracks status. Coverage and
  READY TO EDIT are pure functions over the shot list.
- Regeneration never destroys work: locked items, ticked shots and
  client-required shots survive every regenerate.

## Development

```bash
npm run dev        # dev server on :3100
npm run lint
npm run typecheck
npm test           # vitest
npm run build      # production build
npm start          # serve the production build
```

Tests cover the Zod schemas, provider chain order and failover, HTTP error
classification, per-attempt observability, coverage and READY TO EDIT maths for
both video and stills, shared-shot deduplication, next-best-capture priority,
locked / completed / client-must-have preservation, context efficiency, and
saved-activation persistence.

`tests/scenario.test.ts` runs the deterministic shoot-day logic against a real
plan the live pipeline produced for a food activation — 3 Reels, 40 shots, 14
photos — rather than a hand-written best case.

## Deployment

Any Node host that runs Next.js (Vercel, Netlify with the Next runtime, a
container). Set the provider keys as server environment variables in the host —
never in the client bundle. The AI routes declare `maxDuration` up to 300s;
raise your platform's function timeout to match, or the heavier creative stages
will be cut off mid-request. On a platform capped below that, set a faster
`OPENROUTER_CREATIVE_MODEL` — see the latency table above.

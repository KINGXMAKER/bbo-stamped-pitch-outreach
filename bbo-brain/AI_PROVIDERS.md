# AI providers, task classes and spend

BBO BRAIN does not depend on one model vendor. Every model call goes through a
provider abstraction with three rules: cheap work never buys premium tokens, no
single provider outage stops the daily loop, and nothing spends money without a
ceiling it must respect.

Related: [AI_SYSTEM.md](AI_SYSTEM.md) · [DATA_DEPTH.md](DATA_DEPTH.md) · [ARCHITECTURE.md](ARCHITECTURE.md)

---

## 1. The abstraction

`lib/ai/providers/` holds one interface (`AIProvider`) and three implementations:

| Provider | Transport | Images | Notes |
|---|---|---|---|
| `gemini` | Google Generative Language REST | yes | Hook frames are only sent to a provider that can see them |
| `openrouter` | OpenAI-compatible | text only today | Model slugs and prices are read from OpenRouter's live catalogue, never hardcoded |
| `nvidia` | OpenAI-compatible (`integrate.api.nvidia.com`) | text only | Free tier on a personal key: rate-limited, priced at $0 |

Each provider exposes `generateStructured`, `generateAnalysis`, `healthCheck`,
`providerName` and its model list, and returns token usage plus an estimated
cost. `lib/ai/run.ts` (`runAi`) is still the only way the product calls a model.

## 2. Task classes

| Class | Work | Default preference |
|---|---|---|
| **coding** | Controlled-taxonomy classification: hook type, opening type, topic, triggers, timings | Cheapest validated model (Gemini Flash-Lite ahead of Flash) |
| **analysis** | Why a post won or lost, reusable lessons, experiment recommendations | Stronger model |
| **gatekeeper** | Independent review of a generated edit plan | Always a **separate call** from the generation call, never the same context |
| **synthesis** | Weekly/monthly narrative, Ask BBO | Stronger model; low frequency |

Every call site is tagged, so a taxonomy lookup can never quietly run on an
analysis-class model. Overrides:

```
AI_CODING_PROVIDER / AI_CODING_MODEL
AI_ANALYSIS_PROVIDER / AI_ANALYSIS_MODEL
AI_GATEKEEPER_PROVIDER / AI_GATEKEEPER_MODEL
AI_SYNTHESIS_PROVIDER / AI_SYNTHESIS_MODEL
AI_ALLOW_FALLBACK=true
OPENROUTER_MODELS=…   NVIDIA_MODELS=…   GEMINI_MODEL_PRIMARY / GEMINI_MODEL_FALLBACKS
```

## 3. Failure handling

`runAi` tries candidates in order and records what happened on every run:

| Failure | Behaviour |
|---|---|
| 429 quota / rate limit | one retry, then the next candidate |
| 5xx | one retry, then the next candidate |
| 404 model unavailable | dropped immediately, no retry (a retired model must never mask the real error) |
| Invalid JSON / schema failure | exactly one repair attempt, then the next candidate |
| 401 / 403 auth failure | that provider is dropped for the call and reported as configuration, not weather |
| Budget ceiling | **BUDGET PAUSED** — AI work stops, the job does not fail, non-AI work continues |

The candidate list is finite and each model gets at most two attempts, so the
chain can never cycle. `retry_count` and `fallback_reason` are stored per run.

## 4. What every run records

`ai_runs` keeps: workflow, task class, provider, exact model, prompt version,
skill version, rule versions, score version, input/output tokens, estimated
cost, retry count, fallback reason, latency, the validated output and the
timestamp. Chain-of-thought is never requested or stored — reasoning-model
`reasoning` fields are ignored, and a response with no answer content is a
failure rather than a place to look for one.

## 5. Spend controls

| Variable | Default | Meaning |
|---|---|---|
| `AI_DAILY_BUDGET_USD` | 1.00 | Estimated spend allowed per UTC day |
| `AI_MONTHLY_BUDGET_USD` | 15.00 | Per calendar month |
| `AI_MAX_COST_PER_JOB_USD` | 0.75 | One job's ceiling |

Before a batch starts, its cost is projected from the measured average of recent
runs of the same workflow; a batch that cannot fit is paused before the first
call. During a batch, a `BudgetGuard` is consulted before every call, so the run
stops at the call that *would* cross the line. Costs are estimates from recorded
token counts and published prices — this system's own accounting, not an invoice.

## 6. Escalation instead of blind trust

Two models never run on every post. A second, stronger model is called only when
the cheap one is unsafe to trust:

- a required field (hook type, opening type) came back uncoded, **or**
- confidence is below `AI_ESCALATE_BELOW_CONFIDENCE` (0.45), **or**
- the post is a BREAKOUT / WINNER / LOSER coded with less than 0.6 confidence.

Both answers are compared on the fields BBO's comparisons actually use. The
stronger answer is stored; if the two models disagree on more than 40% of the
compared fields, the post is marked `human_review` in `coding_escalations` and
surfaces in the Coding Validation queue. A failed escalation leaves the cheap
coding in place rather than losing the post.

## 7. Benchmarking before switching

`npm run job -- benchmark-coding '{"provider":"openrouter","model":"<slug>"}'`
re-codes an already-coded, stratified sample (outcome, franchise, topic and hook
type balanced) with the identical production prompt and source material.

Results are written **only** to `benchmark_runs` / `benchmark_codings` — no
candidate model can touch `content_attributes`. The report measures valid
structured-response rate, taxonomy violations (counted on the *raw* answer,
because the production schema silently drops out-of-vocabulary values),
missing fields, retry rate, median latency, cost per 100 posts, and per-field
agreement with the coding already in the database.

Selection order, deliberately not cheapest-first: schema validity → taxonomy
adherence → agreement on the fields that matter → consistency → latency → cost.

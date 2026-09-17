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
| `openrouter` | OpenAI-compatible | per model (`-vl-` models see frames) | Model slugs and prices are read from OpenRouter's live catalogue, never hardcoded |
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
OPENROUTER_MODELS=…   OPENROUTER_<TASK>_MODELS=…   NVIDIA_MODELS=…
GEMINI_MODEL_PRIMARY / GEMINI_MODEL_FALLBACKS
AI_<TASK>_FALLBACK_PROVIDERS=openrouter,gemini   # keep unvalidated providers out of a chain
```

## 3. Failure handling

`runAi` tries candidates in order and records what happened on every run:

| Failure | Behaviour |
|---|---|
| 429 quota / rate limit | one retry, then the **provider** cools down (`AI_QUOTA_COOLDOWN_MS`, 10 min) — quota is shared by all its models — and the next provider is tried |
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
| `AI_CODING_CORPUS_LIMIT` | 150 | Total posts held with structured coding; the daily loop stops coding here until the corpus has been reviewed |

A paid model with no known price is charged at a deliberately pessimistic
$1 / $5 per million tokens rather than counted as free, so a renamed or new
model can never spend past a ceiling unnoticed. OpenRouter prices are refreshed
from its catalogue once per process.

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

### Reading a benchmark honestly

Agreement is reported twice: across all fields, and across fields answerable
from the transcript and caption alone. Opening type, guest-answer opening and
reaction shots need the hook frames or speaker identity (whisper transcripts do
not label speakers), so a text-only model is not penalised as if it could see.

Agreement with the existing coding measures whether two models read a post the
same way — not which one is right. `pairAgreement` measures a model against its
own rerun: a model that disagrees with itself is noise; one that is consistent
but differs from the reference has a different reading that only human review
can settle.

## 8. Human review is the model-quality dataset

`coding_agreement` (view) lists every AI label on a human-reviewed post with the
human's label, whether they agree, and the provider and model that produced the
AI label. `/coverage` shows agreement by model once reviews exist, and the
intelligence report flags any finding whose posts were coded almost entirely by
one model while the baseline was not — a possible coding-model artifact.

## 9. Re-coding without mixing models

When the corpus moves onto a different coding model, `snapshotCurrentCoding`
first freezes the existing labels as a benchmark run, then
`ai-enrich {"recodeIds":[…]}` re-codes the named posts. `clearAiCoding` removes a
post's previous AI coding before the new one is applied, so a field the new
model leaves null cannot keep the old model's value. Human and measured values
are never cleared.

A yes/no attribute is only coded if the prompt defines it. Prompt v2
(`enrichment-v2`) added definitions for question opening, guest-answer opening,
payoff-first, text hook and reaction shot, which every model had returned as
null under v1.

## 10. Current selection (benchmarked 2026-09-16)

Same 25 stratified posts, same source material, every row measured against the
same frozen reference (the coding that existed before the corpus was re-coded).

| Model | Valid | Taxonomy violations | Missing fields | Agreement (excl. franchise) | Franchise agreement | Self-consistency | Median latency | $ / 100 posts |
|---|---|---|---|---|---|---|---|---|
| NVIDIA nemotron-3.5-lightning-30b | 96% | 23 | 11 | 32% | 1/14 | — | 35.5 s | free tier |
| NVIDIA mistral-nemotron | 84% | 5 | 13 | 48% | 1/2 | — | 21.3 s | free tier |
| OpenRouter qwen3-235b-a22b-2507 (text) | 100% | 16 | 0 | 47% | 3/17 | — | 14.7 s | 0.039 |
| OpenRouter qwen3-30b-a3b-instruct-2507 (text) | 80% | 11 | 11 | 45% | 0/11 | — | 9.6 s | 0.032 |
| **OpenRouter qwen3-vl-32b-instruct (frames)** | **100%** | **1** | **0** | **54%** | 2/18 | **86%** | 10.5 s | 0.057 |
| OpenRouter gemini-2.5-flash-lite (frames) | 84% | 0 | 16 | 60% | 8/14 | — | 3.7 s | 0.072 |
| OpenRouter qwen3-vl-235b-a22b-instruct (frames) | 100% | 3 | 2 | 48% | 7/17 | — | 14.5 s | 0.200 |

Runs 1–6 used prompt v1; runs 7–8 used v2 (which only adds the yes/no attribute
definitions). The yes/no attributes cannot be scored against this reference
because the reference never had them.

Reading it:

- Gemini Flash-Lite — the family that produced the reference — agrees with it only
  60% on a fresh run, so these categories are genuinely ambiguous and agreement is
  a consistency signal, not ground truth. Human review decides.
- Qwen3-VL-32B is the only candidate that is fully schema-valid, near-perfect on the
  controlled vocabulary, self-consistent on a rerun (86%) and able to see hook frames.
  It codes the corpus.
- **Franchise is retired as an analysis dimension** (2026-09-17) in favour of four content buckets with a dedicated, gated classifier — see [DATA_DEPTH.md](DATA_DEPTH.md#0-content-buckets).
- **Every model was poor at franchise.** The prompt lists franchise slugs without
  descriptions and the models guess from names (Qwen relabelled podcast clips as
  Group Chat). `franchise` is in `AI_CODING_UNTRUSTED_FIELDS`, so no model writes it;
  heuristics and audits decide it until a described-franchise prompt passes a benchmark.
- Qwen3-VL-32B is served only by Alibaba, which stops generating on explicit content
  (`finish_reason: error`). Qwen3-VL-235B has other hosts and is the second coding
  model, so explicit posts stay in the same model family.

Routing:

- **coding:** `openrouter / qwen/qwen3-vl-32b-instruct` → `qwen/qwen3-vl-235b-a22b-instruct` → Gemini direct (2.5 Flash-Lite, 2.5 Flash). NVIDIA is kept out of the coding chain.
- **analysis and escalation:** `openrouter / qwen/qwen3-vl-235b-a22b-instruct` → Gemini direct. It is not measurably more accurate than the 32B (48% vs 54% against the reference) — its role in escalation is an independent second reading (64% agreement with the 32B), with disagreements sent to human review.
- **gatekeeper, synthesis:** Gemini 2.5 Flash direct → OpenRouter.

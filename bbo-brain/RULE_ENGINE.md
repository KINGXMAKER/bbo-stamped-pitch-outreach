# Rule engine

The loop that edits the loop: **lesson → evidence → proposal → human decision → versioned rule → loaded into AI workflows → challenged by new evidence**.

## Lessons

A lesson is an observation with evidence — not a rule. Origins: `pattern_mining`, `ai_analysis` (n=1 hypothesis), `experiment`, `imported_audit`, `human`.

States: `NEW · OBSERVING · SUPPORTED · WEAKENED · CONTRADICTED · PROMOTED_TO_RULE · ARCHIVED`. Every change is written to `lesson_events` (the belief history).

### Mining (`mineLessons`)

For every comparable enum/boolean attribute value, topic and recurring guest (≥5 posts) × six era-normalised metrics (`performance_score`, `share_rel`, `comment_rel`, `save_rel`, `retention_rel`, `deep_action_rel`), compare the group with everything else.

Status transitions on re-evaluation:
- same direction, ≥ MODERATE → `SUPPORTED`
- same direction but a thinner read → stays `SUPPORTED` if it already was (less data is not evidence against)
- no meaningful difference with ≥ EARLY confidence → `WEAKENED`
- opposite direction with ≥ MODERATE → `CONTRADICTED`
- insufficient data → unchanged
- `PROMOTED_TO_RULE` and `ARCHIVED` are human-final and never changed by mining

Imported audit lessons are re-checked on BBO BRAIN's own data **from the audit's window start onward**, and claims the audit itself flagged as likely confounded (L007, L009) can be weakened by data but never promoted.

## Statistical guardrails (`lib/intel/stats.ts`)

| Label | Requires |
|---|---|
| INSUFFICIENT_DATA | fewer than 5 posts in either group |
| EARLY_SIGNAL | a meaningful effect (≥1.25x or ≤0.8x) that doesn't meet the bars below |
| MODERATE_SIGNAL | ≥8 posts, ≥60% of the group on the effect's side of the comparison median, p ≤ 0.15 |
| STRONG_SIGNAL | ≥15 per group, ≥65% consistency, p ≤ 0.05, and the direction holds in both halves of the timeline |

- p-values: permutation test on medians for small samples; Mann–Whitney U (tie-corrected) when both groups have ≥20.
- **False-discovery control:** a new lesson from mining must also pass Benjamini–Hochberg across the whole pass (q = 0.10; q = 0.20 for large performance-score effects kept as early signals). Each lesson records how many comparisons ran.
- Language: “associated with”, never “caused”, outside experiments.

## Rules

`rules` (identity, category, status, `pattern_json`) + `rule_versions` (text, reason, scope, evidence summary, sample, confidence, `proposed_by` seed/ai/human, proposal, approval, activation, deactivation, supersession).

**Founding rules:** the 15 rules supplied by King Maker, seeded as approved v1. Five have a machine-checkable pattern and can be challenged by data (R-005, R-007, R-008, R-014, R-015); the rest are principles.

**Pattern format:** `{"key": "opening_speaker_role", "group": "interviewer", "compare": "guest", "metric": "performance_score", "expected": "lower"}` with an optional `franchise`.

**Scope:** `applies_to_json` = `{workflows, franchises, platforms, formats}`. `loadRelevantRules()` returns only approved, active versions whose every scoped dimension matches; a rule scoped to a franchise is never loaded when the franchise is unknown. Example: a podcast clip editor receives global editing rules + R-015 (podcast/street/Mirror Talk); a caption workflow does not receive editing rules.

**Violations:** a post violates an active rule when it carries the attribute value a rule says to avoid (`expected: lower`), within scope. Shown in the library and on content pages.

## Proposals (`generateRuleProposals`)

A lesson becomes a proposal only when **all** hold (configurable in `settings.lesson_promotion`):
- status `SUPPORTED`, confidence ≥ MODERATE, sample ≥ 8
- supported across **2 consecutive evaluations that saw new data** (re-running on unchanged data does not count)
- no pending proposal for it; if a human rejected it before, only after the sample grows 50% (25% after “keep observing”)
- if an active rule already encodes the same claim, the evidence attaches to that rule instead

The proposal page shows: proposed rule, why, supporting and contradicting content, metric difference, sample size, confidence, scope, and current rules affected — with **Approve · Edit + approve · Reject · Keep observing**. `decideProposal()` is the only path from a proposal to an active rule. Approval creates the rule (or a new version of a target rule), marks the lesson `PROMOTED_TO_RULE`, links evidence, and regenerates `knowledge/CONSTRAINTS.md`.

## Challenges (`detectRuleChallenges`)

For each active rule with a pattern, the last 60 days are evaluated on their own (≥8 posts in the group). A challenge opens when recent data runs **opposite** to the rule's expectation (≥ EARLY) or shows **no meaningful difference** with ≥ MODERATE confidence. It stores recent and full-history evidence, supporting and contradicting posts.

Resolutions: **Keep · Narrow** (new scope, optional new text → new version) **· Replace** (new text → new version) **· Deactivate · Keep observing**. Old versions are retired with `deactivated_at` and `superseded_by_version_id`, which powers “what did we believe that we no longer believe?” (`beliefChanges()`).

## Current state (2026-09-15)

46 lessons (33 supported, 4 observing, 4 new, 3 weakened, 1 contradicted, 1 archived); 0 rule proposals yet — mined lessons have one evaluation with the current data and need a second evaluation on new data from the next sync; 0 open challenges.

## Adding a rule type

Rules are data. To make a new kind of rule testable, express it as a pattern over an attribute (add the attribute if needed) and a metric in `METRIC_DEFS`. For a new workflow, choose a workflow name, pass it to `loadRelevantRules()`, and include it in rules' `applies_to_json.workflows`.

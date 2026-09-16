# Experiments

When a pattern is interesting but the evidence is thin, BBO tests it deliberately instead of writing a rule.

## Model

An experiment has a **hypothesis**, a **variable** (usually a content attribute), **control** and **variant** values, a **primary metric** and secondary metrics, optional **scope** (platform, franchise, topic), a **minimum sample per arm** (default 5), and a lifecycle: `proposed → running → completed | abandoned`.

## Where experiments come from

| Origin | How |
|---|---|
| `imported_audit` | The `next_test` of each weekly-audit learning (8 imported), e.g. “25s dense cut vs 50s full cut”, “question vs statement caption”, “decision CTA vs no CTA”. |
| `pattern` | `suggestExperimentsFromLessons()` proposes a test for mined EARLY_SIGNAL lessons on an attribute. |
| `ai` | Content analyses include a recommended experiment (shown on the post; create it with one form). |
| `human` | Experiments page. |

## Running

1. **Start** with a start date — only posts published from then count.
2. **Assignment**
   - Experiments on an attribute **auto-assign** in-scope posts whose attribute equals the control or variant value (job `experiments`, part of the daily loop).
   - Any post can be assigned by hand (content page or experiment page). **Human assignments are never overwritten** by auto-assignment.
3. **Evaluate** compares variant vs control on the primary metric with the same guardrails as lessons (`compareGroups`: minimum sample, effect threshold, consistency, permutation or Mann–Whitney p-value, time-split agreement) plus every secondary metric.
4. **Complete** records the result as a lesson (origin `experiment`) linked to the experiment and its posts:
   - moderate or strong difference → `SUPPORTED`, immediately eligible for a rule proposal (a deliberate test counts as repeated evidence)
   - no difference → `WEAKENED`
   - if mining already tracks the same claim, that lesson is updated instead of duplicated.

## Causality

Assignments follow what BBO actually posted, not randomisation, so results are strong associations, not proof. The UI says so, and results use “beat/trailed … in a deliberate test”. Keep topic and franchise constant (scope the experiment) to make results cleaner.

## Adding an experiment

UI: Experiments → New experiment. Code:

```ts
createExperiment(db, {
  name: 'Guest-answer opening vs interviewer question',
  hypothesis: "Opening on the guest's answer holds viewers longer.",
  variableKey: 'opening_speaker_role',
  controlValue: 'interviewer',
  variantValue: 'guest',
  primaryMetric: 'retention_rel',
  franchiseSlug: 'podcast',
  origin: 'human',
});
```

To test something that is not yet an attribute, add the attribute first (ARCHITECTURE.md → Another content attribute) or run the experiment with manual assignment.

# BBO CONSTRAINTS — active operating rules

> Human-readable mirror of the `rules` / `rule_versions` tables. The database is the
> source of truth; `npm run job export-constraints` regenerates this file from the active
> rule versions after any approval. Permanent rule changes require human approval (R-012).

## Seed rules — version 1, proposed by seed, approved 2026-09-15

| Code | Rule | Applies to | Testable against data |
|---|---|---|---|
| R-001 | Psychological chronology > recording chronology. | editing workflows | principle |
| R-002 | Never assume the first recorded sentence should open. | editing workflows | principle |
| R-003 | Analyze complete available footage/transcript before determining the actual topic. | all workflows | principle |
| R-004 | Never infer video topic from filename alone. | all workflows | principle |
| R-005 | Every short should contain identifiable tension. | editing workflows | `tension_type = none` → lower performance score |
| R-006 | Remove context viewers do not need. | editing workflows | principle |
| R-007 | Payoff may appear before context. | editing workflows | `payoff_first = true` → higher retention |
| R-008 | BBO captions prioritize comments, debate, tagging and sharing over merely describing the clip. | packaging workflows | `cta_type = none` → lower comment rate |
| R-009 | Cross-platform packaging must be native to the destination platform rather than rewritten Instagram copy. | packaging workflows | principle (needs multi-platform data) |
| R-010 | Editing recommendations should identify the actual strongest opening when footage allows. | editing workflows | principle |
| R-011 | Comments, shares, retention, saves and follows may matter more than raw views depending on the content goal. | all workflows | principle (encoded in scoring v1) |
| R-012 | Permanent AI-generated rule changes require human approval. | all workflows | governance |
| R-013 | Do not default to corny marketing language. | packaging workflows | principle |
| R-014 | Do not generate generic hashtag dumps. | packaging workflows | `5+ hashtags` vs `0` → lower share rate |
| R-015 | Do not repeatedly open clips with interviewer questions when the guest answer can stand alone more powerfully. | editing workflows · Podcast, Street Interview, Mirror Talk | `opening_speaker_role = interviewer` vs `guest` → lower performance score |

# Performance scoring

## The score

`performance_score` = **weighted geometric mean of each post's ratio to the median of comparable posts**. `1.0` is what BBO normally gets; `2.0` is double on the weighted mix; `0.5` is half.

Why a geometric mean: 2x and 0.5x cancel symmetrically, and one viral reach number cannot drown out shares, comments, saves and retention.

### Version v1 (active)

| Component | Weight | Definition |
|---|---:|---|
| Share rate | 25% | shares ÷ reach |
| Comment rate | 15% | comments ÷ reach |
| Save rate | 15% | saves ÷ reach |
| Retention | 15% | average watch time ÷ measured duration (capped at 3x) |
| 3-second hold | 10% | 100% − reels skip rate |
| Reach | 10% | reach |
| Like rate | 10% | likes ÷ reach |
| Follows per reach | 0% | returned for feed posts but **not for Reels** — weighting it would score the two formats on different bases |

- **Peers:** same platform and format class (video vs static), mature, excluding the post itself. Trailing 90 days; if fewer than 10 peers, ±90 days; then all time. The group used is stored per post.
- **Ratios** are clamped to 0.1–10x.
- **Maturity:** posts younger than 48h (at their latest observation) are `IMMATURE` and never classified — matching the weekly audit convention.
- **Coverage:** a post needs ≥50% of the weighted components measurable, else `UNSCORED`. Missing inputs are never treated as zero.

### Labels (configurable per version)

| Label | Score |
|---|---|
| BREAKOUT | ≥ 2.0 |
| WINNER | ≥ 1.5 |
| ABOVE_AVERAGE | ≥ 1.15 |
| AVERAGE | > 0.85 |
| BELOW_AVERAGE | > 0.5 |
| LOSER | ≤ 0.5 |

Distribution on the real catalogue (2026-09-15, 940 scored): BREAKOUT 75 · WINNER 100 · ABOVE 174 · AVERAGE 230 · BELOW 264 · LOSER 97 · plus 5 immature and 6 unscored.

## Era-normalised comparisons (important)

Every component — weighted or not, plus deep action rate `(shares + saves + comments) ÷ reach` — is also stored as a **peer ratio** (weight 0 if unweighted). Lessons, topics, people, Ask BBO and opportunities compare these ratios (`share_rel`, `comment_rel`, `save_rel`, `retention_rel`, `deep_action_rel`, …), never raw rates across long periods.

Why this matters, from this build: mining raw rates across 2021–2026 “found” that posts with 5+ hashtags had **51.8x** the comment rate of other posts, and late-night posts 29x. Those were era effects — BBO's reach and audience changed completely over five years — not content insights. Those lessons were discarded and re-mined on peer ratios, where effects fell to a plausible 0.5–3.3x.

Raw rates are still shown for individual posts and for adjacent-period comparisons (this week vs last week), where the era is constant.

## Performance context

`lib/scoring/context.ts` turns numbers into relative statements, each with its sample size:

- “1.7x BBO Instagram median reach” (same format class)
- “2.1x median share rate”
- “Top 8% of BBO Podcast posts within ±45 days” (≥10 comparable posts)
- “Retention was below BBO baseline despite strong comments”
- “Hidden winner: low reach, above-baseline deep action — a distribution problem, not a concept problem”

## Known limitations

- Snapshots are compared at different post ages (a post observed at 3 days vs 3 years). Maturity gating removes the worst case; reach keeps accruing slowly afterwards.
- Retention requires a measured duration — available for posts from the audit archive and any post whose media has been ingested. The 3-second hold (from skip rate) is available far more widely.
- Follows and profile visits are returned for feed posts (92) but not for Reels (858), so “follows generated” carries 0 weight in v1. A future version could weight follows inside the static-format peer group only.

## Versioning

Scores are derived data, recomputed from the append-only metric history. To change the formula or thresholds, create a new version (Performance → Create a new score version, or `createScoreVersion()`), optionally activating it and rescoring. Old versions are kept; every AI run records the score version in force.

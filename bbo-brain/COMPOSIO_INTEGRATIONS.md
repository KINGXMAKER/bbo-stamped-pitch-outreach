# Composio integrations

Inventory verified live on 2026-09-15 with the project's `COMPOSIO_API_KEY`.

## Connected

| Toolkit | Connected account | Auth config | Status |
|---|---|---|---|
| Instagram (@dabboshow, ig_user_id `26850983357863398`) | `ca_xH0r_E3tatzk` | “BBO HOOKLAB” | ACTIVE |

That is the only connected account. **TikTok, YouTube, Google Drive, Google Sheets and every other toolkit are not connected**, so BBO BRAIN shows them as *not connected* instead of inventing data. The adapter interfaces (`ContentSourceAdapter`, `AnalyticsSourceAdapter`, `StorageSourceAdapter`) are ready for them.

## How BBO BRAIN calls Instagram

Everything goes through Composio's raw proxy, which forwards Graph API requests with the stored OAuth credentials:

```
POST https://backend.composio.dev/api/v3/tools/execute/proxy
{ "connected_account_id": "ca_xH0r_E3tatzk", "endpoint": "/<graph path>", "method": "GET" }
→ { "data": <graph body>, "status": <graph HTTP status>, "headers": {...} }
```

The named actions (`INSTAGRAM_GET_USER_MEDIA`, `INSTAGRAM_GET_POST_INSIGHTS`, …) exist but require pinned toolkit versions and have changed shape between versions; the proxy is the durable route and gives one error model.

**Error classification** uses structured fields only — the envelope's `status` and Meta's `error.code` / `is_transient` — never message text (see the repo-root `CLAUDE.md`):

| Signal | Class | Behaviour |
|---|---|---|
| `is_transient`, 429, 408, 5xx, Meta codes 1/2/4/17/32/341/613 | transient | retry with backoff (3 attempts) |
| code 100 or subcode 2207086 | unsupported | no retry; metric recorded as unavailable |
| 401/403, code 190, anything else | hard | no retry; integration marked *needs attention* |

## What each source really provides

### Posts
`/{ig-user}/media?fields=id,caption,media_type,media_product_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count` paged 100 at a time. **951 unique posts** returned (2021-06-03 → 2026-09-15). `media_url` expires within hours, so media downloads request a fresh URL per post.

### Per-post insights (verified per metric on a Reel)

| Metric | Reels | Notes |
|---|---|---|
| reach, views, likes, comments, saved, shares, total_interactions | ✅ | |
| ig_reels_avg_watch_time, ig_reels_video_view_total_time | ✅ | |
| reels_skip_rate | ✅ | → **3-second hold = 100% − skip rate** (derived) |
| profile_visits, follows, profile_activity, navigation | ❌ | “not supported for this media product type” |
| impressions, plays, replays, clips_replays_count, ig_reels_aggregated_all_plays_count | ❌ | rejected or deprecated |
| crossposted_views, facebook_views | ❌ | “Insights are not available” |

**Feed posts** (images and carousels — 92 in the backfill) return reach, views, likes, comments, saved, shares, total_interactions **and also `profile_visits` and `follows`** (verified: all 92 have both). Reels reject both. Any metric Instagram rejects is logged per job and the rest are kept (per-metric fallback).

Not exposed at all: 1s/2s/3s retention curves, completion rate, link clicks per post. **Retention** is derived as average watch time ÷ duration, where duration is measured locally with ffprobe (archive runs or media ingestion).

Backfill result: 951 posts, 998 API calls, 9,388 metric values, 0 failures.

### Comments
`/{media}/comments?fields=id,text,like_count,timestamp&limit=50` for posts in the last 30 days. Instagram sometimes limits comment text; counts from insights stay complete.

### Account insights
- `follower_count` (period=day) → **net daily follower change only** — no follows/unfollows split, max ~30 days per request.
- `reach, views, profile_views, website_clicks, accounts_engaged, total_interactions` with `metric_type=total_value`.
- `follower_demographics` (lifetime) by gender, age, city, country.
- `reached_audience_demographics` / `engaged_audience_demographics` have returned empty results on every weekly audit since 2026-08-30, so they are not requested.

## Local sources (not Composio)

| Source | Provides |
|---|---|
| Weekly audit archive (`../instagram_audit_run*.json`, `../audits/data/*.json`) | 8 real point-in-time pulls → 1,677 historical snapshots, audit V2 caption coding, measured durations/loudness, comment samples |
| `../bbo_content_learning_memory.json` | 12 audit lessons with their belief history and 8 proposed tests |
| ffmpeg / ffprobe | duration, loudness, hook frames, thumbnails |
| whisper.cpp (`ggml-base.en`) | timestamped transcripts (speaker names not identified) |

## Cost awareness

A full metric refresh is ~1 Composio call per post (≈1,000 today). The daily job refreshes only posts from the last 45 days by default (`{"refreshDays":45}`); run `instagram-metrics` with `{"all":true}` only when a full history refresh is wanted.

## Adding a connected app

1. Connect it in Composio.
2. Implement the relevant adapter interface in `lib/adapters/` (use `ComposioProxy` or the named actions).
3. Register a sync job, and update the integration's capabilities/limitations in `lib/seed/reference.ts` from what you verify live — never from documentation alone.

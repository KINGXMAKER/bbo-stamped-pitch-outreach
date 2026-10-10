# BBO Stamped Pitch — Project Notes

Learned patterns from debugging sessions on this repo. Loaded automatically every session — read before touching error handling, LLM calls, or shared branches.

## Anchor error classification on structured format, not substring search

`netlify/functions/shared.js` classifies Gemini errors (retryable vs hard-fail vs
model-unavailable) by inspecting `err.message`. Never classify with `.includes('400')`
or a bare `/400|401|403/` regex — arbitrary 3-digit numbers elsewhere in the message
(retry-delay hints like "retry in 2.199104009s", quota values, timestamps) will
false-positive. A transient 429 quota error was once misread as a hard 400 because its
retry-delay field happened to contain "400", which skipped all retry/fallback logic and
dumped the raw provider error to the user.

Fix in place: `getStatusCode(err)` extracts the code from the bracketed form the SDK
actually emits (`[429 Too Many Requests]`) via `m.match(/\[(\d{3})[\s\]]/)`, then
`isTransientError`/`isModelUnavailable`/`isHardError` compare against the extracted
code — never scan the whole message for bare digits. Apply the same anchor-on-structured-
format approach to any new error-classification branch added here.

## Budget-aware LLM calls in Netlify functions

`generate-pitch.js` calls Gemini inside a Netlify function with a hard wall-clock
timeout. A function with no explicit deadline on its main LLM call (implicit SDK
default, e.g. 25s) that then unconditionally runs more LLM calls afterward
*sequentially* (e.g. two compression passes at 12s each) can accumulate ~49s of
possible work in one invocation — blowing past the platform's function timeout before
any in-library retry/fallback logic gets a chance to run. Long user-pasted text
(mobile screenshot-scan notes) inflates the prompt and makes it worse.

Conventions now in place, follow them for any new LLM-calling code path here:
- Track one shared wall-clock deadline (`Date.now() + budget`) through the whole
  handler, not per-call implicit defaults.
- Cap/trim large user-supplied text blocks (`capText()`) before building the prompt —
  the single biggest lever on generation time.
- Run independent follow-up calls in `Promise.all`, not sequentially, and skip them
  once remaining budget is too tight to risk them.
- One automatic retry with a condensed prompt (drop few-shot examples, short
  reference) on timeout/overload — skip for hard errors, since a smaller prompt won't
  fix a bad key or auth failure.
- `fastMode` flag skips expensive lookups (Supabase/Learning Center) entirely and goes
  straight to the condensed prompt, for retries.
- Frontend: never wipe user-entered form state on a timeout/error retry button — reuse
  the saved payload and resend with the fallback flag (`retryPitchFast()`, not
  `resetAgent()`).
- Raise the platform's configured function timeout (`netlify.toml`) only as a
  supplement, never as the primary fix.

## Evidence-based reporting

Before reporting progress, audit each claim against a tool result from this session.
Only report work you can point to evidence for. If something is not yet verified, say
so explicitly. If tests fail, say so with the output. If a step was skipped, state that.

## Rebase before continuing work on this branch

This repo gets edited by more than one AI IDE session concurrently (Claude Code +
Google Antigravity), sometimes on the same branch/main. Before starting non-trivial
edits, fetch and rebase onto the latest main/remote first, confirm a clean rebase,
then make the fix on top of current real code. After a rebase, push with
`--force-with-lease` (not plain `--force`) since local history was rewritten.

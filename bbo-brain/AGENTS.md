<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# BBO BRAIN — agent rules

- Read `ARCHITECTURE.md` and `DATA_MODEL.md` before changing schema or the intelligence loop.
- Schema changes are new files in `db/migrations/` registered in `db/migrations/index.ts`. Never edit an applied migration.
- Never write fabricated metrics. Anything not from a real source must set `content.is_demo = 1` and render with the DEMO label.
- AI explains evidence the code calculated; it never produces the evidence. Every model call goes through `lib/ai/run.ts` so it lands in `ai_runs`.
- Never classify content from the caption alone when media is retrievable: fetch media and transcribe first, then classify. When media cannot be retrieved, a caption-only video may be called core, but never filed away as non-core — leave it unbucketed. Do not weaken this to raise coverage.
- Buckets are never pooled in one comparison, and no finding becomes a rule while the coding validation batch is unreviewed.
- Correlation language only ("associated with") unless a completed experiment backs the claim.
- Classify provider errors by HTTP status, never by scanning message text for digits (see repo-root `CLAUDE.md`).
- Permanent rule changes require human approval. No code path may activate a rule version without a decision recorded on a proposal or challenge.

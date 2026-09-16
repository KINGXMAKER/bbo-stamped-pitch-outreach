/**
 * CLI for the sync engine.
 *
 *   npm run job -- list
 *   npm run job -- score
 *   npm run job -- instagram-metrics '{"all":true}'
 *   npm run job -- daily
 *   npm run job -- backfill        # archive + learnings + full Instagram history + scoring + mining
 */
import { getDb } from '@/lib/db/client';
import { seedReference } from '@/lib/seed';
import { DAILY_PIPELINE, JOBS, runNamedJob, runPipeline } from '@/lib/sync/registry';

const [kind = 'list', rawParams] = process.argv.slice(2);
const db = getDb();
seedReference(db);

function print(r: { kind: string; status: string; summary: string | null; error: string | null; recordsSeen: number; recordsWritten: number }) {
  const mark = r.status === 'succeeded' ? '✓' : r.status === 'partial' ? '◐' : r.status === 'skipped' ? '·' : '✗';
  console.log(`${mark} ${r.kind.padEnd(22)} ${r.status.padEnd(9)} seen=${r.recordsSeen} written=${r.recordsWritten}  ${r.summary ?? ''}${r.error ? `  ERROR: ${r.error}` : ''}`);
}

async function main() {
  if (kind === 'list') {
    for (const [k, d] of Object.entries(JOBS)) console.log(`${k.padEnd(24)} [${d.phase}] ${d.description}`);
    console.log(`\ndaily = ${DAILY_PIPELINE.join(' → ')}`);
    return;
  }
  const params = rawParams ? (JSON.parse(rawParams) as Record<string, unknown>) : {};
  if (kind === 'daily') {
    for (const r of await runPipeline(db)) print(r);
    return;
  }
  if (kind === 'backfill') {
    const steps = ['integration-check', 'import-archive', 'import-learning-memory', 'instagram-content', 'instagram-metrics', 'instagram-account', 'score', 'mine-lessons', 'rule-proposals', 'rule-challenges', 'opportunities', 'graph', 'search'];
    for (const r of await runPipeline(db, steps, { 'instagram-metrics': { all: true } })) print(r);
    return;
  }
  print(await runNamedJob(db, kind, params));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

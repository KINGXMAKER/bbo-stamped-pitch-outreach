/**
 * Ask BBO from the terminal:
 *   node scripts/with-env.mjs tsx scripts/ask-once.ts "What has BBO learned?"
 */
import { getDb } from '@/lib/db/client';
import { askBbo } from '@/lib/intel/ask';

const question = process.argv.slice(2).join(' ').trim();
if (!question) {
  console.error('usage: ask-once.ts "<question>"');
  process.exit(2);
}

const result = await askBbo(getDb(), question);
console.log(`Q: ${result.question}`);
console.log(`intent: ${result.intent.kind} (routed by ${result.routedBy}) · answered by ${result.answeredBy}`);
console.log(`evidence: ${result.evidence.title} · n=${result.evidence.sampleSize} · ${result.evidence.confidence}${result.evidence.dateRange ? ` · ${result.evidence.dateRange.from} → ${result.evidence.dateRange.to}` : ''}`);
console.log(`\n${result.answer}\n`);
for (const c of result.caveats) console.log(`⚠ ${c}`);
for (const t of result.evidence.tables) {
  console.log(`\n[${t.title}] ${t.columns.join(' | ')}`);
  for (const row of t.rows.slice(0, 6)) console.log(`  ${row.map((c) => (c === null ? '—' : String(c).slice(0, 60))).join(' | ')}`);
}

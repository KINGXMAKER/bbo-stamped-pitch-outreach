import { all, dbPath, getDb } from '@/lib/db/client';
import { seedReference } from '@/lib/seed';

const db = getDb();
seedReference(db);

const counts = all<{ name: string; n: number }>(
  db,
  `SELECT 'franchises' AS name, COUNT(*) AS n FROM franchises
   UNION ALL SELECT 'topics', COUNT(*) FROM topics
   UNION ALL SELECT 'attribute_definitions', COUNT(*) FROM attribute_definitions
   UNION ALL SELECT 'rules', COUNT(*) FROM rules
   UNION ALL SELECT 'skill_versions', COUNT(*) FROM skill_versions
   UNION ALL SELECT 'content', COUNT(*) FROM content`
);
console.log(`BBO BRAIN database ready at ${dbPath()}`);
for (const c of counts) console.log(`  ${c.name.padEnd(24)} ${c.n}`);

/**
 * Prints every role's system instruction, fully resolved.
 *
 * Generated rather than stored: the shared preamble is interpolated into all
 * eight roles, so a checked-in copy would drift the moment one block changed.
 * Run `npm run prompts` to see exactly what the models are being told today.
 */
const ROLES: Array<[label: string, file: string, exportName: string]> = [
  ['1. LOCATION SCOUT  (vision)', 'location-scout', 'LOCATION_SCOUT_SYSTEM'],
  ['2. REELS', 'reel-generator', 'REEL_SYSTEM'],
  ['3. MASTER SHOT LIST', 'shot-builder', 'SHOT_SYSTEM'],
  ['4. DEDUPE PASS', 'shot-builder', 'DEDUPE_SYSTEM'],
  ['5. PHOTO PLAN', 'photo-plan', 'PHOTO_SYSTEM'],
  ['6. SKITS', 'skit-generator', 'SKIT_SYSTEM'],
  ['7. EDIT BLUEPRINT', 'edit-blueprint', 'BLUEPRINT_SYSTEM'],
  ['8. PITCH INTEL', 'pitch-intel', 'PITCH_SYSTEM'],
];

const rule = '='.repeat(78);

for (const [label, file, exportName] of ROLES) {
  const loaded: Record<string, unknown> = await import(`../lib/ai/prompts/${file}.ts`);
  const text = loaded[exportName];
  if (typeof text !== 'string') {
    console.error(`\n${rule}\n${label}\n${rule}\n(missing export ${exportName} in ${file}.ts)`);
    process.exitCode = 1;
    continue;
  }
  console.log(`\n${rule}\n${label}\n${rule}\n${text}`);
}

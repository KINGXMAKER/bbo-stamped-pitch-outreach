#!/usr/bin/env node
/**
 * Loads ../.env (repo root) then ./.env.local into process.env, then runs the
 * given binary from node_modules/.bin with that environment.
 *
 * Next forks workers that inherit NODE_OPTIONS, and Node rejects
 * --env-file-if-exists there — so env loading happens here, not as a node flag.
 * Variables already set in the shell win over both files.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preset = new Set(Object.keys(process.env));

for (const file of [path.join(root, '..', '.env'), path.join(root, '.env.local')]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || preset.has(match[1])) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

const [bin, ...args] = process.argv.slice(2);
if (!bin) {
  console.error('usage: with-env.mjs <bin> [...args]');
  process.exit(2);
}
const child = spawn(path.join(root, 'node_modules', '.bin', bin), args, { stdio: 'inherit', env: process.env, cwd: root });
child.on('exit', (code, signal) => (signal ? process.kill(process.pid, signal) : process.exit(code ?? 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));

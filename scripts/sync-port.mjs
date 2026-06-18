#!/usr/bin/env node
// Computes the DirectTalk port from `portreg` and bakes it into
// src/port.generated.js so the server has a single source of truth.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = 'DirectTalk';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/port.generated.js');

function portreg(cmd) {
  return execFileSync('portreg', [cmd, APP], { encoding: 'utf8' }).trim();
}

let raw;
try {
  raw = portreg('get');
} catch {
  raw = portreg('assign');
}

const port = Number.parseInt(raw, 10);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`portreg returned an invalid port for ${APP}: ${JSON.stringify(raw)}`);
}

const contents = `// GENERATED FILE — DO NOT EDIT.
// Produced by scripts/sync-port.mjs from \`portreg ${APP}\`.
// Run \`npm run sync-port\` (or \`node scripts/sync-port.mjs\`) to regenerate.
module.exports = { PORT: ${port} };
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, contents);
console.log(`wrote ${OUT} (PORT=${port})`);

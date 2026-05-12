#!/usr/bin/env node
// S4 — PWA / service-worker sanity. Extract the precache manifest from
// dist/sw.js, assert every entry resolves under dist/, sanity-check the count
// against documented budgets.
//
// vite-plugin-pwa (injectManifest mode) inlines the manifest as a JSON array
// passed to Workbox's precache(...) call.

import { readFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const DIST = resolve('dist');
const PRECACHE_MIN = 10;
const PRECACHE_MAX = 100;

const sw = await readFile(join(DIST, 'sw.js'), 'utf8');

const arrayMatch = sw.match(/\[\{"revision":[^]*?\}\]/);
if (!arrayMatch) {
  console.error('Could not locate precache manifest array in dist/sw.js.');
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(arrayMatch[0]);
} catch (e) {
  console.error(`Precache manifest is not valid JSON: ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(manifest)) {
  console.error('Precache manifest is not an array.');
  process.exit(1);
}

if (manifest.length < PRECACHE_MIN) {
  console.error(`Precache count too low (${manifest.length} < ${PRECACHE_MIN}). PWA install likely broken.`);
  process.exit(1);
}
if (manifest.length > PRECACHE_MAX) {
  console.error(`Precache count exceeds budget (${manifest.length} > ${PRECACHE_MAX}). Investigate before shipping.`);
  process.exit(1);
}

let failures = 0;
for (const entry of manifest) {
  if (typeof entry.url !== 'string') {
    console.error(`Bad entry shape: ${JSON.stringify(entry)}`);
    failures += 1;
    continue;
  }
  const path = join(DIST, entry.url.startsWith('/') ? entry.url.slice(1) : entry.url);
  try {
    await access(path);
  } catch {
    console.error(`MISSING: precache entry ${entry.url} (looked for ${path})`);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`\nS4 failed: ${failures} broken precache entries`);
  process.exit(1);
}

console.log(`S4 OK: ${manifest.length} precache entries, all present in dist/.`);

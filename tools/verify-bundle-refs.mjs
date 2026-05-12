#!/usr/bin/env node
// S2 — Bundle integrity. Parse dist/index.html, extract every <script src> and
// <link href>, assert each one resolves to a real file inside dist/.
//
// Fails the release gate if any reference points at a missing file (broken
// build / pruning script ate something / mis-stripped asset). External URLs
// and data: URIs are skipped — only relative refs are validated.

import { readFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const DIST = resolve('dist');
const indexHtml = await readFile(join(DIST, 'index.html'), 'utf8');

const refs = new Set();
const tagPattern = /<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
for (const match of indexHtml.matchAll(tagPattern)) {
  const ref = match[1];
  if (ref.startsWith('data:') || /^[a-z]+:\/\//i.test(ref)) continue;
  refs.add(ref);
}

if (refs.size === 0) {
  console.error('No <script>/<link> refs found in dist/index.html — parser broken or HTML malformed.');
  process.exit(1);
}

let failures = 0;
for (const ref of refs) {
  const path = join(DIST, ref.startsWith('/') ? ref.slice(1) : ref);
  try {
    await access(path);
  } catch {
    console.error(`MISSING: ${ref} (looked for ${path})`);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`\nS2 failed: ${failures} broken reference(s) in dist/index.html`);
  process.exit(1);
}

console.log(`S2 OK: all ${refs.size} bundle refs in dist/index.html resolve.`);

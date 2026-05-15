#!/usr/bin/env node
// S8 — MIN_HELPER_VERSION coordination. Assert that the GUI's minimum
// required bsky-saves wheel version (lib/min-helper-version.ts) does not
// exceed the latest release published on PyPI.
//
// Without this gate a GUI release can raise MIN_HELPER_VERSION ahead of
// the wheel, and the moment bsky-saves bumps GUI_VERSION to bundle the
// new GUI, every wheel user is immediately out of compliance — the GUI
// renders OutdatedHelperBanner until they upgrade pipx, but there is no
// helper version to upgrade TO because bsky-saves hasn't released yet.
//
// Pass: MIN_HELPER_VERSION <= latest PyPI version. Either the current
//       wheel already satisfies the constraint, or bsky-saves has
//       already published the needed version and the wheel just needs
//       its GUI_VERSION bumped.
// Fail: MIN_HELPER_VERSION > latest PyPI version. Lower the minimum, or
//       release bsky-saves with the required version first.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PYPI_URL = 'https://pypi.org/pypi/bsky-saves/json';
const SRC = resolve('app/src/lib/min-helper-version.ts');

function parseSemver(v) {
  // Split on dots + dashes so pre-release suffixes like '1.2.3-rc1' parse;
  // non-numeric segments collapse to 0 (matches lib/min-helper-version.ts's
  // isHelperOutdated which treats non-numeric / missing segments as 0).
  return v.split(/[.-]/).map((s) => {
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? 0 : n;
  });
}

function isGreater(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

async function extractMinHelperVersion() {
  const src = await readFile(SRC, 'utf8');
  const m = src.match(/MIN_HELPER_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!m) {
    throw new Error(`Could not extract MIN_HELPER_VERSION from ${SRC}`);
  }
  return m[1];
}

async function fetchLatestPypiVersion() {
  const res = await fetch(PYPI_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`PyPI request failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const v = data?.info?.version;
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error('PyPI response missing info.version');
  }
  return v;
}

const min = await extractMinHelperVersion();
const latest = await fetchLatestPypiVersion();

console.log(`GUI MIN_HELPER_VERSION:   ${min}`);
console.log(`Latest bsky-saves (PyPI): ${latest}`);

if (isGreater(min, latest)) {
  console.error('');
  console.error(`FAIL: MIN_HELPER_VERSION (${min}) > latest bsky-saves release (${latest}).`);
  console.error('');
  console.error('A wheel bundling this GUI would orphan every user until');
  console.error(`bsky-saves ${min} ships on PyPI and they upgrade.`);
  console.error('');
  console.error('Either lower MIN_HELPER_VERSION in app/src/lib/min-helper-version.ts,');
  console.error('or release bsky-saves with the required version first.');
  process.exit(1);
}

console.log(`OK: MIN_HELPER_VERSION (${min}) <= latest bsky-saves release (${latest}).`);

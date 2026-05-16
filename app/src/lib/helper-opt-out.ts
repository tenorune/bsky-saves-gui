// "Don't use the local helper from this browser" — single-boolean
// preference. Mirrors the operator-proxy-opt-out shape.
//
// When true, the capability-snapshot:
//   1. Skips the /ping probe at startup entirely (saves a request, and
//      on Safari suppresses the unsilenceable mixed-content console
//      error that fires when probing http://localhost from an https
//      page).
//   2. Treats helper as 'unavailable' regardless of what the helper
//      would have reported. All helper-routed features (fetch / enrich
//      / threads / image / article) fall back to the non-helper paths
//      (Pyodide for fetch, worker proxy or Pyodide for images/articles).
//
// Surfaced via the "Don't pair" link on PairingRequiredBanner (sets
// true) and a "Use the local helper" toggle in Settings → Backups
// (sets either way). Cleared by Settings → "Reset preferences"
// alongside the other per-device prefs.

import { get, set, del } from 'idb-keyval';

const KEY = 'helper-opt-out:v1';

export async function loadHelperOptOut(): Promise<boolean> {
  return (await get(KEY)) === true;
}

export async function setHelperOptOut(optOut: boolean): Promise<void> {
  await set(KEY, optOut);
}

export async function clearHelperOptOut(): Promise<void> {
  await del(KEY);
}

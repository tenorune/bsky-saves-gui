// "Don't use the operator's image proxy" — single-boolean preference.
//
// Surfaced from Settings → Backup as a checkbox. When true, image-fetcher
// skips the operator-proxy backend during selection (the user prefers
// fetching only via local helper or their own deployed worker).
//
// Lives alone in its own module after the per-feature backup-prefs surface
// (snooze/dontAsk/enabled banner state) was removed. The shape is now a
// plain boolean — no wrapper struct.

import { get, set, del } from 'idb-keyval';

const KEY = 'operator-proxy-opt-out:v1';

export async function loadOperatorProxyOptOut(): Promise<boolean> {
  return (await get(KEY)) === true;
}

export async function setOperatorProxyOptOut(optOut: boolean): Promise<void> {
  await set(KEY, optOut);
}

export async function clearOperatorProxyOptOut(): Promise<void> {
  await del(KEY);
}

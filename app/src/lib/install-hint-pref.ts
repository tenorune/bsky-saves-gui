import { writable, type Readable } from 'svelte/store';
import { get as idbGet, set as idbSet } from 'idb-keyval';

const KEY = 'install-hint-dismissed:v1';

const store = writable<boolean>(false);
export const installHintDismissed: Readable<boolean> = { subscribe: store.subscribe };

export async function loadInstallHintPref(): Promise<void> {
  const raw = (await idbGet(KEY)) as boolean | undefined;
  store.set(raw === true);
}

export async function dismissInstallHint(): Promise<void> {
  store.set(true);
  await idbSet(KEY, true);
}

export async function restoreInstallHint(): Promise<void> {
  store.set(false);
  await idbSet(KEY, false);
}

/** For tests only — resets to false without touching IndexedDB. */
export function _resetInstallHintForTests(): void {
  store.set(false);
}

import { get, writable, type Readable } from 'svelte/store';
import { orchestrateRefresh as defaultOrchestrate } from './orchestrate-refresh';
import { saveInventory as defaultSaveInventory } from './inventory-store';
import { capabilitySnapshot } from './capability-snapshot';
import { config } from './config';
import type { FetchSavesCredentials } from './helper-client';

export type LibraryRefreshState =
  | { readonly status: 'idle' }
  | { readonly status: 'running' }
  | { readonly status: 'error'; readonly error: string };

const store = writable<LibraryRefreshState>({ status: 'idle' });
export const libraryRefreshState: Readable<LibraryRefreshState> = { subscribe: store.subscribe };

let _cancelled = false;

export interface StartLibraryRefreshInput {
  readonly credentials: FetchSavesCredentials;
  readonly includeThreads: boolean;
}

export interface StartLibraryRefreshDeps {
  readonly orchestrate?: typeof defaultOrchestrate;
  readonly saveInventory?: typeof defaultSaveInventory;
}

export async function startLibraryRefresh(
  input: StartLibraryRefreshInput,
  deps: StartLibraryRefreshDeps = {},
): Promise<void> {
  const orchestrate = deps.orchestrate ?? defaultOrchestrate;
  const saveInventory = deps.saveInventory ?? defaultSaveInventory;
  _cancelled = false;
  store.set({ status: 'running' });
  try {
    const inv = await orchestrate({
      credentials: input.credentials,
      includeThreads: input.includeThreads,
      snapshot: get(capabilitySnapshot),
      origin: config.helperOrigin,
    });
    if (_cancelled) return;
    await saveInventory(inv);
    store.set({ status: 'idle' });
  } catch (e) {
    if (_cancelled) return;
    const msg = e instanceof Error ? e.message : String(e);
    store.set({ status: 'error', error: msg });
  }
}

export function stopLibraryRefresh(): void {
  _cancelled = true;
  store.set({ status: 'idle' });
}

/** For tests only — resets the state to idle. */
export function _resetLibraryRefreshForTests(): void {
  _cancelled = false;
  store.set({ status: 'idle' });
}

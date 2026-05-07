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
  store.set({ status: 'running' });
  try {
    const inv = await orchestrate({
      credentials: input.credentials,
      includeThreads: input.includeThreads,
      snapshot: get(capabilitySnapshot),
      origin: config.helperOrigin,
    });
    await saveInventory(inv);
    store.set({ status: 'idle' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    store.set({ status: 'error', error: msg });
  }
}

/** For tests only — resets the state to idle. */
export function _resetLibraryRefreshForTests(): void {
  store.set({ status: 'idle' });
}

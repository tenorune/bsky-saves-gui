import { get, writable, type Readable } from 'svelte/store';
import { orchestrateRefresh as defaultOrchestrate } from './orchestrate-refresh';
import { saveInventory as defaultSaveInventory, loadInventory as defaultLoadInventory } from './inventory-store';
import { loadFromDb as defaultLoadFromDb } from './inventory-loader';
import { capabilitySnapshot } from './capability-snapshot';
import { config } from './config';
import { assetToggles } from './asset-toggles';
import { startImageBackup as defaultStartImageBackup } from './start-image-backup';
import { startArticleBackup as defaultStartArticleBackup } from './start-article-backup';
import type { FetchSavesCredentials } from './helper-client';
import type { PreauthSession } from './preauth-session';

export type { PreauthSession };

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
  readonly preauthSession?: PreauthSession;
}

export interface StartLibraryRefreshDeps {
  readonly orchestrate?: typeof defaultOrchestrate;
  readonly saveInventory?: typeof defaultSaveInventory;
  readonly loadFromDb?: typeof defaultLoadFromDb;
  readonly loadInventory?: typeof defaultLoadInventory;
  readonly startImageBackup?: typeof defaultStartImageBackup;
  readonly startArticleBackup?: typeof defaultStartArticleBackup;
}

export async function startLibraryRefresh(
  input: StartLibraryRefreshInput,
  deps: StartLibraryRefreshDeps = {},
): Promise<void> {
  const orchestrate = deps.orchestrate ?? defaultOrchestrate;
  const saveInventory = deps.saveInventory ?? defaultSaveInventory;
  const loadFromDb = deps.loadFromDb ?? defaultLoadFromDb;
  const loadInventory = deps.loadInventory ?? defaultLoadInventory;
  _cancelled = false;
  store.set({ status: 'running' });
  try {
    const inv = await orchestrate({
      credentials: input.credentials,
      includeThreads: input.includeThreads,
      snapshot: get(capabilitySnapshot),
      origin: config.helperOrigin,
      preauthSession: input.preauthSession,
    }, {
      onAfterEnrich: async (partialInv) => {
        if (_cancelled) return;
        await saveInventory(partialInv);
        await loadFromDb();
      },
    });
    // Persist the orchestrator's result *even when cancelled* so partial
    // progress isn't lost — e.g. if the user stops mid-thread-hydration,
    // the saves whose threads finished still have thread_replies merged in,
    // and we want that on disk so the next reload restores the count.
    await saveInventory(inv);
    await loadFromDb();
    if (_cancelled) {
      // User asked to stop. Don't kick off image/article hydration after.
      return;
    }
    store.set({ status: 'idle' });
    // Fire-and-forget: kick off image/article hydration in the background if their
    // toggles are on. Hydrators skip already-hydrated entries internally.
    const finalInv = await loadInventory();
    const toggles = get(assetToggles);
    const startImageBackup = deps.startImageBackup ?? defaultStartImageBackup;
    const startArticleBackup = deps.startArticleBackup ?? defaultStartArticleBackup;

    if (finalInv && toggles.images) {
      void startImageBackup(finalInv);
    }
    if (finalInv && toggles.articles) {
      void startArticleBackup(finalInv);
    }
  } catch (e) {
    if (_cancelled) return;
    const msg = e instanceof Error ? e.message : String(e);
    // Log so the browser console shows the actual error when the auth-error banner renders.
    // eslint-disable-next-line no-console
    console.error('[library-refresh] orchestrate failed:', msg, e);
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

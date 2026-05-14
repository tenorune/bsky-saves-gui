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
  // Snapshot the previously-saved inventory before fetch wipes hydrated
  // fields. Each fresh /fetch returns saves without article_text, local_images,
  // thread_replies, etc. — those are local-only annotations from prior
  // hydrator runs. We merge them back in mid-pipeline (after enrich, before
  // threads) so the threads/articles/images hydrators correctly skip work
  // that was already done.
  const priorInventory = await loadInventory();
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
        // COMPLETE-FETCH INVARIANT (preserve across refactors).
        // `partialInv` here is "post-enrich, pre-threads" — NOT a partial
        // page set. By the time `orchestrate` invokes this callback, the
        // fetch hydrator has already paginated the entire cursor chain to
        // completion (helper path) or returned the full inventory (Pyodide
        // path); an interrupted/failed fetch throws before `orchestrate`
        // ever reaches enrich. So `mergeHydratedFields` — and the v0.6.0
        // retain-flag reconcile that will extend it (see
        // docs/v0.6.0-retain-flag-gui-implementation-plan.md) — only ever
        // sees a complete fetch. This matters because absence-detection
        // (a URI present in prior but missing from the fetch ⇒ un-saved)
        // is only sound on a complete page set: running it on a partial
        // fetch would false-flag live bookmarks as removed and, under the
        // future `sync` / `keep-lost` modes, delete them. If a future
        // refactor moves the reconcile earlier or streams pages into it,
        // it MUST re-establish a "completed pagination" gate first.
        mergeHydratedFields(partialInv, priorInventory);
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

/**
 * Merge hydrated fields from priorInv onto saves in newInv (in place).
 * This is the SINGLE SOURCE OF TRUTH for which save-level fields are
 * "local-only annotations" — values produced by hydrators on this device
 * that a fresh /fetch wipes off the wire.
 *
 * Hydration invariant: never re-fetch what we already have. Each fresh
 * /fetch returns only the upstream save shape (uri, post_text, embed,
 * etc.); local annotations live ONLY on disk. Without this merge, every
 * Refresh would clobber accumulated state and the hydrators would treat
 * everything as needing work.
 *
 * Currently carried forward (key: rationale):
 *   - article_text     — body text written by hydrate-articles
 *   - article_title    — title written by hydrate-articles
 *   - article          — synthesized article object (url + text + title)
 *   - local_images     — pointer to image blobs in image-store IDB
 *   - thread_replies         — list of self-thread replies
 *   - thread_schema_version  — version of the reply-collection algorithm
 *   - thread_fetched_at      — ISO timestamp of the hydration
 *
 * Adding a new local-only annotation? Add it here too — same shape:
 * type-check the prior value and only fill the field on the new save when
 * it isn't already set. Never overwrite fresh data from the new fetch.
 */
function mergeHydratedFields(newInv: unknown, priorInv: unknown): void {
  if (!newInv || typeof newInv !== 'object') return;
  if (!priorInv || typeof priorInv !== 'object') return;
  const newSaves = (newInv as { saves?: unknown }).saves;
  const priorSaves = (priorInv as { saves?: unknown }).saves;
  if (!Array.isArray(newSaves) || !Array.isArray(priorSaves)) return;
  const priorByUri = new Map<string, Record<string, unknown>>();
  for (const s of priorSaves) {
    if (s && typeof s === 'object' && typeof (s as { uri?: unknown }).uri === 'string') {
      priorByUri.set((s as { uri: string }).uri, s as Record<string, unknown>);
    }
  }
  for (const save of newSaves) {
    if (!save || typeof save !== 'object') continue;
    const s = save as Record<string, unknown>;
    if (typeof s.uri !== 'string') continue;
    const prev = priorByUri.get(s.uri);
    if (!prev) continue;
    if (typeof prev.article_text === 'string' && typeof s.article_text !== 'string') {
      s.article_text = prev.article_text;
    }
    if (typeof prev.article_title === 'string' && typeof s.article_title !== 'string') {
      s.article_title = prev.article_title;
    }
    if (prev.article && typeof prev.article === 'object' && !s.article) {
      s.article = prev.article;
    }
    if (Array.isArray(prev.local_images) && !Array.isArray(s.local_images)) {
      s.local_images = prev.local_images;
    }
    if (Array.isArray(prev.thread_replies) && !Array.isArray(s.thread_replies)) {
      s.thread_replies = prev.thread_replies;
      if (prev.thread_schema_version !== undefined) {
        s.thread_schema_version = prev.thread_schema_version;
      }
      if (prev.thread_fetched_at !== undefined) {
        s.thread_fetched_at = prev.thread_fetched_at;
      }
    }
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

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
import { retainMode, loadRetainMode, type RetainMode } from './retain-mode';

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
  // The reconcile (below) needs the user's retain mode; make sure it's been
  // hydrated from IndexedDB even if Settings was never opened this session.
  await loadRetainMode();
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
        // ever reaches enrich. So `reconcileInventory` only ever sees a
        // complete fetch. This matters because absence-detection (a URI
        // present in prior but missing from the fetch ⇒ un-saved) is only
        // sound on a complete page set: running it on a partial fetch would
        // false-flag live bookmarks as removed and, under `sync` /
        // `keep-lost`, delete them. If a future refactor moves the reconcile
        // earlier or streams pages into it, it MUST re-establish a
        // "completed pagination" gate first.
        const freshSaves = (partialInv as { saves?: unknown }).saves;
        const reconciled = reconcileInventory(
          Array.isArray(freshSaves) ? freshSaves : [],
          priorInventory as { fetched_at?: unknown; saves?: unknown } | null,
          get(retainMode),
          new Date().toISOString(),
        );
        await saveInventory(reconciled);
        await loadFromDb();
        // Hand the reconciled (possibly smaller) set back to orchestrate so
        // the threads hydrator and final save continue from it.
        return reconciled;
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
 * Fill local-only hydration annotations onto `s` from `prev` — only where `s`
 * doesn't already carry them. This is the SINGLE SOURCE OF TRUTH for which
 * save-level fields are "local-only annotations": values produced by hydrators
 * on this device that a fresh /fetch wipes off the wire. Used as step 3 of the
 * v0.6.0 reconcile (see `reconcilePresent`).
 *
 * Hydration invariant: never re-fetch what we already have. Each fresh /fetch
 * returns only the upstream save shape (uri, post_text, embed, etc.); local
 * annotations live ONLY on disk. Without this fill, every Refresh would clobber
 * accumulated state and the hydrators would treat everything as needing work.
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
function fillHydratedFields(
  s: Record<string, unknown>,
  prev: Record<string, unknown> | undefined,
): void {
  if (!prev) return;
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

// ── v0.6.0 retain-flag reconcile ──────────────────────────────────────────
//
// `reconcileInventory` is the GUI's port of the CLI's §4 reconcile, verified
// against the shared golden fixtures (see reconcile-fixtures.test.ts). Unlike
// `mergeHydratedFields` — which only field-fills hydration annotations and
// NEVER changes the save *set* — the reconcile also:
//   - stamps `last_seen_at`, clears `removed_detected_at` on reappearance,
//     and runs the three-case `subject_status` reconciliation,
//   - drops absent-URI entries (`keep-lost` / `sync`) or retains + flags them
//     `removed_detected_at` (`keep-all`),
//   - prunes dead-subject entries (`sync` only).
// It returns a NEW inventory; `now` is injected so the fixtures stay
// deterministic. Inventory-level `fetched_at` is carried through from the
// prior inventory unchanged.

type RawRecord = Record<string, unknown>;
type SubjectStatusLiteral = 'not_found' | 'blocked' | 'unknown';

export interface RawInventory {
  readonly fetched_at: string;
  readonly saves: RawRecord[];
}

function asSubjectStatus(v: unknown): SubjectStatusLiteral | undefined {
  return v === 'not_found' || v === 'blocked' || v === 'unknown' ? v : undefined;
}

function indexByUri(records: readonly unknown[]): Map<string, RawRecord> {
  const map = new Map<string, RawRecord>();
  for (const r of records) {
    if (r && typeof r === 'object' && typeof (r as RawRecord).uri === 'string') {
      map.set((r as RawRecord).uri as string, r as RawRecord);
    }
  }
  return map;
}

// A URI present in the complete fetch. The fresh record is the base when the
// subject is live (its content is trustworthy); for a not_found/blocked/unknown
// fetch the body comes back empty, so we keep the prior entry's content and
// only update the lifecycle fields.
function reconcilePresent(
  fresh: RawRecord,
  prior: RawRecord | undefined,
  now: string,
): RawRecord {
  const freshStatus = asSubjectStatus(fresh.subject_status);
  let base: RawRecord;

  if (freshStatus === undefined) {
    // Live subject — fresh content wins, prior fills hydration gaps.
    base = { ...fresh };
    fillHydratedFields(base, prior);
    delete base.subject_status;
    delete base.subject_status_detected_at;
  } else {
    // Dead-subject or content-blind fetch — keep prior content if we have it.
    base = prior ? { ...prior } : { ...fresh };
    if (freshStatus === 'unknown') {
      // `unknown` is a no-op on any existing entry: never overwrites, weakens,
      // or clears a known status. Stored only for a brand-new URI, and even
      // then without a detection timestamp.
      if (!prior) {
        base.subject_status = 'unknown';
        delete base.subject_status_detected_at;
      }
    } else {
      const priorStatus = prior ? asSubjectStatus(prior.subject_status) : undefined;
      base.subject_status = freshStatus;
      if (priorStatus === freshStatus && typeof prior?.subject_status_detected_at === 'string') {
        base.subject_status_detected_at = prior.subject_status_detected_at;
      } else {
        // Transition (incl. brand-new URI and unknown → known) — stamp now.
        base.subject_status_detected_at = now;
      }
    }
  }

  base.last_seen_at = now;
  // Present in a complete fetch ⇒ still saved.
  delete base.removed_detected_at;
  return base;
}

// A URI in the prior inventory but absent from the complete fetch — the user
// un-saved it. Only reached under `keep-all`; the caller drops it otherwise.
function reconcileAbsentKeepAll(prior: RawRecord, now: string): RawRecord {
  const base = { ...prior };
  // last_seen_at is NOT refreshed — we didn't see it this fetch. Keep an
  // existing removal timestamp; only stamp the first detection.
  if (typeof base.removed_detected_at !== 'string') {
    base.removed_detected_at = now;
  }
  return base;
}

export function reconcileInventory(
  fetchRecords: readonly unknown[],
  priorInventory: { readonly fetched_at?: unknown; readonly saves?: unknown } | null | undefined,
  mode: RetainMode,
  now: string,
): RawInventory {
  const fetchByUri = indexByUri(fetchRecords);
  const priorSaves = Array.isArray(priorInventory?.saves)
    ? (priorInventory.saves as unknown[])
    : [];
  const priorByUri = indexByUri(priorSaves);

  let saves: RawRecord[] = [];

  for (const [uri, fresh] of fetchByUri) {
    saves.push(reconcilePresent(fresh, priorByUri.get(uri), now));
  }
  for (const [uri, prior] of priorByUri) {
    if (fetchByUri.has(uri)) continue;
    if (mode === 'keep-all') {
      saves.push(reconcileAbsentKeepAll(prior, now));
    }
    // keep-lost / sync: an un-saved entry is dropped.
  }

  if (mode === 'sync') {
    // sync keeps only what's live on Bluesky — prune dead-subject entries.
    saves = saves.filter((s) => {
      const st = s.subject_status;
      return st !== 'not_found' && st !== 'blocked';
    });
  }

  saves.sort((a, b) => {
    const av = typeof a.saved_at === 'string' ? a.saved_at : '';
    const bv = typeof b.saved_at === 'string' ? b.saved_at : '';
    return av < bv ? 1 : av > bv ? -1 : 0;
  });

  return {
    fetched_at: typeof priorInventory?.fetched_at === 'string' ? priorInventory.fetched_at : now,
    saves,
  };
}

// The immediate-apply path for a narrowing retain-mode change (Task D): when
// the user picks a narrower mode in Settings we apply that mode's retention
// rules to the inventory on disk right then, so the confirm dialog's
// present-tense copy ("This will remove …") is accurate. This is just §4
// reconcile steps 4–5 — no fetch, no absence-detection — so it can run on the
// stored inventory alone.
function isRetainedUnder(save: RawRecord, mode: RetainMode): boolean {
  if (mode === 'keep-all') return true;
  // keep-lost and sync both drop entries the user un-saved.
  if (save.removed_detected_at) return false;
  if (mode === 'sync') {
    // sync additionally prunes dead-subject entries.
    const st = save.subject_status;
    if (st === 'not_found' || st === 'blocked') return false;
  }
  return true;
}

export function applyRetainMode(
  inventory: { readonly fetched_at?: unknown; readonly saves?: unknown } | null | undefined,
  mode: RetainMode,
): RawInventory {
  const priorSaves = Array.isArray(inventory?.saves) ? (inventory.saves as unknown[]) : [];
  const saves = priorSaves.filter(
    (s): s is RawRecord => !!s && typeof s === 'object' && isRetainedUnder(s as RawRecord, mode),
  );
  return {
    fetched_at: typeof inventory?.fetched_at === 'string' ? inventory.fetched_at : '',
    saves,
  };
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

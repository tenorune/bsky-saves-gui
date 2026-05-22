// Push library status to the local helper for the installer panel.
// See docs/superpowers/specs/2026-05-21-status-snapshot-push-design.md
// and bsky-saves-coordination:docs/installer-status-panel.md (canonical
// contract).

import type { LastSession } from './last-session';
import type { PairingState } from './pairing-token';
import type { Readable } from 'svelte/store';
import { get } from 'svelte/store';
import { config } from './config';
import { pairingToken } from './pairing-token';
import { lastSession as lastSessionStore } from './last-session';
import { libraryRefreshState, type LibraryRefreshState } from './library-refresh';
import { inventoryState } from './inventory-loader';
import {
  imageHydration, articleHydration, threadProgress, fetchProgress,
  type HydrationProgress, type HydrationStatus,
} from './hydration-state';
import { persistenceMode } from './persistence-mode';
import { capabilitySnapshot } from './capability-snapshot';
import { buildStatusPayload, type StatusSnapshotInputs, type LastActivity } from './status-payload';
import { handleAuthed401 } from './helper-client';
import { loadLastActivity, saveLastActivity } from './last-activity-persist';

export interface ActivationInputs {
  readonly helperDetected: boolean;
  readonly pairingState: PairingState;
  readonly lastSession: LastSession | null;
}

/**
 * Pusher activation gate. All three conditions must hold for pushes
 * to fire. A `stale` pairing state is intentionally not active —
 * pushing would 401 repeatedly until the user re-pairs.
 *
 * Helper opt-out is reflected upstream via
 * `capabilitySnapshot.helper.detected` (see capability-snapshot.ts):
 * when the user opts out, `detected` is false, which fails the gate.
 */
export function isActive(inputs: ActivationInputs): boolean {
  return (
    inputs.helperDetected &&
    inputs.pairingState === 'paired' &&
    inputs.lastSession !== null
  );
}

// Internal "current activity" tracker. Updated by libraryRefreshState
// transitions and hydration store activity (wired in initStatusPusher
// via watchLibraryRefreshActivity / watchHydrationActivity). Lives at
// module scope so it survives across pushes.
//
// TODO: `added` / `removed` from the reconcile diff would require
// library-refresh.ts to expose the last diff in LibraryRefreshState
// (currently it's a local in reconcileInventory). Deferred — the panel
// renders zeros gracefully and the field is informational, not
// load-bearing.
let currentActivity: LastActivity = {
  kind: 'idle', started_at: null, finished_at: null,
  added: 0, removed: 0, errors: [],
};

function nowIso(): string {
  return new Date().toISOString();
}

// Map a hydrator's `{url, reason}` failure to the `{kind, message, count}`
// shape the status payload expects. Each failure becomes one entry; the
// panel can collapse duplicates if it wants.
function mapHydrationFailures(
  failures: HydrationProgress['failures'],
): LastActivity['errors'] {
  return failures.map((f) => ({
    kind: 'hydration_error',
    message: f.reason,
    count: 1,
  }));
}

function watchHydrationActivity(
  label: 'images' | 'articles' | 'threads',
  store: Readable<HydrationProgress>,
): () => void {
  let prevStatus: HydrationStatus | null = null;
  return store.subscribe((state) => {
    if (prevStatus === 'idle' && state.status === 'running') {
      currentActivity = {
        kind: `hydrate_${label}` as LastActivity['kind'],
        started_at: nowIso(),
        finished_at: null,
        added: 0,
        removed: 0,
        errors: [],
      };
      void saveLastActivity(currentActivity);
    } else if (prevStatus === 'running' && state.status === 'done') {
      currentActivity = {
        ...currentActivity,
        finished_at: nowIso(),
        errors: mapHydrationFailures(state.failures),
      };
      void saveLastActivity(currentActivity);
    }
    prevStatus = state.status;
  });
}

function watchLibraryRefreshActivity(): () => void {
  let prevStatus: LibraryRefreshState['status'] | null = null;
  return libraryRefreshState.subscribe((state) => {
    if (prevStatus === 'idle' && state.status === 'running') {
      currentActivity = {
        kind: 'fetch',
        started_at: nowIso(),
        finished_at: null,
        added: 0,
        removed: 0,
        errors: [],
      };
      void saveLastActivity(currentActivity);
    } else if (prevStatus === 'running' && state.status === 'idle') {
      currentActivity = { ...currentActivity, finished_at: nowIso() };
      void saveLastActivity(currentActivity);
    } else if (prevStatus === 'running' && state.status === 'error') {
      currentActivity = {
        ...currentActivity,
        finished_at: nowIso(),
        errors: [{ kind: 'refresh_error', message: state.error, count: 1 }],
      };
      void saveLastActivity(currentActivity);
    }
    prevStatus = state.status;
  });
}

let browserBytesCache: { bytes: number | null; refreshedAt: number } = { bytes: null, refreshedAt: 0 };

async function refreshBrowserBytesIfStale(): Promise<number | null> {
  const now = Date.now();
  if (now - browserBytesCache.refreshedAt < 60_000) return browserBytesCache.bytes;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      browserBytesCache = { bytes: est.usage ?? null, refreshedAt: now };
      return browserBytesCache.bytes;
    }
  } catch { /* ignore */ }
  browserBytesCache = { bytes: null, refreshedAt: now };
  return null;
}

// Locked by R6 (installer-status-panel-resolved.md). 500ms is the
// floor the contract guarantees; we may tighten to 250ms later
// without a contract change.
export const DEBOUNCE_MS = 500;

let lastPushAt = 0;
let trailingTimer: ReturnType<typeof setTimeout> | null = null;
let trailingPending = false;

function schedulePush(activeNow: boolean): void {
  if (!activeNow) return;
  const now = Date.now();
  if (now - lastPushAt >= DEBOUNCE_MS && trailingTimer === null) {
    // Immediate (rising edge). `lastPushAt` is updated inside pushOnce().
    void pushOnce();
    return;
  }
  // Within cooldown — schedule a single trailing push at the end of the window.
  trailingPending = true;
  if (trailingTimer === null) {
    const remaining = Math.max(0, DEBOUNCE_MS - (now - lastPushAt));
    trailingTimer = setTimeout(() => {
      trailingTimer = null;
      if (trailingPending) {
        trailingPending = false;
        // `lastPushAt` is updated inside pushOnce().
        void pushOnce();
      }
    }, remaining);
  }
}

// Test surface — bypasses the activation check so debounce behavior
// can be asserted independently of activation logic.
export function schedulePushForTests(): void {
  schedulePush(true);
}

function flushDebouncer(): void {
  if (trailingTimer !== null) { clearTimeout(trailingTimer); trailingTimer = null; }
  trailingPending = false;
  lastPushAt = 0;
}

interface PushOnceOptions {
  readonly priority?: 'final';
}

interface GatherInputsOptions {
  readonly priority?: 'final';
}

// Build the StatusSnapshotInputs from current store reads. Always uses
// the cached browser-bytes value; callers that want a fresh estimate
// (pushOnce) call refreshBrowserBytesIfStale() first. beforeunload skips
// that because async work isn't reliable while the page is unloading.
function gatherInputs(options: GatherInputsOptions = {}): StatusSnapshotInputs {
  return {
    inventoryState: get(inventoryState),
    libraryRefreshState: get(libraryRefreshState),
    fetchProgress: get(fetchProgress),
    imageHydration: get(imageHydration),
    articleHydration: get(articleHydration),
    threadProgress: get(threadProgress),
    persistenceMode: get(persistenceMode),
    lastSession: get(lastSessionStore),
    browserBytesEstimate: browserBytesCache.bytes,
    lastActivity: currentActivity,
    ...(options.priority ? { priority: options.priority } : {}),
  };
}

/**
 * Tell the helper to drop the persisted status snapshot. Called by
 * Settings.svelte's "Clear all data" handler BEFORE `clearPairingToken()`
 * so the bearer token is still available for auth.
 *
 * Resolves silently on any failure — local cleanup is the source of
 * truth, and the user's "wipe everything" intent should proceed even
 * if the helper-side delete can't complete.
 */
export async function deleteStatus(): Promise<void> {
  const { state, token } = get(pairingToken);
  if (token === null || state === 'unpaired') return;
  try {
    const res = await fetch(`${config.helperOrigin}/status`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    handleAuthed401(res, true);
  } catch {
    /* best-effort; local wipe proceeds */
  }
}

async function pushOnce(options: PushOnceOptions = {}): Promise<void> {
  // Centralize the throttle bookkeeping so every push path (schedulePush
  // immediate, schedulePush trailing, rising-edge in reevaluateActivation,
  // and the heartbeat setInterval) updates it. Otherwise a heartbeat at
  // t=0 followed by a store-change at t=0.1s would re-fire immediately
  // because `lastPushAt` was stale from before the heartbeat.
  lastPushAt = Date.now();
  await refreshBrowserBytesIfStale();
  const inputs = gatherInputs(options);
  const payload = buildStatusPayload(inputs);
  if (payload === null) return;
  const { token } = get(pairingToken);
  if (token === null) return;
  try {
    const res = await fetch(`${config.helperOrigin}/status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    handleAuthed401(res, true);
  } catch {
    console.debug('[status-push] failed (network)');
  }
}

// Module-level activation state — updated by store subscriptions in the real
// codepath, or by `_setActivationForTests` in tests.
let activation: ActivationInputs = {
  helperDetected: false, pairingState: 'unpaired', lastSession: null,
};
let wasActive = false;
let subscriptionDisposers: Array<() => void> = [];

// Locked by R7 (installer-status-panel-resolved.md). Heartbeat
// cadence must be ≤ TTL/3 to survive a missed push.
export const HEARTBEAT_MS = 15_000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
// Cached so the heartbeat gate (refreshHeartbeat) can read it
// synchronously without re-subscribing on every call. Kept in sync
// via the persistenceMode subscription in initStatusPusher and
// overridable in tests via _setPersistenceModeForTests.
let persistenceModeNow: 'persist' | 'session-only' = 'persist';

function refreshHeartbeat(): void {
  const shouldRun = isActive(activation) && persistenceModeNow === 'session-only';
  if (shouldRun && heartbeatTimer === null) {
    heartbeatTimer = setInterval(() => {
      void pushOnce();
    }, HEARTBEAT_MS);
  } else if (!shouldRun && heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

export function _setPersistenceModeForTests(mode: 'persist' | 'session-only'): void {
  persistenceModeNow = mode;
  refreshHeartbeat();
}

function reevaluateActivation(): void {
  const nowActive = isActive(activation);
  if (nowActive && !wasActive) {
    // Dormant → Active. Fire the immediate fresh-state push.
    void pushOnce();
  }
  // Active → Dormant doesn't need an action here — the debouncer simply
  // stops scheduling because schedulePush() checks isActive(activation).
  wasActive = nowActive;
  refreshHeartbeat();
}

export function initStatusPusher(): void {
  // Avoid double-subscription on repeat calls (defensive — main.ts calls once).
  if (subscriptionDisposers.length > 0) return;

  // Restore the persisted last_activity from idb so the activation-rising-edge
  // "fresh-state" push (fired below by the activation subscriptions) doesn't
  // clobber the helper's on-disk snapshot with the in-memory `{ kind: 'idle' }`
  // default after a tab close + reopen. Fire-and-forget — if it resolves after
  // the immediate push, we still apply the restored value for subsequent
  // pushes. We only restore when `currentActivity` is still in its initial
  // state, so a real activity transition that fires before this resolves wins.
  void loadLastActivity().then((restored) => {
    if (restored === null) return;
    if (currentActivity.kind === 'idle' && currentActivity.started_at === null) {
      currentActivity = restored;
    }
  });

  // Build the activation snapshot from the upstream stores; rebuild on any change.
  const updateActivation = (): void => {
    const snap = get(capabilitySnapshot);
    const state = get(pairingToken);
    const session = get(lastSessionStore);
    activation = {
      helperDetected: snap.helper.detected,
      pairingState: state.state,
      lastSession: session,
    };
    reevaluateActivation();
  };

  subscriptionDisposers.push(capabilitySnapshot.subscribe(() => updateActivation()));
  subscriptionDisposers.push(pairingToken.subscribe(() => updateActivation()));
  subscriptionDisposers.push(lastSessionStore.subscribe(() => updateActivation()));

  // Subscribe to "interesting" stores; any change triggers a debounced push.
  const onChange = (): void => schedulePush(isActive(activation));
  subscriptionDisposers.push(inventoryState.subscribe(onChange));
  subscriptionDisposers.push(libraryRefreshState.subscribe(onChange));
  subscriptionDisposers.push(fetchProgress.subscribe(onChange));
  subscriptionDisposers.push(imageHydration.subscribe(onChange));
  subscriptionDisposers.push(articleHydration.subscribe(onChange));
  subscriptionDisposers.push(threadProgress.subscribe(onChange));
  subscriptionDisposers.push(persistenceMode.subscribe((m) => {
    persistenceModeNow = m;
    refreshHeartbeat();
    schedulePush(isActive(activation));
  }));

  // last_activity wiring — separate subscriptions so the activity record
  // updates BEFORE the onChange subscription above triggers the debounced
  // push. Subscribe order matters: Svelte invokes subscribers in
  // registration order, so registering the activity watchers after the
  // onChange handler would push a stale `currentActivity` on the rising
  // edge. Wait — actually, both subscriptions read the SAME store update;
  // schedulePush runs synchronously and only enqueues a microtask
  // (immediate path) or sets a timer (trailing). By the time pushOnce
  // actually serializes the payload, all subscribers for the current
  // store change have already run. Subscribe order is therefore not
  // load-bearing for correctness here, but kept close to the other
  // subscribers for readability.
  subscriptionDisposers.push(watchLibraryRefreshActivity());
  subscriptionDisposers.push(watchHydrationActivity('images', imageHydration));
  subscriptionDisposers.push(watchHydrationActivity('articles', articleHydration));
  subscriptionDisposers.push(watchHydrationActivity('threads', threadProgress));

  // Persist-mode beforeunload final push. `keepalive: true` lets the
  // request outlive the page; `sendBeacon` would be more reliable but
  // doesn't support custom auth headers. See spec §7.
  if (typeof window !== 'undefined') {
    const beforeUnloadHandler = (): void => {
      if (!isActive(activation) || persistenceModeNow !== 'persist') return;
      const inputs = gatherInputs({ priority: 'final' });
      const payload = buildStatusPayload(inputs);
      if (payload === null) return;
      const { token } = get(pairingToken);
      if (token === null) return;
      try {
        fetch(`${config.helperOrigin}/status`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
          keepalive: true,
        })
          .then((res) => handleAuthed401(res, true))
          .catch(() => {});
      } catch { /* page is unloading; nothing to recover from */ }
    };
    window.addEventListener('beforeunload', beforeUnloadHandler);
    subscriptionDisposers.push(() => window.removeEventListener('beforeunload', beforeUnloadHandler));
  }
}

export function _disposeStatusPusherForTests(): void {
  if (heartbeatTimer !== null) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  for (const dispose of subscriptionDisposers) dispose();
  subscriptionDisposers = [];
  activation = { helperDetected: false, pairingState: 'unpaired', lastSession: null };
  wasActive = false;
}

export function _setActivationForTests(next: ActivationInputs): void {
  activation = next;
  reevaluateActivation();
}

// Test surfaces — exposed only to bypass the activation snapshot logic.
// Real code path uses pushOnce() gated by isActive() in schedulePush().

export function _resetStatusPusherForTests(): void {
  flushDebouncer();
  wasActive = false;
  activation = { helperDetected: false, pairingState: 'unpaired', lastSession: null };
  currentActivity = { kind: 'idle', started_at: null, finished_at: null, added: 0, removed: 0, errors: [] };
  browserBytesCache = { bytes: null, refreshedAt: 0 };
  // Tests that exercise persistence import clearLastActivity directly;
  // we intentionally don't wipe idb here to avoid masking failures in
  // tests that rely on a clean idb being set up explicitly.
}

export function _getCurrentActivityForTests(): LastActivity {
  return currentActivity;
}

export interface PusherDeps {
  readonly activation: ActivationInputs;
  readonly pairingToken: string | null;
  readonly helperOrigin: string;
  readonly payloadInputs: StatusSnapshotInputs;
}

export async function pushSnapshotForTests(deps: PusherDeps): Promise<void> {
  if (!isActive(deps.activation)) return;
  if (deps.pairingToken === null) return;
  const payload = buildStatusPayload(deps.payloadInputs ?? {
    inventoryState: { status: 'loading' },
    libraryRefreshState: { status: 'idle' },
    fetchProgress: { status: 'idle', total: 0, fetched: 0, skipped: 0, failed: 0, failures: [] },
    imageHydration: { status: 'idle', total: 0, fetched: 0, skipped: 0, failed: 0, failures: [] },
    articleHydration: { status: 'idle', total: 0, fetched: 0, skipped: 0, failed: 0, failures: [] },
    threadProgress: { status: 'idle', total: 0, fetched: 0, skipped: 0, failed: 0, failures: [] },
    persistenceMode: 'persist',
    lastSession: deps.activation.lastSession,
    browserBytesEstimate: null,
    lastActivity: currentActivity,
  });
  if (payload === null) return;
  try {
    const res = await fetch(`${deps.helperOrigin}/status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${deps.pairingToken}`,
      },
      body: JSON.stringify(payload),
    });
    handleAuthed401(res, true);
  } catch {
    /* swallow */
  }
}

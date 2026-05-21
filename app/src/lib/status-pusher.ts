// Push library status to the local helper for the installer panel.
// See docs/superpowers/specs/2026-05-21-status-snapshot-push-design.md
// and bsky-saves-coordination:docs/installer-status-panel.md (canonical
// contract).

import type { LastSession } from './last-session';
import type { PairingState } from './pairing-token';
import { get } from 'svelte/store';
import { config } from './config';
import { pairingToken } from './pairing-token';
import { lastSession as lastSessionStore } from './last-session';
import { libraryRefreshState } from './library-refresh';
import { inventoryState } from './inventory-loader';
import {
  imageHydration, articleHydration, threadProgress, fetchProgress,
} from './hydration-state';
import { persistenceMode } from './persistence-mode';
import { capabilitySnapshot } from './capability-snapshot';
import { buildStatusPayload, type StatusSnapshotInputs, type LastActivity } from './status-payload';

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
// transitions and hydration store activity. Lives at module scope so
// it survives across pushes.
let currentActivity: LastActivity = {
  kind: 'idle', started_at: null, finished_at: null,
  added: 0, removed: 0, errors: [],
};

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
    // Immediate (rising edge).
    lastPushAt = now;
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
        lastPushAt = Date.now();
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

export function _flushDebouncerForTests(): void {
  if (trailingTimer !== null) { clearTimeout(trailingTimer); trailingTimer = null; }
  trailingPending = false;
  lastPushAt = 0;
}

interface PushOnceOptions {
  readonly priority?: 'final';
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
    await fetch(`${config.helperOrigin}/status`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* best-effort; local wipe proceeds */
  }
}

export async function pushOnce(options: PushOnceOptions = {}): Promise<void> {
  const inputs: StatusSnapshotInputs = {
    inventoryState: get(inventoryState),
    libraryRefreshState: get(libraryRefreshState),
    fetchProgress: get(fetchProgress),
    imageHydration: get(imageHydration),
    articleHydration: get(articleHydration),
    threadProgress: get(threadProgress),
    persistenceMode: get(persistenceMode),
    lastSession: get(lastSessionStore),
    browserBytesEstimate: await refreshBrowserBytesIfStale(),
    lastActivity: currentActivity,
    ...(options.priority ? { priority: options.priority } : {}),
  };
  const payload = buildStatusPayload(inputs);
  if (payload === null) return;
  const { token } = get(pairingToken);
  if (token === null) return;
  try {
    await fetch(`${config.helperOrigin}/status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
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

  // Persist-mode beforeunload final push. `keepalive: true` lets the
  // request outlive the page; `sendBeacon` would be more reliable but
  // doesn't support custom auth headers. See spec §7.
  if (typeof window !== 'undefined') {
    const beforeUnloadHandler = (): void => {
      if (!isActive(activation) || persistenceModeNow !== 'persist') return;
      const inputs: StatusSnapshotInputs = {
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
        priority: 'final',
      };
      const payload = buildStatusPayload(inputs);
      if (payload === null) return;
      const { token } = get(pairingToken);
      if (token === null) return;
      try {
        void fetch(`${config.helperOrigin}/status`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
          keepalive: true,
        });
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
// Real code path uses pushOnce() gated by isActive() in scheduleAndPush().

export function _resetStatusPusherForTests(): void {
  _flushDebouncerForTests();
  currentActivity = { kind: 'idle', started_at: null, finished_at: null, added: 0, removed: 0, errors: [] };
  browserBytesCache = { bytes: null, refreshedAt: 0 };
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
    await fetch(`${deps.helperOrigin}/status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${deps.pairingToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    /* swallow */
  }
}

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
import { buildStatusPayload, type StatusSnapshotInputs, type LastActivity } from './status-payload';

export interface ActivationInputs {
  readonly helperDetected: boolean;
  readonly pairingState: PairingState;
  readonly helperOptOut: boolean;
  readonly lastSession: LastSession | null;
}

/**
 * Pusher activation gate. All four conditions must hold for pushes
 * to fire. A `stale` pairing state is intentionally not active —
 * pushing would 401 repeatedly until the user re-pairs.
 */
export function isActive(inputs: ActivationInputs): boolean {
  return (
    inputs.helperDetected &&
    inputs.pairingState === 'paired' &&
    !inputs.helperOptOut &&
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

interface PushOnceOptions {
  readonly priority?: 'final';
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

// Test surfaces — exposed only to bypass the activation snapshot logic.
// Real code path uses pushOnce() gated by isActive() in scheduleAndPush().

export function _resetStatusPusherForTests(): void {
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

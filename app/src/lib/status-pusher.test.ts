import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

// Mock the persistence module so the in-memory wiring tests don't touch
// real fake-indexeddb. Each watcher's fire-and-forget saveLastActivity
// becomes a spy we can assert against; loadLastActivity defaults to
// resolving null (the "no prior session" case) so tests in describes
// that don't explicitly configure it still get a Promise back. Tests
// that care about the restore path set mockResolvedValueOnce themselves.
const persistMock = vi.hoisted(() => ({
  loadLastActivity: vi.fn().mockResolvedValue(null),
  saveLastActivity: vi.fn().mockResolvedValue(undefined),
  clearLastActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./last-activity-persist', () => persistMock);
import {
  _resetStatusPusherForTests,
  isActive,
  pushSnapshotForTests,
  type ActivationInputs,
} from './status-pusher';
import { schedulePushForTests, DEBOUNCE_MS } from './status-pusher';
import { initStatusPusher, _disposeStatusPusherForTests, _setActivationForTests } from './status-pusher';
import { HEARTBEAT_MS, _setPersistenceModeForTests } from './status-pusher';
import { setLastSession, clearLastSession } from './last-session';
import { setPairingToken, clearPairingToken, pairingToken } from './pairing-token';

const PAIRED: ActivationInputs = {
  helperDetected: true,
  pairingState: 'paired',
  lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' },
};

describe('isActive', () => {
  it('returns true when all three conditions hold', () => {
    expect(isActive(PAIRED)).toBe(true);
  });

  it('returns false when helper is not detected', () => {
    expect(isActive({ ...PAIRED, helperDetected: false })).toBe(false);
  });

  it('returns false when pairing state is unpaired', () => {
    expect(isActive({ ...PAIRED, pairingState: 'unpaired' })).toBe(false);
  });

  it('returns false when pairing state is stale (avoid 401 spam loop)', () => {
    expect(isActive({ ...PAIRED, pairingState: 'stale' })).toBe(false);
  });

  it('returns false when not signed in', () => {
    expect(isActive({ ...PAIRED, lastSession: null })).toBe(false);
  });
});

describe('pushSnapshot (no debounce)', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    _resetStatusPusherForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to /status with bearer auth when active', async () => {
    await pushSnapshotForTests({
      activation: { helperDetected: true, pairingState: 'paired',
        lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' } },
      pairingToken: 'token-abc',
      helperOrigin: 'http://localhost:47826',
      payloadInputs: undefined!,
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:47826/status',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          Authorization: 'Bearer token-abc',
        }),
      }),
    );
  });

  it('does NOT call fetch when activation conditions fail', async () => {
    await pushSnapshotForTests({
      activation: { helperDetected: false, pairingState: 'paired', lastSession: null },
      pairingToken: 'token-abc',
      helperOrigin: 'http://localhost:47826',
      payloadInputs: undefined!,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('debouncer (throttle-with-trailing)', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    _resetStatusPusherForTests();
    // pushOnce() reads from real stores; populate just enough to let
    // buildStatusPayload return non-null and the bearer token guard pass.
    setLastSession({ pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' });
    setPairingToken('AAAAAAAAAAAAAAAAAAAAAA');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearLastSession();
    clearPairingToken();
  });

  // Drain Promise microtasks queued by pushOnce() without advancing
  // the fake clock (which would also fire the trailing setTimeout).
  const flushMicrotasks = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it('fires immediately on the first scheduled push in a quiet period', async () => {
    schedulePushForTests();
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of schedules within DEBOUNCE_MS into one trailing push', async () => {
    schedulePushForTests();   // immediate
    schedulePushForTests();   // queued (during cooldown)
    schedulePushForTests();   // queued (still within cooldown)
    await flushMicrotasks();
    // First fires immediately, then nothing until the cooldown advances.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    // Trailing push fires once at the end of the cooldown window.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not fire a trailing push if no schedules arrived during the cooldown', async () => {
    schedulePushForTests();   // immediate
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // only the immediate
  });
});

describe('initStatusPusher subscription wiring', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    _resetStatusPusherForTests();
    setLastSession({ pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' });
    setPairingToken('AAAAAAAAAAAAAAAAAAAAAA');
  });
  afterEach(() => {
    _disposeStatusPusherForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearLastSession();
    clearPairingToken();
  });

  const flushMicrotasks = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it('does not throw when called', () => {
    expect(() => initStatusPusher()).not.toThrow();
  });

  it('fires the immediate fresh-state push when activation flips to true', async () => {
    initStatusPusher();
    _setActivationForTests({
      helperDetected: true,
      pairingState: 'paired',
      lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' },
    });
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // one immediate push on becoming active
  });

  it('does not push again when activation re-evaluates while already active (no rising edge)', async () => {
    initStatusPusher();
    _setActivationForTests({
      helperDetected: true,
      pairingState: 'paired',
      lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' },
    });
    await flushMicrotasks();
    fetchSpy.mockClear();
    _setActivationForTests({
      helperDetected: true,
      pairingState: 'paired',
      lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' },
    });
    await flushMicrotasks();
    expect(fetchSpy).not.toHaveBeenCalled(); // no extra push without rising edge
  });
});

describe('heartbeat (session mode)', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    _resetStatusPusherForTests();
    setLastSession({ pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' });
    setPairingToken('AAAAAAAAAAAAAAAAAAAAAA');
  });
  afterEach(() => {
    _disposeStatusPusherForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearLastSession();
    clearPairingToken();
  });

  const flushMicrotasks = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it('fires a heartbeat push every HEARTBEAT_MS while active + session mode', async () => {
    initStatusPusher();
    _setPersistenceModeForTests('session-only');
    _setActivationForTests({
      helperDetected: true,
      pairingState: 'paired',
      lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' },
    });
    await flushMicrotasks(); // immediate fresh-state push
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockClear();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // heartbeat #1
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // heartbeat #2
  });

  it('does not run a heartbeat in persist mode', async () => {
    initStatusPusher();
    _setPersistenceModeForTests('persist');
    _setActivationForTests({
      helperDetected: true,
      pairingState: 'paired',
      lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' },
    });
    await flushMicrotasks(); // immediate fresh-state push
    fetchSpy.mockClear();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('clears the heartbeat when active flips to dormant', async () => {
    initStatusPusher();
    _setPersistenceModeForTests('session-only');
    _setActivationForTests({
      helperDetected: true,
      pairingState: 'paired',
      lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' },
    });
    await flushMicrotasks();
    fetchSpy.mockClear();
    _setActivationForTests({ helperDetected: false, pairingState: 'paired', lastSession: null });
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('beforeunload (persist mode final push)', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    _resetStatusPusherForTests();
    setLastSession({ pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' });
    setPairingToken('AAAAAAAAAAAAAAAAAAAAAA');
  });
  afterEach(() => {
    _disposeStatusPusherForTests();
    vi.unstubAllGlobals();
    clearLastSession();
    clearPairingToken();
  });

  it('fires a fetch with keepalive:true and priority:"final" on beforeunload (persist + active)', () => {
    initStatusPusher();
    _setPersistenceModeForTests('persist');
    _setActivationForTests({
      helperDetected: true,
      pairingState: 'paired',
      lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' },
    });
    fetchSpy.mockClear(); // clear the immediate fresh-state push
    window.dispatchEvent(new Event('beforeunload'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/status$/);
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body).priority).toBe('final');
  });

  it('does NOT fire on beforeunload in session mode', () => {
    initStatusPusher();
    _setPersistenceModeForTests('session-only');
    _setActivationForTests({
      helperDetected: true,
      pairingState: 'paired',
      lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' },
    });
    fetchSpy.mockClear();
    window.dispatchEvent(new Event('beforeunload'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does NOT fire on beforeunload when dormant', () => {
    initStatusPusher();
    _setPersistenceModeForTests('persist');
    // Don't set activation — pusher stays dormant.
    window.dispatchEvent(new Event('beforeunload'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

import { deleteStatus } from './status-pusher';

describe('deleteStatus', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    clearPairingToken();
    vi.unstubAllGlobals();
  });

  it('sends DELETE /status with bearer auth when paired', async () => {
    setPairingToken('AAAAAAAAAAAAAAAAAAAAAA');
    await deleteStatus();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/status$/);
    expect(init.method).toBe('DELETE');
    expect(init.headers.Authorization).toMatch(/^Bearer /);
  });

  it('is a no-op when unpaired (token absent)', async () => {
    clearPairingToken();
    await deleteStatus();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resolves silently when the DELETE network call fails', async () => {
    setPairingToken('AAAAAAAAAAAAAAAAAAAAAA');
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(deleteStatus()).resolves.toBeUndefined();
  });
});

describe('401 handling (pairing-cause)', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
    _resetStatusPusherForTests();
    setLastSession({ pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' });
    setPairingToken('AAAAAAAAAAAAAAAAAAAAAA');
  });
  afterEach(() => {
    _disposeStatusPusherForTests();
    vi.unstubAllGlobals();
    clearLastSession();
    clearPairingToken();
  });

  it('marks pairing stale on 401 with WWW-Authenticate: Bearer', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer realm="bsky-saves"' },
      }),
    );
    await pushSnapshotForTests({
      activation: {
        helperDetected: true,
        pairingState: 'paired',
        lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' },
      },
      pairingToken: 'AAAAAAAAAAAAAAAAAAAAAA',
      helperOrigin: 'http://localhost:47826',
      payloadInputs: undefined!,
    });
    expect(get(pairingToken).state).toBe('stale');
  });

  it('does NOT mark pairing stale on 401 without WWW-Authenticate header', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await pushSnapshotForTests({
      activation: {
        helperDetected: true,
        pairingState: 'paired',
        lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' },
      },
      pairingToken: 'AAAAAAAAAAAAAAAAAAAAAA',
      helperOrigin: 'http://localhost:47826',
      payloadInputs: undefined!,
    });
    expect(get(pairingToken).state).toBe('paired');
  });
});

import { _getCurrentActivityForTests } from './status-pusher';
import { imageHydration, articleHydration, threadProgress } from './hydration-state';

describe('last_activity wiring', () => {
  const fetchSpy = vi.fn();
  const IDLE_HYDRATION = {
    status: 'idle' as const, total: 0, fetched: 0, skipped: 0, failed: 0, failures: [],
  };

  beforeEach(() => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    _resetStatusPusherForTests();
    // Reset hydration stores to idle so prevStatus baselines are clean
    // when initStatusPusher subscribes below.
    imageHydration.set(IDLE_HYDRATION);
    articleHydration.set(IDLE_HYDRATION);
    threadProgress.set(IDLE_HYDRATION);
    setLastSession({ pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' });
    setPairingToken('AAAAAAAAAAAAAAAAAAAAAA');
  });
  afterEach(() => {
    _disposeStatusPusherForTests();
    vi.unstubAllGlobals();
    clearLastSession();
    clearPairingToken();
    imageHydration.set(IDLE_HYDRATION);
    articleHydration.set(IDLE_HYDRATION);
    threadProgress.set(IDLE_HYDRATION);
  });

  it('sets kind: hydrate_images on imageHydration idle → running transition', () => {
    initStatusPusher();
    imageHydration.set({ ...IDLE_HYDRATION, status: 'running', total: 10 });
    const activity = _getCurrentActivityForTests();
    expect(activity.kind).toBe('hydrate_images');
    expect(activity.started_at).not.toBeNull();
    expect(activity.finished_at).toBeNull();
    expect(activity.errors).toEqual([]);
  });

  it('sets kind: hydrate_articles on articleHydration idle → running transition', () => {
    initStatusPusher();
    articleHydration.set({ ...IDLE_HYDRATION, status: 'running', total: 5 });
    const activity = _getCurrentActivityForTests();
    expect(activity.kind).toBe('hydrate_articles');
    expect(activity.started_at).not.toBeNull();
    expect(activity.finished_at).toBeNull();
  });

  it('sets kind: hydrate_threads on threadProgress idle → running transition', () => {
    initStatusPusher();
    threadProgress.set({ ...IDLE_HYDRATION, status: 'running', total: 3 });
    const activity = _getCurrentActivityForTests();
    expect(activity.kind).toBe('hydrate_threads');
    expect(activity.started_at).not.toBeNull();
    expect(activity.finished_at).toBeNull();
  });

  it('stamps finished_at on running → done with no failures', () => {
    initStatusPusher();
    imageHydration.set({ ...IDLE_HYDRATION, status: 'running', total: 10 });
    imageHydration.set({
      status: 'done', total: 10, fetched: 10, skipped: 0, failed: 0, failures: [],
    });
    const activity = _getCurrentActivityForTests();
    expect(activity.kind).toBe('hydrate_images');
    expect(activity.finished_at).not.toBeNull();
    expect(activity.errors).toEqual([]);
  });

  it('populates errors from hydrator failures on running → done', () => {
    initStatusPusher();
    articleHydration.set({ ...IDLE_HYDRATION, status: 'running', total: 2 });
    articleHydration.set({
      status: 'done', total: 2, fetched: 1, skipped: 0, failed: 1,
      failures: [{ url: 'https://example.com/a', reason: 'fetch failed: 502' }],
    });
    const activity = _getCurrentActivityForTests();
    expect(activity.finished_at).not.toBeNull();
    expect(activity.errors).toEqual([
      { kind: 'hydration_error', message: 'fetch failed: 502', count: 1 },
    ]);
  });

  it('does not update activity when status changes between non-idle/non-done states', () => {
    initStatusPusher();
    imageHydration.set({ ...IDLE_HYDRATION, status: 'running', total: 10 });
    const startedAt = _getCurrentActivityForTests().started_at;
    // running → paused → running should not retrigger started_at.
    imageHydration.set({ ...IDLE_HYDRATION, status: 'paused', total: 10 });
    imageHydration.set({ ...IDLE_HYDRATION, status: 'running', total: 10 });
    const after = _getCurrentActivityForTests();
    expect(after.started_at).toBe(startedAt);
  });

  it('starts a fresh activity record (clears prior errors) on a new idle → running transition', () => {
    initStatusPusher();
    articleHydration.set({ ...IDLE_HYDRATION, status: 'running', total: 1 });
    articleHydration.set({
      status: 'done', total: 1, fetched: 0, skipped: 0, failed: 1,
      failures: [{ url: 'https://a', reason: 'boom' }],
    });
    expect(_getCurrentActivityForTests().errors.length).toBe(1);
    articleHydration.set(IDLE_HYDRATION);
    articleHydration.set({ ...IDLE_HYDRATION, status: 'running', total: 2 });
    const activity = _getCurrentActivityForTests();
    expect(activity.errors).toEqual([]);
    expect(activity.finished_at).toBeNull();
  });
});

// Issue #85 / coordination-doc Q10: persist last_activity across GUI
// restarts so the activation-rising-edge "fresh-state" push at boot
// doesn't clobber the helper's on-disk snapshot with `{ kind: 'idle' }`.
// The persistence module itself is exercised in last-activity-persist.test.ts;
// here we only assert that status-pusher CALLS into it correctly.
import type { LastActivity } from './status-payload';

describe('last_activity persistence wiring', () => {
  const IDLE_HYDRATION = {
    status: 'idle' as const, total: 0, fetched: 0, skipped: 0, failed: 0, failures: [],
  };

  beforeEach(() => {
    persistMock.loadLastActivity.mockReset();
    persistMock.saveLastActivity.mockReset();
    persistMock.clearLastActivity.mockReset();
    persistMock.loadLastActivity.mockResolvedValue(null);
    persistMock.saveLastActivity.mockResolvedValue(undefined);
    persistMock.clearLastActivity.mockResolvedValue(undefined);
    _resetStatusPusherForTests();
    imageHydration.set(IDLE_HYDRATION);
    articleHydration.set(IDLE_HYDRATION);
    threadProgress.set(IDLE_HYDRATION);
  });
  afterEach(() => {
    _disposeStatusPusherForTests();
    imageHydration.set(IDLE_HYDRATION);
    articleHydration.set(IDLE_HYDRATION);
    threadProgress.set(IDLE_HYDRATION);
  });

  it('calls saveLastActivity on hydration idle → running transition', () => {
    initStatusPusher();
    persistMock.saveLastActivity.mockClear();
    imageHydration.set({ ...IDLE_HYDRATION, status: 'running', total: 10 });
    expect(persistMock.saveLastActivity).toHaveBeenCalledTimes(1);
    const arg = persistMock.saveLastActivity.mock.calls[0][0] as LastActivity;
    expect(arg.kind).toBe('hydrate_images');
    expect(arg.started_at).not.toBeNull();
    expect(arg.finished_at).toBeNull();
  });

  it('calls saveLastActivity on hydration running → done transition', () => {
    initStatusPusher();
    imageHydration.set({ ...IDLE_HYDRATION, status: 'running', total: 10 });
    persistMock.saveLastActivity.mockClear();
    imageHydration.set({
      status: 'done', total: 10, fetched: 10, skipped: 0, failed: 0, failures: [],
    });
    expect(persistMock.saveLastActivity).toHaveBeenCalledTimes(1);
    const arg = persistMock.saveLastActivity.mock.calls[0][0] as LastActivity;
    expect(arg.kind).toBe('hydrate_images');
    expect(arg.finished_at).not.toBeNull();
  });

  it('restores persisted activity into currentActivity on initStatusPusher', async () => {
    const persisted: LastActivity = {
      kind: 'hydrate_articles',
      started_at: '2026-05-22T00:00:00.000Z',
      finished_at: '2026-05-22T00:01:00.000Z',
      added: 3,
      removed: 0,
      errors: [],
    };
    persistMock.loadLastActivity.mockResolvedValueOnce(persisted);
    initStatusPusher();
    // Wait for the fire-and-forget loadLastActivity to resolve.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(_getCurrentActivityForTests()).toEqual(persisted);
  });

  it('does NOT clobber a real activity that fires before loadLastActivity resolves', async () => {
    const persisted: LastActivity = {
      kind: 'hydrate_articles',
      started_at: '2026-05-22T00:00:00.000Z',
      finished_at: null,
      added: 0,
      removed: 0,
      errors: [],
    };
    persistMock.loadLastActivity.mockResolvedValueOnce(persisted);
    initStatusPusher();
    // Real activity fires synchronously before the persisted load resolves.
    imageHydration.set({ ...IDLE_HYDRATION, status: 'running', total: 10 });
    // Now let loadLastActivity resolve.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    // The real transition wins — currentActivity must reflect the in-flight
    // image hydration, not the stale persisted articles record.
    expect(_getCurrentActivityForTests().kind).toBe('hydrate_images');
  });

  it('does not touch currentActivity when persistence reports no prior record', async () => {
    persistMock.loadLastActivity.mockResolvedValueOnce(null);
    initStatusPusher();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    // Stays at the in-memory default.
    expect(_getCurrentActivityForTests().kind).toBe('idle');
    expect(_getCurrentActivityForTests().started_at).toBeNull();
  });
});


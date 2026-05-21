import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetStatusPusherForTests,
  isActive,
  pushSnapshotForTests,
  type ActivationInputs,
} from './status-pusher';
import { schedulePushForTests, _flushDebouncerForTests, DEBOUNCE_MS } from './status-pusher';
import { initStatusPusher, _disposeStatusPusherForTests, _setActivationForTests } from './status-pusher';
import { HEARTBEAT_MS, _setPersistenceModeForTests } from './status-pusher';
import { setLastSession, clearLastSession } from './last-session';
import { setPairingToken, clearPairingToken } from './pairing-token';

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

// Reference the unused import to avoid lint errors (it's exported for future use).
void _flushDebouncerForTests;

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

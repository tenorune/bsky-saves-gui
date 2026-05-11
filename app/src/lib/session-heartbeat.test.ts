import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  isSessionFresh,
  expireStaleSessionData,
  startSessionHeartbeat,
  stopSessionHeartbeat,
  clearSessionHeartbeat,
  _internals,
} from './session-heartbeat';

const HEARTBEAT_KEY = _internals.HEARTBEAT_KEY;
const STALE = _internals.STALE_THRESHOLD_MS;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  stopSessionHeartbeat();
  vi.useRealTimers();
});

afterEach(() => {
  stopSessionHeartbeat();
  vi.useRealTimers();
});

describe('isSessionFresh', () => {
  it('returns true when no heartbeat exists yet (first-ever load)', () => {
    expect(isSessionFresh()).toBe(true);
  });

  it('returns true when the heartbeat is recent', () => {
    localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
    expect(isSessionFresh()).toBe(true);
  });

  it('returns false when the heartbeat is older than the stale threshold', () => {
    localStorage.setItem(HEARTBEAT_KEY, String(Date.now() - STALE - 1_000));
    expect(isSessionFresh()).toBe(false);
  });

  it('treats a malformed heartbeat as fresh (no false-positive expiry)', () => {
    localStorage.setItem(HEARTBEAT_KEY, 'not-a-number');
    expect(isSessionFresh()).toBe(true);
  });
});

describe('expireStaleSessionData', () => {
  it('does nothing when the session is fresh', () => {
    sessionStorage.setItem('inventory:session-v1', '{"saves":[]}');
    sessionStorage.setItem('inventory-present:v1', '1');
    localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
    expect(expireStaleSessionData()).toBe(false);
    expect(sessionStorage.getItem('inventory:session-v1')).not.toBeNull();
    expect(sessionStorage.getItem('inventory-present:v1')).toBe('1');
  });

  it('clears all session-only sessionStorage entries when the heartbeat is stale', () => {
    // Populate every key the expiry should cover. Add new ones here as
    // the SESSION_KEYS_TO_EXPIRE list grows.
    sessionStorage.setItem('inventory:session-v1', '{"saves":[]}');
    sessionStorage.setItem('inventory-present:v1', '1');
    sessionStorage.setItem('last-session:v1', '{"handle":"h"}');
    sessionStorage.setItem('account:v1', 'h');
    sessionStorage.setItem('session-only-mode:v1', '1');
    localStorage.setItem(HEARTBEAT_KEY, String(Date.now() - STALE - 5_000));
    expect(expireStaleSessionData()).toBe(true);
    expect(sessionStorage.getItem('inventory:session-v1')).toBeNull();
    expect(sessionStorage.getItem('inventory-present:v1')).toBeNull();
    expect(sessionStorage.getItem('last-session:v1')).toBeNull();
    expect(sessionStorage.getItem('account:v1')).toBeNull();
    // The persistence-mode marker is also expired so the post-quit
    // reopen doesn't show a session-only banner over a fresh state.
    expect(sessionStorage.getItem('session-only-mode:v1')).toBeNull();
  });

  it('returns false when there is no heartbeat at all (no stale data to clear)', () => {
    sessionStorage.setItem('inventory:session-v1', '{"saves":[]}');
    expect(expireStaleSessionData()).toBe(false);
    expect(sessionStorage.getItem('inventory:session-v1')).not.toBeNull();
  });
});

describe('startSessionHeartbeat / stopSessionHeartbeat', () => {
  it('writes a heartbeat immediately on start', () => {
    expect(localStorage.getItem(HEARTBEAT_KEY)).toBeNull();
    startSessionHeartbeat();
    expect(localStorage.getItem(HEARTBEAT_KEY)).not.toBeNull();
  });

  it('writes additional heartbeats on the interval timer', () => {
    vi.useFakeTimers();
    startSessionHeartbeat();
    const first = parseInt(localStorage.getItem(HEARTBEAT_KEY) ?? '0', 10);
    vi.advanceTimersByTime(_internals.HEARTBEAT_INTERVAL_MS + 100);
    const second = parseInt(localStorage.getItem(HEARTBEAT_KEY) ?? '0', 10);
    expect(second).toBeGreaterThan(first);
  });

  it('is idempotent — repeated start calls do not stack timers', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    startSessionHeartbeat();
    startSessionHeartbeat();
    startSessionHeartbeat();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });
});

describe('clearSessionHeartbeat', () => {
  it('removes the heartbeat key and stops the interval', () => {
    vi.useFakeTimers();
    startSessionHeartbeat();
    expect(localStorage.getItem(HEARTBEAT_KEY)).not.toBeNull();
    clearSessionHeartbeat();
    expect(localStorage.getItem(HEARTBEAT_KEY)).toBeNull();
    // Subsequent timer advances must not write a new heartbeat.
    vi.advanceTimersByTime(_internals.HEARTBEAT_INTERVAL_MS + 100);
    expect(localStorage.getItem(HEARTBEAT_KEY)).toBeNull();
  });
});

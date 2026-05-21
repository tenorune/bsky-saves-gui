import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetStatusPusherForTests,
  isActive,
  pushSnapshotForTests,
  type ActivationInputs,
} from './status-pusher';

const PAIRED: ActivationInputs = {
  helperDetected: true,
  pairingState: 'paired',
  helperOptOut: false,
  lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' },
};

describe('isActive', () => {
  it('returns true when all four conditions hold', () => {
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

  it('returns false when user opted out of the helper', () => {
    expect(isActive({ ...PAIRED, helperOptOut: true })).toBe(false);
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
      activation: { helperDetected: true, pairingState: 'paired', helperOptOut: false,
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
      activation: { helperDetected: false, pairingState: 'paired', helperOptOut: false, lastSession: null },
      pairingToken: 'token-abc',
      helperOrigin: 'http://localhost:47826',
      payloadInputs: undefined!,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

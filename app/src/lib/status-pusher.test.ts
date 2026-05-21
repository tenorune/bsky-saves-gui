import { describe, expect, it } from 'vitest';
import { isActive, type ActivationInputs } from './status-pusher';

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

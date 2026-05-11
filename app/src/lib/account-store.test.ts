import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { get as idbGet } from 'idb-keyval';
import { saveAccount, loadAccount, clearAccount } from './account-store';
import { signInDraft } from './sign-in-draft';
import { markSessionOnly, clearSessionOnlyMarker } from './persistence-mode';

beforeEach(async () => {
  await clearAccount();
  signInDraft.set(null);
  clearSessionOnlyMarker();
  sessionStorage.clear();
});

describe('account-store — persist mode (default)', () => {
  it('round-trips a handle', async () => {
    expect(await loadAccount()).toBeNull();
    await saveAccount('alice.bsky.social');
    expect(await loadAccount()).toBe('alice.bsky.social');
  });

  it('writes to IDB, not sessionStorage', async () => {
    await saveAccount('alice.bsky.social');
    expect(await idbGet('account:v1')).toBe('alice.bsky.social');
    expect(sessionStorage.getItem('account:v1')).toBeNull();
  });

  it('overwrites on subsequent saves (handle changes are rare but possible)', async () => {
    await saveAccount('alice.bsky.social');
    await saveAccount('alice-renamed.bsky.social');
    expect(await loadAccount()).toBe('alice-renamed.bsky.social');
  });

  it('clearAccount removes the stored handle', async () => {
    await saveAccount('alice.bsky.social');
    await clearAccount();
    expect(await loadAccount()).toBeNull();
  });
});

describe('account-store — session-only mode', () => {
  it('writes to sessionStorage, not IDB', async () => {
    markSessionOnly();
    await saveAccount('alice.bsky.social');
    expect(sessionStorage.getItem('account:v1')).toBe('alice.bsky.social');
    expect(await idbGet('account:v1')).toBeUndefined();
  });

  it('loadAccount reads from sessionStorage in session-only mode', async () => {
    markSessionOnly();
    await saveAccount('alice.bsky.social');
    expect(await loadAccount()).toBe('alice.bsky.social');
  });

  it('flipping persist → session-only clears the IDB entry', async () => {
    // Start in persist mode, save (lands in IDB).
    await saveAccount('alice.bsky.social');
    expect(await idbGet('account:v1')).toBe('alice.bsky.social');
    // Flip to session-only and save again.
    markSessionOnly();
    await saveAccount('alice.bsky.social');
    // The persist-mode IDB entry should now be gone.
    expect(await idbGet('account:v1')).toBeUndefined();
    expect(sessionStorage.getItem('account:v1')).toBe('alice.bsky.social');
  });

  it('flipping session-only → persist clears the sessionStorage entry', async () => {
    markSessionOnly();
    await saveAccount('alice.bsky.social');
    expect(sessionStorage.getItem('account:v1')).toBe('alice.bsky.social');
    // Flip to persist mode and save again.
    clearSessionOnlyMarker();
    await saveAccount('alice.bsky.social');
    expect(sessionStorage.getItem('account:v1')).toBeNull();
    expect(await idbGet('account:v1')).toBe('alice.bsky.social');
  });

  it('clearAccount wipes both stores regardless of mode', async () => {
    markSessionOnly();
    await saveAccount('alice.bsky.social');
    // Plant a stale IDB entry too.
    await saveAccount('alice.bsky.social'); // writes to sessionStorage; also dels IDB
    sessionStorage.setItem('account:v1', 'a');
    // Manually plant an IDB entry to simulate a partial state.
    const { set } = await import('idb-keyval');
    await set('account:v1', 'b');
    await clearAccount();
    expect(sessionStorage.getItem('account:v1')).toBeNull();
    expect(await idbGet('account:v1')).toBeUndefined();
  });
});

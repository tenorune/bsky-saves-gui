import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { get } from 'svelte/store';
import { signInDraft } from './sign-in-draft';
import { saveLibraryToDevice } from './save-library-to-device';
import {
  saveInventory,
  loadInventory,
  clearInventory,
  _resetInventoryStoreForTests,
} from './inventory-store';
import {
  saveImageBlob,
  loadImageBlob,
  clearImageBlobs,
  _resetImageStoreForTests,
} from './image-store';
import { lastSession, setLastSession, clearLastSession } from './last-session';
import { inventoryPresent } from './inventory-presence';

const SESSION_ONLY_DRAFT = {
  handle: 'a',
  appPassword: 'b',
  pds: 'https://x',
  saveInventory: false,
  saveCredentials: false,
  passphrase: '',
};

beforeEach(async () => {
  signInDraft.set(null);
  _resetInventoryStoreForTests();
  _resetImageStoreForTests();
  await clearInventory();
  await clearImageBlobs();
  clearLastSession();
  localStorage.clear();
  sessionStorage.clear();
});

describe('saveLibraryToDevice', () => {
  it('flips the draft to saveInventory: true', async () => {
    signInDraft.set(SESSION_ONLY_DRAFT);
    await saveLibraryToDevice();
    expect(get(signInDraft)?.saveInventory).toBe(true);
  });

  it('writes the session-stored inventory to disk and promotes the presence flag', async () => {
    signInDraft.set(SESSION_ONLY_DRAFT);
    await saveInventory({ saves: [{ uri: 'at://x' }] });
    // In session-only mode, the inventory lives in sessionStorage and
    // the presence flag is also session-scoped, not localStorage.
    expect(localStorage.getItem('inventory-present:v1')).toBeNull();
    expect(sessionStorage.getItem('inventory-present:v1')).toBe('1');
    expect(sessionStorage.getItem('inventory:session-v1')).not.toBeNull();
    expect(get(inventoryPresent)).toBe(true);

    await saveLibraryToDevice();

    // After flush: localStorage flag is set (survives browser quit),
    // sessionStorage entries are gone, and a fresh load reads from IDB.
    expect(localStorage.getItem('inventory-present:v1')).toBe('1');
    expect(sessionStorage.getItem('inventory-present:v1')).toBeNull();
    expect(sessionStorage.getItem('inventory:session-v1')).toBeNull();
    const loaded = await loadInventory();
    expect(loaded).toEqual({ saves: [{ uri: 'at://x' }] });
  });

  it('writes in-memory image blobs to disk', async () => {
    signInDraft.set(SESSION_ONLY_DRAFT);
    await saveImageBlob('https://cdn.bsky.app/img/x', new Blob(['xx']));
    await saveLibraryToDevice();
    // After flush, the blob is loadable from the IDB-backed path even
    // after wiping the in-memory map. fake-indexeddb's structured clone
    // doesn't faithfully reconstruct Blob, so we assert "something was
    // stored" rather than the type — the production runtime preserves it.
    _resetImageStoreForTests();
    const stored = await loadImageBlob('https://cdn.bsky.app/img/x');
    expect(stored).toBeDefined();
  });

  it('promotes the sessionStorage lastSession to localStorage on flush', async () => {
    signInDraft.set(SESSION_ONLY_DRAFT);
    setLastSession({
      pds: 'https://x',
      accessJwt: 'a',
      refreshJwt: 'r',
      did: 'd',
      handle: 'h',
    });
    // In session-only mode, lastSession is in sessionStorage so
    // refresh keeps the user signed in. localStorage is empty until
    // promotion.
    expect(sessionStorage.getItem('last-session:v1')).toContain('"handle":"h"');
    expect(localStorage.getItem('last-session:v1')).toBeNull();
    expect(get(lastSession)?.handle).toBe('h');

    await saveLibraryToDevice();

    // After flush: localStorage owns the JWTs (closing the tab no
    // longer signs the user out; a browser restart keeps them signed
    // in, mirroring the saves' persistence). sessionStorage is empty
    // because the persist-mode write also clears the session-only
    // entry as part of writeToStorage's invariant.
    const stored = localStorage.getItem('last-session:v1');
    expect(stored).toContain('"handle":"h"');
    expect(sessionStorage.getItem('last-session:v1')).toBeNull();
  });

  it('is a safe no-op when nothing is in memory', async () => {
    // No draft, no in-memory data — saveLibraryToDevice should not throw
    // and should not flip an unset draft.
    await saveLibraryToDevice();
    expect(get(signInDraft)).toBeNull();
    expect(await loadInventory()).toBeNull();
  });
});

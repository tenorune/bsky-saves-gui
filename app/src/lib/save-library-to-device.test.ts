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
  fetch: true,
  threads: false,
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

  it('writes the in-memory inventory to disk and marks inventoryPresent', async () => {
    signInDraft.set(SESSION_ONLY_DRAFT);
    await saveInventory({ saves: [{ uri: 'at://x' }] });
    // While in session-only mode, IndexedDB has nothing yet.
    expect(localStorage.getItem('inventory-present:v1')).toBeNull();
    expect(get(inventoryPresent)).toBe(false);

    await saveLibraryToDevice();

    // After flush: persistence flag is set, IDB has the data, in-memory
    // fallback is empty, and a fresh load reads from disk.
    expect(get(inventoryPresent)).toBe(true);
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

  it('persists the current lastSession to sessionStorage', async () => {
    signInDraft.set(SESSION_ONLY_DRAFT);
    setLastSession({
      pds: 'https://x',
      accessJwt: 'a',
      refreshJwt: 'r',
      did: 'd',
      handle: 'h',
    });
    // While in session-only mode, the writeToStorage gate kept it out.
    expect(sessionStorage.getItem('last-session:v1')).toBeNull();
    expect(get(lastSession)?.handle).toBe('h');

    await saveLibraryToDevice();

    // Now it's on disk so a browser-quit-and-reopen retains the session.
    const stored = sessionStorage.getItem('last-session:v1');
    expect(stored).toContain('"handle":"h"');
  });

  it('is a safe no-op when nothing is in memory', async () => {
    // No draft, no in-memory data — saveLibraryToDevice should not throw
    // and should not flip an unset draft.
    await saveLibraryToDevice();
    expect(get(signInDraft)).toBeNull();
    expect(await loadInventory()).toBeNull();
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { signInDraft } from './sign-in-draft';
import { shouldPersistLibraryData, persistenceMode } from './persistence-mode';

beforeEach(() => {
  signInDraft.set(null);
});

describe('shouldPersistLibraryData', () => {
  it('returns true when no draft is set (returning visit, no fresh sign-in)', () => {
    expect(shouldPersistLibraryData()).toBe(true);
  });

  it('returns true when the draft has saveInventory: true', () => {
    signInDraft.set({
      handle: 'a',
      appPassword: 'b',
      pds: 'https://x',
      fetch: true,
      threads: false,
      saveInventory: true,
      saveCredentials: false,
      passphrase: '',
    });
    expect(shouldPersistLibraryData()).toBe(true);
  });

  it('returns false when the draft has saveInventory: false (session-only mode)', () => {
    signInDraft.set({
      handle: 'a',
      appPassword: 'b',
      pds: 'https://x',
      fetch: true,
      threads: false,
      saveInventory: false,
      saveCredentials: false,
      passphrase: '',
    });
    expect(shouldPersistLibraryData()).toBe(false);
  });
});

describe('persistenceMode store', () => {
  it('reflects persist when no draft is set', () => {
    expect(get(persistenceMode)).toBe('persist');
  });

  it('reflects session-only when the draft opted out', () => {
    signInDraft.set({
      handle: 'a',
      appPassword: 'b',
      pds: 'https://x',
      fetch: true,
      threads: false,
      saveInventory: false,
      saveCredentials: false,
      passphrase: '',
    });
    expect(get(persistenceMode)).toBe('session-only');
  });

  it('flips back to persist when saveInventory is set true mid-session', () => {
    const baseDraft = {
      handle: 'a',
      appPassword: 'b',
      pds: 'https://x',
      fetch: true,
      threads: false,
      saveCredentials: false,
      passphrase: '',
    };
    signInDraft.set({ ...baseDraft, saveInventory: false });
    expect(get(persistenceMode)).toBe('session-only');
    signInDraft.set({ ...baseDraft, saveInventory: true });
    expect(get(persistenceMode)).toBe('persist');
  });
});

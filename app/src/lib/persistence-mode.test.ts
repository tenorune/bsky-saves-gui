import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { signInDraft } from './sign-in-draft';
import {
  shouldPersistLibraryData,
  persistenceMode,
  markSessionOnly,
  clearSessionOnlyMarker,
} from './persistence-mode';

beforeEach(() => {
  signInDraft.set(null);
  clearSessionOnlyMarker();
  sessionStorage.clear();
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
      saveCredentials: false,
      passphrase: '',
    };
    signInDraft.set({ ...baseDraft, saveInventory: false });
    expect(get(persistenceMode)).toBe('session-only');
    signInDraft.set({ ...baseDraft, saveInventory: true });
    expect(get(persistenceMode)).toBe('persist');
  });
});

describe('session-only marker (survives in-tab refresh)', () => {
  it('markSessionOnly persists to sessionStorage and flips both stores', () => {
    expect(get(persistenceMode)).toBe('persist');
    expect(shouldPersistLibraryData()).toBe(true);

    markSessionOnly();

    expect(sessionStorage.getItem('session-only-mode:v1')).toBe('1');
    expect(get(persistenceMode)).toBe('session-only');
    expect(shouldPersistLibraryData()).toBe(false);
  });

  it('clearSessionOnlyMarker reverses both stores and removes the entry', () => {
    markSessionOnly();
    clearSessionOnlyMarker();

    expect(sessionStorage.getItem('session-only-mode:v1')).toBeNull();
    expect(get(persistenceMode)).toBe('persist');
    expect(shouldPersistLibraryData()).toBe(true);
  });

  it('marker takes precedence over signInDraft (refresh scenario)', () => {
    // Simulate the post-refresh state: marker was written before
    // refresh, signInDraft is null because it has no persistence.
    markSessionOnly();
    signInDraft.set(null);

    expect(get(persistenceMode)).toBe('session-only');
    expect(shouldPersistLibraryData()).toBe(false);
  });

  it('marker survives a module reload — the bug this fix addresses', async () => {
    // Pre-set the marker as if from a previous page life.
    sessionStorage.setItem('session-only-mode:v1', '1');
    // Reset modules and re-import — simulates page refresh.
    vi.resetModules();
    const { shouldPersistLibraryData: fresh, persistenceMode: freshMode } =
      await import('./persistence-mode');
    expect(fresh()).toBe(false);
    expect(get(freshMode)).toBe('session-only');
  });
});

import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  retainMode,
  loadRetainMode,
  setRetainMode,
  clearRetainMode,
  isRetainNarrowing,
  _resetRetainModeForTests,
} from './retain-mode';
import { clear, get as idbGet, set as idbSet } from 'idb-keyval';

describe('retainMode', () => {
  beforeEach(async () => {
    await clear();
    _resetRetainModeForTests();
  });

  it("defaults to 'keep-lost'", () => {
    expect(get(retainMode)).toBe('keep-lost');
  });

  it('setRetainMode updates the store and persists', async () => {
    await setRetainMode('keep-all');
    expect(get(retainMode)).toBe('keep-all');
    _resetRetainModeForTests();
    await loadRetainMode();
    expect(get(retainMode)).toBe('keep-all');
  });

  it('loadRetainMode falls back to the default when nothing is persisted', async () => {
    await loadRetainMode();
    expect(get(retainMode)).toBe('keep-lost');
  });

  it('loadRetainMode falls back to the default on a malformed persisted value', async () => {
    await idbSet('retain-mode:v1', 'garbage');
    await loadRetainMode();
    expect(get(retainMode)).toBe('keep-lost');
  });

  it('round-trips all three modes', async () => {
    for (const mode of ['sync', 'keep-lost', 'keep-all'] as const) {
      await setRetainMode(mode);
      _resetRetainModeForTests();
      await loadRetainMode();
      expect(get(retainMode)).toBe(mode);
    }
  });

  it('clearRetainMode resets the store to default and removes the IDB entry', async () => {
    await setRetainMode('sync');
    expect(get(retainMode)).toBe('sync');
    expect(await idbGet('retain-mode:v1')).toBe('sync');

    await clearRetainMode();

    expect(get(retainMode)).toBe('keep-lost');
    expect(await idbGet('retain-mode:v1')).toBeUndefined();
  });
});

describe('isRetainNarrowing', () => {
  it('returns true for every narrowing transition (deletes entries)', () => {
    expect(isRetainNarrowing('keep-all', 'keep-lost')).toBe(true);
    expect(isRetainNarrowing('keep-all', 'sync')).toBe(true);
    expect(isRetainNarrowing('keep-lost', 'sync')).toBe(true);
  });

  it('returns false for widening transitions', () => {
    expect(isRetainNarrowing('sync', 'keep-lost')).toBe(false);
    expect(isRetainNarrowing('sync', 'keep-all')).toBe(false);
    expect(isRetainNarrowing('keep-lost', 'keep-all')).toBe(false);
  });

  it('returns false for same-mode transitions', () => {
    for (const m of ['sync', 'keep-lost', 'keep-all'] as const) {
      expect(isRetainNarrowing(m, m)).toBe(false);
    }
  });
});

import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { libraryRefreshState, startLibraryRefresh, stopLibraryRefresh, _resetLibraryRefreshForTests } from './library-refresh';
import { _resetAssetTogglesForTests } from './asset-toggles';

describe('startLibraryRefresh', () => {
  beforeEach(() => {
    _resetLibraryRefreshForTests();
    _resetAssetTogglesForTests();
  });

  it('transitions idle → running → idle on success', async () => {
    const orchestrate = vi.fn().mockResolvedValue({ saves: [] });
    const saveInventory = vi.fn().mockResolvedValue(undefined);
    const promise = startLibraryRefresh(
      { credentials: { handle: 'a', appPassword: 'b', pds: 'c' }, includeThreads: true },
      { orchestrate, saveInventory, loadFromDb: vi.fn().mockResolvedValue(undefined) },
    );
    expect(get(libraryRefreshState).status).toBe('running');
    await promise;
    expect(get(libraryRefreshState).status).toBe('idle');
  });

  it('transitions idle → running → error on auth failure', async () => {
    const orchestrate = vi.fn().mockRejectedValue(new Error('auth refresh failed'));
    await startLibraryRefresh(
      { credentials: { handle: 'a', appPassword: 'b', pds: 'c' }, includeThreads: true },
      { orchestrate, saveInventory: vi.fn(), loadFromDb: vi.fn() },
    );
    const s = get(libraryRefreshState);
    expect(s.status).toBe('error');
    if (s.status === 'error') expect(s.error).toMatch(/auth refresh failed/);
  });

  it('persists the inventory through saveInventory', async () => {
    const inv = { saves: [{ uri: 'at://x' }] };
    const orchestrate = vi.fn().mockResolvedValue(inv);
    const saveInventory = vi.fn().mockResolvedValue(undefined);
    await startLibraryRefresh(
      { credentials: { handle: 'a', appPassword: 'b', pds: 'c' }, includeThreads: false },
      { orchestrate, saveInventory, loadFromDb: vi.fn().mockResolvedValue(undefined) },
    );
    expect(saveInventory).toHaveBeenCalledWith(inv);
  });

  it('reloads inventoryState via loadFromDb after a successful save', async () => {
    const orchestrate = vi.fn().mockResolvedValue({ saves: [{ uri: 'at://x' }] });
    const saveInventory = vi.fn().mockResolvedValue(undefined);
    const loadFromDb = vi.fn().mockResolvedValue(undefined);
    await startLibraryRefresh(
      { credentials: { handle: 'a', appPassword: 'b', pds: 'c' }, includeThreads: false },
      { orchestrate, saveInventory, loadFromDb },
    );
    expect(loadFromDb).toHaveBeenCalled();
  });

  it('kicks off image and article hydration after a successful refresh when toggles are on', async () => {
    // Asset toggles default to all-on, so no extra setup needed.
    const inv = { saves: [{ uri: 'at://x' }] };
    const orchestrate = vi.fn().mockResolvedValue(inv);
    const saveInventory = vi.fn().mockResolvedValue(undefined);
    const loadFromDb = vi.fn().mockResolvedValue(undefined);
    const loadInventory = vi.fn().mockResolvedValue(inv);
    const startImageBackup = vi.fn().mockResolvedValue({ started: true });
    const startArticleBackup = vi.fn().mockResolvedValue({ started: true });
    await startLibraryRefresh(
      { credentials: { handle: 'a', appPassword: 'b', pds: 'c' }, includeThreads: false },
      { orchestrate, saveInventory, loadFromDb, loadInventory, startImageBackup, startArticleBackup },
    );
    expect(startImageBackup).toHaveBeenCalledWith(inv);
    expect(startArticleBackup).toHaveBeenCalledWith(inv);
  });
});

describe('stopLibraryRefresh', () => {
  beforeEach(() => _resetLibraryRefreshForTests());

  it('returns state to idle and persists partial result', async () => {
    let resolveOrchestrate: (v: unknown) => void;
    const partial = { saves: [{ uri: 'at://x', thread_replies: [] }] };
    const orchestrate = vi.fn().mockImplementation(() => new Promise((r) => { resolveOrchestrate = r; }));
    const saveInventory = vi.fn().mockResolvedValue(undefined);
    const startImageBackup = vi.fn();
    const startArticleBackup = vi.fn();
    const promise = startLibraryRefresh(
      { credentials: { handle: 'a', appPassword: 'b', pds: 'c' }, includeThreads: false },
      {
        orchestrate,
        saveInventory,
        loadFromDb: vi.fn().mockResolvedValue(undefined),
        loadInventory: vi.fn().mockResolvedValue(partial),
        startImageBackup,
        startArticleBackup,
      },
    );
    expect(get(libraryRefreshState).status).toBe('running');
    // library-refresh now does an `await loadInventory()` before orchestrate
    // (to snapshot prior hydrated fields). Yield a microtask so orchestrate's
    // mock has been invoked and resolveOrchestrate is set.
    await Promise.resolve();
    await Promise.resolve();
    stopLibraryRefresh();
    expect(get(libraryRefreshState).status).toBe('idle');
    resolveOrchestrate!(partial);
    await promise;
    // Partial progress should be persisted (so a reload can restore the count).
    expect(saveInventory).toHaveBeenCalledWith(partial);
    // But image/article hydration should NOT proceed after a Stop.
    expect(startImageBackup).not.toHaveBeenCalled();
    expect(startArticleBackup).not.toHaveBeenCalled();
  });
});

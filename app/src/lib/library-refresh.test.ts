import { describe, expect, it, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { libraryRefreshState, startLibraryRefresh, stopLibraryRefresh, _resetLibraryRefreshForTests } from './library-refresh';

describe('startLibraryRefresh', () => {
  beforeEach(() => _resetLibraryRefreshForTests());

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
});

describe('stopLibraryRefresh', () => {
  beforeEach(() => _resetLibraryRefreshForTests());

  it('returns state to idle and discards pending result', async () => {
    let resolveOrchestrate: (v: unknown) => void;
    const orchestrate = vi.fn().mockImplementation(() => new Promise((r) => { resolveOrchestrate = r; }));
    const saveInventory = vi.fn();
    const promise = startLibraryRefresh(
      { credentials: { handle: 'a', appPassword: 'b', pds: 'c' }, includeThreads: false },
      { orchestrate, saveInventory, loadFromDb: vi.fn().mockResolvedValue(undefined) },
    );
    expect(get(libraryRefreshState).status).toBe('running');
    stopLibraryRefresh();
    expect(get(libraryRefreshState).status).toBe('idle');
    resolveOrchestrate!({ saves: [] });
    await promise;
    expect(saveInventory).not.toHaveBeenCalled();
  });
});

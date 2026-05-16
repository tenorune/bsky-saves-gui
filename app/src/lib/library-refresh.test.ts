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
    // Defaults are all-off as of the first-time-use change; flip them on
    // for this test so we exercise the post-refresh hydration path.
    const { setAssetToggle } = await import('./asset-toggles');
    await setAssetToggle('images', true);
    await setAssetToggle('articles', true);

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

  it('refuses to reconcile when fetch returns empty against a non-empty prior (bug #35)', async () => {
    // The reconcile-against-empty-fetch path silently deletes the user's
    // library under keep-lost / sync retain modes. The guard in
    // onAfterEnrich throws instead, leaving the prior inventory intact
    // and surfacing the failure via the error state.
    const priorInv = { saves: [{ uri: 'at://1' }, { uri: 'at://2' }, { uri: 'at://3' }] };
    const loadInventory = vi.fn().mockResolvedValue(priorInv);
    const saveInventory = vi.fn().mockResolvedValue(undefined);
    const loadFromDb = vi.fn().mockResolvedValue(undefined);

    // Mock orchestrate to invoke onAfterEnrich with an empty fetch
    // result — exactly what the bug-triggering path does.
    const orchestrate = vi.fn().mockImplementation(async (_input: unknown, hooks: { onAfterEnrich: (p: unknown) => Promise<unknown> }) => {
      // This throws (the guard fires); the catch below would otherwise
      // propagate it back up to startLibraryRefresh.
      await hooks.onAfterEnrich({ saves: [] });
      // Unreachable.
      return { saves: [] };
    });

    await startLibraryRefresh(
      { credentials: { handle: 'a', appPassword: 'b', pds: 'c' }, includeThreads: false },
      { orchestrate, saveInventory, loadFromDb, loadInventory },
    );

    const s = get(libraryRefreshState);
    expect(s.status).toBe('error');
    if (s.status === 'error') {
      expect(s.error).toMatch(/Refresh returned zero saves/);
      expect(s.error).toMatch(/your library had 3/);
    }
    // Critical: saveInventory was NOT called. The prior inventory is
    // untouched in storage.
    expect(saveInventory).not.toHaveBeenCalled();
  });

  it('still reconciles normally when both prior and fresh are non-empty', async () => {
    // Sanity check: the guard is narrow. A normal refresh (non-empty
    // fetch against non-empty prior) still flows through onAfterEnrich
    // → reconcile → saveInventory like before.
    const priorInv = { saves: [{ uri: 'at://1' }] };
    const freshInv = { saves: [{ uri: 'at://1' }, { uri: 'at://2' }] };
    const loadInventory = vi.fn().mockResolvedValue(priorInv);
    const saveInventory = vi.fn().mockResolvedValue(undefined);
    const loadFromDb = vi.fn().mockResolvedValue(undefined);

    const orchestrate = vi.fn().mockImplementation(async (_input: unknown, hooks: { onAfterEnrich: (p: unknown) => Promise<unknown> }) => {
      const reconciled = await hooks.onAfterEnrich(freshInv);
      return reconciled;
    });

    await startLibraryRefresh(
      { credentials: { handle: 'a', appPassword: 'b', pds: 'c' }, includeThreads: false },
      { orchestrate, saveInventory, loadFromDb, loadInventory },
    );

    expect(get(libraryRefreshState).status).toBe('idle');
    expect(saveInventory).toHaveBeenCalled();
  });

  it('still reconciles when both prior and fresh are empty (no false positive on fresh sign-in)', async () => {
    // The guard fires only when prior > 0 AND fresh === 0. A
    // first-ever sign-in (prior === 0, fresh === 0 because the user
    // genuinely has no saves yet) should not error.
    const loadInventory = vi.fn().mockResolvedValue(null); // no prior inventory
    const saveInventory = vi.fn().mockResolvedValue(undefined);
    const loadFromDb = vi.fn().mockResolvedValue(undefined);

    const orchestrate = vi.fn().mockImplementation(async (_input: unknown, hooks: { onAfterEnrich: (p: unknown) => Promise<unknown> }) => {
      const reconciled = await hooks.onAfterEnrich({ saves: [] });
      return reconciled;
    });

    await startLibraryRefresh(
      { credentials: { handle: 'a', appPassword: 'b', pds: 'c' }, includeThreads: false },
      { orchestrate, saveInventory, loadFromDb, loadInventory },
    );

    expect(get(libraryRefreshState).status).toBe('idle');
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
    // library-refresh does async IndexedDB work before orchestrate (load
    // the retain mode, then snapshot prior hydrated fields). A single
    // setTimeout(0) is enough to flush these microtasks locally but is
    // timing-dependent under CI's scheduling — a stale flake surfaced
    // intermittently. Use vi.waitFor to deterministically wait for the
    // orchestrate mock to be invoked (and resolveOrchestrate to be set)
    // before exercising the cancel path.
    await vi.waitFor(() => expect(orchestrate).toHaveBeenCalled());
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

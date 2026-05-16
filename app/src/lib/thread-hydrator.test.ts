import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { threadHydrator, cancelThreadHydration } from './thread-hydrator';
import { threadProgress, resetThreadProgress } from './hydration-state';

describe('threadHydrator (helper path)', () => {
  beforeEach(() => resetThreadProgress());

  it('calls hydrateThreads and merges thread fields keyed by uri', async () => {
    const fakeHT = vi.fn().mockResolvedValue({
      threaded: [{ uri: 'at://a', thread_replies: [], thread_schema_version: 4, thread_fetched_at: '2026-05-07T00:00:00Z' }],
      errors: [],
    });
    const out = await threadHydrator.start({
      backend: { kind: 'helper' },
      origin: 'http://x',
      inventory: { saves: [{ uri: 'at://a' }, { uri: 'at://b' }] },
      credentials: { accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:1' },
    }, { hydrateThreads: fakeHT });

    const saves = (out as { saves: { uri: string; thread_replies?: unknown }[] }).saves;
    expect(saves[0].thread_replies).toEqual([]);
    expect(saves[1].thread_replies).toBeUndefined();
    expect(get(threadProgress).status).toBe('done');
  });
});

describe('threadHydrator (pyodide path)', () => {
  beforeEach(() => resetThreadProgress());

  it('delegates to driver.runThreadsOnly()', async () => {
    const fakeDriver = { initialise: vi.fn().mockResolvedValue(undefined), runThreadsOnly: vi.fn().mockResolvedValue({ saves: [] }) };
    await threadHydrator.start({
      backend: { kind: 'pyodide' },
      origin: '',
      inventory: { saves: [] },
      credentials: { handle: 'h', appPassword: 'p', pds: 'd' },
    }, { driver: fakeDriver as never });
    expect(fakeDriver.runThreadsOnly).toHaveBeenCalled();
  });

  it('returns the worker partial inventory on cooperative cancel', async () => {
    // Worker resolves runThreadsOnly with the disk inventory it had when
    // the cancel flag was observed between batches. Save `a` is hydrated;
    // `b` is still pending.
    const partialInventory = {
      saves: [
        { uri: 'at://a', thread_replies: [], thread_schema_version: 3, thread_fetched_at: '2026-05-08T00:00:00Z' },
        { uri: 'at://b' },
      ],
    };
    let resolveRun: (v: unknown) => void = () => {};
    const fakeDriver = {
      initialise: vi.fn().mockResolvedValue(undefined),
      runThreadsOnly: vi.fn(() => new Promise((resolve) => { resolveRun = resolve; })),
      requestCancel: vi.fn().mockImplementation(() => {
        // Production: the worker breaks its batched loop, reads disk,
        // posts `result`. Mock that by resolving runThreadsOnly with the
        // partial inventory.
        resolveRun(partialInventory);
      }),
    };
    const inputInventory = { saves: [{ uri: 'at://a' }, { uri: 'at://b' }] };
    const startPromise = threadHydrator.start({
      backend: { kind: 'pyodide' },
      origin: '',
      inventory: inputInventory,
      credentials: { handle: 'h', appPassword: 'p', pds: 'd' },
    }, { driver: fakeDriver as never });
    // Wait until start() has actually invoked runThreadsOnly — there are
    // multiple awaits before then (loadFailures hits IndexedDB).
    while (fakeDriver.runThreadsOnly.mock.calls.length === 0) {
      await new Promise((r) => setTimeout(r, 5));
    }
    cancelThreadHydration();
    // Status flips to 'cancelling' immediately while we wait for the
    // worker to finish its in-flight batch and post the final result.
    expect(get(threadProgress).status).toBe('cancelling');
    const out = await startPromise;
    expect(fakeDriver.requestCancel).toHaveBeenCalled();
    expect(out).toEqual(partialInventory);
    expect(get(threadProgress).status).toBe('cancelled');
  });

  it('drives progress store from per-batch onProgress callback', async () => {
    type ProgressFn = (p: { succeeded: number; failed: number; remaining: number }) => void;
    let capturedOnProgress: ProgressFn = () => {};
    let resolveRun: (v: unknown) => void = () => {};
    const fakeDriver = {
      initialise: vi.fn().mockResolvedValue(undefined),
      runThreadsOnly: vi.fn((_input: unknown, opts: { onProgress?: ProgressFn }) => {
        if (opts.onProgress) capturedOnProgress = opts.onProgress;
        return new Promise((resolve) => { resolveRun = resolve; });
      }),
      requestCancel: vi.fn(),
    };
    const inputInventory = { saves: [{ uri: 'at://a' }, { uri: 'at://b' }, { uri: 'at://c' }] };
    const startPromise = threadHydrator.start({
      backend: { kind: 'pyodide' },
      origin: '',
      inventory: inputInventory,
      credentials: { handle: 'h', appPassword: 'p', pds: 'd' },
    }, { driver: fakeDriver as never });
    while (fakeDriver.runThreadsOnly.mock.calls.length === 0) {
      await new Promise((r) => setTimeout(r, 5));
    }
    capturedOnProgress({ succeeded: 2, failed: 0, remaining: 1 });
    expect(get(threadProgress).fetched).toBe(2);
    capturedOnProgress({ succeeded: 2, failed: 1, remaining: 0 });
    expect(get(threadProgress).failed).toBe(1);
    resolveRun(inputInventory);
    await startPromise;
  });

  it('helper-path cancel flips status straight to cancelled (no cancelling state)', async () => {
    // Helper path uses a different cancel mechanism from pyodide — assert
    // only that the cancel call flips status directly to 'cancelled'
    // without going through the 'cancelling' intermediate state.
    threadProgress.set({ status: 'running', total: 1, fetched: 0, skipped: 0, failed: 0, failures: [] });
    // Simulate an in-flight helper run by setting the module's active
    // backend via a no-op start() that hasn't reset things — but the
    // simpler check is just that cancelThreadHydration on a non-pyodide
    // active backend sets 'cancelled'. _activeBackend is null here, which
    // hits the same else branch. (Production callers always have an active
    // backend when they cancel; both code paths take the else branch.)
    cancelThreadHydration();
    expect(get(threadProgress).status).toBe('cancelled');
  });
});

describe('threadHydrator (helper path) bails out on pairing 401', () => {
  beforeEach(async () => {
    resetThreadProgress();
    const { _resetPairingTokenForTests, setPairingToken } = await import('./pairing-token');
    _resetPairingTokenForTests();
    setPairingToken('a'.repeat(22));
  });

  it('tags the failing chunk + remaining URIs with PAIRING_REQUIRED_REASON when the helper 401s', async () => {
    // Simulate handleAuthed401's effect: the helper-client wrapper would
    // throw on a 401, AND markPairingStale would have already flipped the
    // pairing-token store to 'stale' by the time the throw is caught. We
    // model both by having the mocked hydrateThreads call markPairingStale
    // before throwing.
    const { markPairingStale } = await import('./pairing-token');
    const { PAIRING_REQUIRED_REASON } = await import('./hydration-state');

    let callCount = 0;
    const fakeHT = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        // First chunk succeeds: nothing threaded, nothing erred.
        return { threaded: [], errors: [] };
      }
      // Second chunk: helper returns 401, helper-client.handleAuthed401
      // marks pairing stale, then helper-client re-throws.
      markPairingStale();
      throw new Error('helper /hydrate-threads returned 401');
    });

    // 50 saves → CHUNK_SIZE 25 → two chunks. Second chunk triggers the
    // bail-out; its 25 URIs + zero remaining beyond should all carry the
    // pairing-required reason.
    const saves = Array.from({ length: 50 }, (_, i) => ({ uri: `at://${i}` }));
    await threadHydrator.start({
      backend: { kind: 'helper' },
      origin: 'http://x',
      inventory: { saves },
      credentials: { accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:1' },
    }, { hydrateThreads: fakeHT });

    const state = get(threadProgress);
    expect(state.status).toBe('cancelled');
    // 25 failures, all with the pairing-required reason, all from chunk 2.
    expect(state.failures.length).toBe(25);
    for (const f of state.failures) {
      expect(f.reason).toBe(PAIRING_REQUIRED_REASON);
    }
    // The URIs covered are the second-chunk URIs (indices 25..49).
    const failedUris = state.failures.map((f) => f.url).sort();
    expect(failedUris[0]).toBe('at://25');
    expect(failedUris[failedUris.length - 1]).toBe('at://49');
    // Only the two chunks were attempted before bail-out.
    expect(fakeHT).toHaveBeenCalledTimes(2);
  });

  it('does not bail when the throw is not pairing-cause (state stays paired)', async () => {
    // Sanity check: a non-pairing throw (e.g., 500 upstream) propagates as
    // before, so the existing error-banner UX isn't accidentally rerouted
    // through the pairing-required path. The bail-out only fires when
    // pairing-token.state is 'stale'.
    const fakeHT = vi.fn(async () => {
      // NO markPairingStale call — this is an upstream-cause failure.
      throw new Error('helper /hydrate-threads returned 502');
    });
    const saves = [{ uri: 'at://a' }];
    await expect(
      threadHydrator.start({
        backend: { kind: 'helper' },
        origin: 'http://x',
        inventory: { saves },
        credentials: { accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:1' },
      }, { hydrateThreads: fakeHT }),
    ).rejects.toThrow(/502/);
  });
});

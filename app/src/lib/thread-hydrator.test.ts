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

  it('returns the worker snapshot on cancel instead of discarding partial work', async () => {
    // Snapshot contains save `a` with thread_replies populated — the partial
    // result of a hydration that was interrupted before reaching `b`.
    const partialSnapshot = {
      saves: [
        { uri: 'at://a', thread_replies: [], thread_schema_version: 3, thread_fetched_at: '2026-05-08T00:00:00Z' },
        { uri: 'at://b' },
      ],
    };
    // runThreadsOnly stays pending until the cancel rejects it (mirrors
    // production: cancelActive() rejects the in-flight send()).
    let rejectRun: ((e: Error) => void) | null = null;
    const fakeDriver = {
      initialise: vi.fn().mockResolvedValue(undefined),
      runThreadsOnly: vi.fn(() => new Promise((_resolve, reject) => { rejectRun = reject; })),
      requestSnapshotThenCancel: vi.fn().mockImplementation(async () => {
        rejectRun?.(new Error('pyodide worker cancelled'));
        return partialSnapshot;
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
    const out = await startPromise;
    expect(fakeDriver.requestSnapshotThenCancel).toHaveBeenCalled();
    expect(out).toEqual(partialSnapshot);
  });

  it('falls back to input inventory when snapshot is unavailable', async () => {
    let rejectRun: ((e: Error) => void) | null = null;
    const fakeDriver = {
      initialise: vi.fn().mockResolvedValue(undefined),
      runThreadsOnly: vi.fn(() => new Promise((_resolve, reject) => { rejectRun = reject; })),
      requestSnapshotThenCancel: vi.fn().mockImplementation(async () => {
        rejectRun?.(new Error('pyodide worker cancelled'));
        return null; // worker timed out / never wrote a snapshot
      }),
    };
    const inputInventory = { saves: [{ uri: 'at://a' }] };
    const startPromise = threadHydrator.start({
      backend: { kind: 'pyodide' },
      origin: '',
      inventory: inputInventory,
      credentials: { handle: 'h', appPassword: 'p', pds: 'd' },
    }, { driver: fakeDriver as never });
    while (fakeDriver.runThreadsOnly.mock.calls.length === 0) {
      await new Promise((r) => setTimeout(r, 5));
    }
    cancelThreadHydration();
    const out = await startPromise;
    expect(out).toBe(inputInventory);
  });
});

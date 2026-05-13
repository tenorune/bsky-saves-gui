import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the dependencies asset-trigger imports. Keeping mocks minimal —
// just enough to assert the loadFromDb-after-saveInventory sequence
// that fixes issue #15 (thread-render staleness).

vi.mock('./inventory-store', () => ({
  loadInventory: vi.fn(async () => ({ saves: [{ uri: 'at://did:plc:a/app.bsky.feed.post/abc' }] })),
  saveInventory: vi.fn(async () => undefined),
}));

vi.mock('./inventory-loader', () => ({
  loadFromDb: vi.fn(async () => undefined),
}));

vi.mock('./thread-hydrator', () => ({
  threadHydrator: {
    start: vi.fn(async () => ({
      saves: [
        {
          uri: 'at://did:plc:a/app.bsky.feed.post/abc',
          thread_replies: [{ uri: 'at://did:plc:a/app.bsky.feed.post/reply' }],
        },
      ],
    })),
  },
}));

vi.mock('./capability-snapshot', () => ({
  capabilitySnapshot: { subscribe: (run: (v: unknown) => void) => { run({ threads: { kind: 'helper' } }); return () => {}; } },
}));

vi.mock('./last-session', () => ({
  lastSession: { subscribe: (run: (v: unknown) => void) => { run(null); return () => {}; } },
}));

vi.mock('./sign-in-draft', () => ({
  signInDraft: {
    subscribe: (run: (v: unknown) => void) => {
      run({ handle: 'alice.bsky.social', appPassword: 'xxxx-xxxx-xxxx-xxxx', pds: 'https://bsky.social' });
      return () => {};
    },
  },
}));

describe('triggerThreadHydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refreshes inventoryState via loadFromDb after writing the hydrated inventory (issue #15)', async () => {
    const { triggerThreadHydration } = await import('./asset-trigger');
    const { saveInventory } = await import('./inventory-store');
    const { loadFromDb } = await import('./inventory-loader');

    await triggerThreadHydration();

    // saveInventory MUST be called before loadFromDb. Without this
    // ordering, Library/Post views would render stale saves until the
    // user hard-refreshes.
    expect(saveInventory).toHaveBeenCalledTimes(1);
    expect(loadFromDb).toHaveBeenCalledTimes(1);
    const saveOrder = (saveInventory as unknown as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[0];
    const loadOrder = (loadFromDb as unknown as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[0];
    expect(loadOrder).toBeGreaterThan(saveOrder);
  });

  it('saveInventory receives the threaded inventory returned by the hydrator', async () => {
    const { triggerThreadHydration } = await import('./asset-trigger');
    const { saveInventory } = await import('./inventory-store');

    await triggerThreadHydration();

    const arg = (saveInventory as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
      saves: { thread_replies?: unknown }[];
    };
    expect(arg.saves[0].thread_replies).toBeDefined();
  });
});

import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import 'fake-indexeddb/auto';

describe('inventoryLoader', () => {
  beforeEach(async () => {
    const { clearInventory } = await import('./inventory-store');
    await clearInventory();
    // Reset the loader module so its initial-load runs fresh per test.
    const { resetForTests } = await import('./inventory-loader');
    resetForTests();
  });

  it('starts in loading state, then resolves to null when nothing is stored', async () => {
    const { inventoryState, loadFromDb } = await import('./inventory-loader');
    expect(get(inventoryState).status).toBe('loading');
    await loadFromDb();
    expect(get(inventoryState)).toEqual({ status: 'empty' });
  });

  it('resolves to ready with the stored inventory', async () => {
    const { saveInventory } = await import('./inventory-store');
    await saveInventory({
      saves: [
        {
          uri: 'at://x/y/1',
          cid: 'c',
          author: { did: 'd', handle: 'h.example' },
          record: { text: 't', createdAt: '2026-04-01T00:00:00Z' },
          indexedAt: '2026-04-01T00:00:00Z',
        },
      ],
    });
    const { inventoryState, loadFromDb } = await import('./inventory-loader');
    await loadFromDb();
    const state = get(inventoryState);
    expect(state.status).toBe('ready');
    if (state.status === 'ready') {
      expect(state.inventory.saves).toHaveLength(1);
    }
  });

  it('reports parseError when stored data is malformed', async () => {
    const { saveInventory } = await import('./inventory-store');
    await saveInventory({ totally: 'not-an-inventory' });
    const { inventoryState, loadFromDb } = await import('./inventory-loader');
    await loadFromDb();
    const state = get(inventoryState);
    expect(state.status).toBe('error');
  });
});

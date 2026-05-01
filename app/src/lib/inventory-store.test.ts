// app/src/lib/inventory-store.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

describe('inventoryStore', () => {
  beforeEach(async () => {
    const { clearInventory } = await import('./inventory-store');
    await clearInventory();
  });

  it('returns null when no inventory has been saved', async () => {
    const { loadInventory } = await import('./inventory-store');
    expect(await loadInventory()).toBeNull();
  });

  it('round-trips a saved inventory', async () => {
    const { saveInventory, loadInventory } = await import('./inventory-store');
    const sample = { saves: [{ uri: 'at://x', text: 'hi' }], version: 1 };
    await saveInventory(sample);
    expect(await loadInventory()).toEqual(sample);
  });

  it('overwrites previous inventory on save', async () => {
    const { saveInventory, loadInventory } = await import('./inventory-store');
    await saveInventory({ saves: [{ uri: 'a' }] });
    await saveInventory({ saves: [{ uri: 'b' }] });
    const got = await loadInventory();
    expect(got).toEqual({ saves: [{ uri: 'b' }] });
  });

  it('clearInventory wipes the entry', async () => {
    const { saveInventory, loadInventory, clearInventory } = await import('./inventory-store');
    await saveInventory({ saves: [{ uri: 'a' }] });
    await clearInventory();
    expect(await loadInventory()).toBeNull();
  });
});

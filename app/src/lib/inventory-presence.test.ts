import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { get } from 'svelte/store';

beforeEach(() => {
  // localStorage persists across tests in the same module — wipe between
  // each so the module-load `readSync` doesn't carry state forward.
  localStorage.clear();
  vi.resetModules();
});

describe('inventory-presence', () => {
  it('starts false on a fresh browser (no localStorage entry)', async () => {
    const { inventoryPresent } = await import('./inventory-presence');
    expect(get(inventoryPresent)).toBe(false);
  });

  it('reads an existing flag synchronously at module load — survives reload', async () => {
    // Simulate a previous session having written the flag.
    localStorage.setItem('inventory-present:v1', '1');
    const { inventoryPresent } = await import('./inventory-presence');
    // No async wait — the value is correct on the first subscriber tick.
    // This is the property the navbar relies on to avoid the reload flash.
    expect(get(inventoryPresent)).toBe(true);
  });

  it('markInventoryPresent flips the store and persists', async () => {
    const { inventoryPresent, markInventoryPresent } = await import('./inventory-presence');
    expect(get(inventoryPresent)).toBe(false);
    markInventoryPresent();
    expect(get(inventoryPresent)).toBe(true);
    expect(localStorage.getItem('inventory-present:v1')).toBe('1');
  });

  it('clearInventoryPresent flips the store back and removes the entry', async () => {
    const { inventoryPresent, markInventoryPresent, clearInventoryPresent } = await import(
      './inventory-presence'
    );
    markInventoryPresent();
    expect(get(inventoryPresent)).toBe(true);
    clearInventoryPresent();
    expect(get(inventoryPresent)).toBe(false);
    expect(localStorage.getItem('inventory-present:v1')).toBeNull();
  });

  it('saveInventory marks present; clearInventory clears it', async () => {
    const { inventoryPresent } = await import('./inventory-presence');
    const { saveInventory, clearInventory } = await import('./inventory-store');
    expect(get(inventoryPresent)).toBe(false);
    await saveInventory({ saves: [] });
    expect(get(inventoryPresent)).toBe(true);
    await clearInventory();
    expect(get(inventoryPresent)).toBe(false);
  });
});

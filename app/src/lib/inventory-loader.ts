import { writable, type Readable } from 'svelte/store';
import { loadInventory } from './inventory-store';
import { parseInventory, type Inventory } from '../reader/inventory-shape';

export type InventoryState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'ready'; inventory: Inventory }
  | { status: 'error'; message: string };

const store = writable<InventoryState>({ status: 'loading' });
export const inventoryState: Readable<InventoryState> = { subscribe: store.subscribe };

export async function loadFromDb(): Promise<void> {
  store.set({ status: 'loading' });
  const raw = await loadInventory();
  if (raw === null) {
    store.set({ status: 'empty' });
    return;
  }
  try {
    const inventory = parseInventory(raw);
    store.set({ status: 'ready', inventory });
  } catch (e) {
    store.set({
      status: 'error',
      message: e instanceof Error ? e.message : 'Failed to parse inventory',
    });
  }
}

/** For tests only — resets the store to its initial state. */
export function resetForTests(): void {
  store.set({ status: 'loading' });
}

import { writable, type Readable, get } from 'svelte/store';
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
  // Only show the 'loading' placeholder when we have nothing usable to display.
  // When the store is already 'ready' (e.g., a mid-refresh save+reload cycle),
  // keep the existing saves visible until the new ones are parsed — otherwise
  // Library would unmount/remount LibraryView and flash mid-refresh.
  const cur = get(store);
  if (cur.status !== 'ready') {
    store.set({ status: 'loading' });
  }
  const raw = await loadInventory();
  if (raw === null) {
    store.set({ status: 'empty' });
    return;
  }
  // Debug aid while we iterate on bsky-saves' inventory shape: dump the
  // structure of the first save to the console so an unexpected shape can be
  // diagnosed without inspecting IndexedDB by hand.
  if (typeof raw === 'object' && raw !== null && 'saves' in raw) {
    const saves = (raw as { saves?: unknown }).saves;
    if (Array.isArray(saves) && saves.length > 0) {
      // eslint-disable-next-line no-console
      console.debug('[inventory-loader] sample save:', saves[0]);
    }
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

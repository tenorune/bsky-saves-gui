import { get, set, del } from 'idb-keyval';

const KEY = 'inventory:v1';

export type Inventory = unknown; // shape comes from bsky-saves; treated opaquely here

export async function saveInventory(inventory: Inventory): Promise<void> {
  await set(KEY, inventory);
}

export async function loadInventory(): Promise<Inventory | null> {
  const v = await get(KEY);
  return v === undefined ? null : v;
}

export async function clearInventory(): Promise<void> {
  await del(KEY);
}

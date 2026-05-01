import { loadInventory } from './inventory-store';

export async function decideEntryRoute(): Promise<string> {
  const inv = await loadInventory();
  return inv === null ? '/' : '/library';
}

import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

describe('return-visit', () => {
  beforeEach(async () => {
    const { clearInventory, saveInventory } = await import('./inventory-store');
    await clearInventory();
    void saveInventory; // referenced to keep the import live
  });

  it('returns "/" when no inventory', async () => {
    const { decideEntryRoute } = await import('./return-visit');
    expect(await decideEntryRoute()).toBe('/');
  });

  it('returns "/library" when inventory exists', async () => {
    const { saveInventory } = await import('./inventory-store');
    await saveInventory({ saves: [] });
    const { decideEntryRoute } = await import('./return-visit');
    expect(await decideEntryRoute()).toBe('/library');
  });
});

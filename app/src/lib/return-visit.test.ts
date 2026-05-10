import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

describe('decideEntryRoute', () => {
  beforeEach(async () => {
    const { clearInventory } = await import('./inventory-store');
    await clearInventory();
  });

  describe('root URL (cold tab to the domain)', () => {
    it('null when no inventory — caller stays on / and shows sign-in', async () => {
      const { decideEntryRoute } = await import('./return-visit');
      expect(await decideEntryRoute('')).toBeNull();
      expect(await decideEntryRoute('#/')).toBeNull();
    });

    it('"/library" when inventory exists — auto-resume into the cached library', async () => {
      const { saveInventory } = await import('./inventory-store');
      await saveInventory({ saves: [] });
      const { decideEntryRoute } = await import('./return-visit');
      expect(await decideEntryRoute('')).toBe('/library');
      expect(await decideEntryRoute('#/')).toBe('/library');
    });
  });

  describe('data-required routes', () => {
    it('redirects #/library to / when no inventory', async () => {
      const { decideEntryRoute } = await import('./return-visit');
      expect(await decideEntryRoute('#/library')).toBe('/');
    });

    it('redirects #/post/abc123 to / when no inventory', async () => {
      const { decideEntryRoute } = await import('./return-visit');
      expect(await decideEntryRoute('#/post/abc123')).toBe('/');
    });

    it('returns null on #/library when inventory exists — viewable while signed out', async () => {
      const { saveInventory } = await import('./inventory-store');
      await saveInventory({ saves: [] });
      const { decideEntryRoute } = await import('./return-visit');
      expect(await decideEntryRoute('#/library')).toBeNull();
    });

    it('returns null on #/post/abc123 when inventory exists', async () => {
      const { saveInventory } = await import('./inventory-store');
      await saveInventory({ saves: [] });
      const { decideEntryRoute } = await import('./return-visit');
      expect(await decideEntryRoute('#/post/abc123')).toBeNull();
    });
  });

  describe('auxiliary routes are always reachable', () => {
    it('null on #/settings regardless of inventory state', async () => {
      const { decideEntryRoute } = await import('./return-visit');
      expect(await decideEntryRoute('#/settings')).toBeNull();
    });

    it('null on #/privacy regardless of inventory state', async () => {
      const { decideEntryRoute } = await import('./return-visit');
      expect(await decideEntryRoute('#/privacy')).toBeNull();
    });

    it('null on an unknown hash (not-found is its own valid state)', async () => {
      const { decideEntryRoute } = await import('./return-visit');
      expect(await decideEntryRoute('#/totally-unknown')).toBeNull();
    });
  });
});

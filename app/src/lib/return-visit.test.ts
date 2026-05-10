import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const SESSION = {
  pds: 'https://x',
  accessJwt: 'a',
  refreshJwt: 'r',
  did: 'd',
  handle: 'h',
};

describe('decideEntryRoute', () => {
  beforeEach(async () => {
    const { clearInventory } = await import('./inventory-store');
    await clearInventory();
  });

  describe('root URL (cold tab to the domain)', () => {
    it('null when no inventory and no session — stay on /', async () => {
      const { decideEntryRoute } = await import('./return-visit');
      expect(await decideEntryRoute('')).toBeNull();
      expect(await decideEntryRoute('#/')).toBeNull();
    });

    it('null when inventory exists but no active session', async () => {
      const { saveInventory } = await import('./inventory-store');
      await saveInventory({ saves: [] });
      const { decideEntryRoute } = await import('./return-visit');
      // Without a session, auto-resume into /library is wrong — the
      // user would land on a library they can't refresh. Stay on /.
      expect(await decideEntryRoute('', null)).toBeNull();
    });

    it('"/library" when both inventory and session exist — auto-resume', async () => {
      const { saveInventory } = await import('./inventory-store');
      await saveInventory({ saves: [] });
      const { decideEntryRoute } = await import('./return-visit');
      expect(await decideEntryRoute('', SESSION)).toBe('/library');
      expect(await decideEntryRoute('#/', SESSION)).toBe('/library');
    });
  });

  describe('data-required routes', () => {
    it('redirects #/library to / when no inventory', async () => {
      const { decideEntryRoute } = await import('./return-visit');
      expect(await decideEntryRoute('#/library', SESSION)).toBe('/');
    });

    it('redirects #/library to / when no active session, even with inventory', async () => {
      const { saveInventory } = await import('./inventory-store');
      await saveInventory({ saves: [] });
      const { decideEntryRoute } = await import('./return-visit');
      expect(await decideEntryRoute('#/library', null)).toBe('/');
    });

    it('redirects #/post/abc123 to / when no inventory', async () => {
      const { decideEntryRoute } = await import('./return-visit');
      expect(await decideEntryRoute('#/post/abc123', SESSION)).toBe('/');
    });

    it('redirects #/post/abc123 to / when no active session', async () => {
      const { saveInventory } = await import('./inventory-store');
      await saveInventory({ saves: [] });
      const { decideEntryRoute } = await import('./return-visit');
      expect(await decideEntryRoute('#/post/abc123', null)).toBe('/');
    });

    it('returns null on #/library when both inventory and session exist (stay)', async () => {
      const { saveInventory } = await import('./inventory-store');
      await saveInventory({ saves: [] });
      const { decideEntryRoute } = await import('./return-visit');
      expect(await decideEntryRoute('#/library', SESSION)).toBeNull();
    });

    it('returns null on #/post/abc123 when both inventory and session exist', async () => {
      const { saveInventory } = await import('./inventory-store');
      await saveInventory({ saves: [] });
      const { decideEntryRoute } = await import('./return-visit');
      expect(await decideEntryRoute('#/post/abc123', SESSION)).toBeNull();
    });
  });

  describe('auxiliary routes are always reachable', () => {
    it('null on #/settings regardless of inventory or session', async () => {
      const { decideEntryRoute } = await import('./return-visit');
      expect(await decideEntryRoute('#/settings')).toBeNull();
      expect(await decideEntryRoute('#/settings', null)).toBeNull();
      expect(await decideEntryRoute('#/settings', SESSION)).toBeNull();
    });

    it('null on #/privacy regardless of inventory or session', async () => {
      const { decideEntryRoute } = await import('./return-visit');
      expect(await decideEntryRoute('#/privacy')).toBeNull();
    });

    it('null on an unknown hash (not-found is its own valid state)', async () => {
      const { decideEntryRoute } = await import('./return-visit');
      expect(await decideEntryRoute('#/totally-unknown')).toBeNull();
    });
  });
});

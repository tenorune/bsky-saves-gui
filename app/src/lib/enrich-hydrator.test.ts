import { describe, expect, it, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { enrichHydrator } from './enrich-hydrator';
import { enrichProgress, resetEnrichProgress } from './hydration-state';

describe('enrichHydrator (helper path)', () => {
  beforeEach(() => resetEnrichProgress());

  it('calls enrichUris and merges post_created_at deltas keyed by uri', async () => {
    const inv = { saves: [{ uri: 'at://a' }, { uri: 'at://b' }] };
    const fakeEnrich = vi.fn().mockResolvedValue({
      enriched: [{ uri: 'at://a', post_created_at: '2026-01-01T00:00:00Z' }],
      errors: [{ uri: 'at://b', reason: 'invalid at-uri' }],
    });
    const out = await enrichHydrator.start({
      backend: { kind: 'helper' },
      origin: 'http://x',
      inventory: inv,
    }, { enrichUris: fakeEnrich });

    expect((out as { saves: { uri: string; post_created_at?: string }[] }).saves).toEqual([
      { uri: 'at://a', post_created_at: '2026-01-01T00:00:00Z' },
      { uri: 'at://b' },
    ]);
    expect(get(enrichProgress).status).toBe('done');
    expect(get(enrichProgress).failed).toBe(1);
  });
});

describe('enrichHydrator (pyodide path)', () => {
  beforeEach(() => resetEnrichProgress());

  it('delegates to driver.runEnrichOnly()', async () => {
    const fakeDriver = { runEnrichOnly: vi.fn().mockResolvedValue({ saves: [{ uri: 'at://a', post_created_at: 'X' }] }) };
    const out = await enrichHydrator.start({
      backend: { kind: 'pyodide' },
      origin: '',
      inventory: { saves: [{ uri: 'at://a' }] },
    }, { driver: fakeDriver as never });
    expect(fakeDriver.runEnrichOnly).toHaveBeenCalledWith({ inventory: { saves: [{ uri: 'at://a' }] } });
    expect(out).toEqual({ saves: [{ uri: 'at://a', post_created_at: 'X' }] });
  });
});

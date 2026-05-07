import { describe, expect, it, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { fetchHydrator } from './fetch-hydrator';
import { fetchProgress, resetFetchProgress } from './hydration-state';

describe('fetchHydrator (helper path)', () => {
  beforeEach(() => resetFetchProgress());

  it('paginates through /fetch until cursor is null', async () => {
    const calls: unknown[] = [];
    const fakeFetch = vi.fn()
      .mockResolvedValueOnce({ saves: [{ uri: 'at://a' }], cursor: 'c1' })
      .mockResolvedValueOnce({ saves: [{ uri: 'at://b' }], cursor: null });

    const inv = await fetchHydrator.start({
      backend: { kind: 'helper' },
      origin: 'http://x',
      credentials: { handle: 'h', appPassword: 'p', pds: 'd' },
    }, { fetchSaves: (origin, req) => { calls.push(req); return fakeFetch(origin, req); } });

    expect(inv).toEqual({ saves: [{ uri: 'at://a' }, { uri: 'at://b' }] });
    expect(calls).toHaveLength(2);
    expect((calls[0] as { cursor: unknown }).cursor).toBeNull();
    expect((calls[1] as { cursor: unknown }).cursor).toBe('c1');
    expect(get(fetchProgress).status).toBe('done');
    expect(get(fetchProgress).fetched).toBe(2);
  });

  it('persists rotated_credentials via setLastSession before issuing the next request', async () => {
    const callOrder: string[] = [];
    const setLastSession = vi.fn().mockImplementation(() => { callOrder.push('setLastSession'); });
    const fakeFetch = vi.fn()
      .mockImplementationOnce(() => { callOrder.push('fetch1'); return Promise.resolve({ saves: [], cursor: 'c1', rotated_credentials: { access_jwt: 'A2', refresh_jwt: 'R2', did: 'did:plc:1' } }); })
      .mockImplementationOnce(() => { callOrder.push('fetch2'); return Promise.resolve({ saves: [], cursor: null }); });

    await fetchHydrator.start({
      backend: { kind: 'helper' },
      origin: 'http://x',
      credentials: { accessJwt: 'A1', refreshJwt: 'R1', did: 'did:plc:1' },
    }, { fetchSaves: (_o, _r) => fakeFetch(), setLastSession });

    // setLastSession must be called BEFORE the second fetchSaves call.
    expect(callOrder).toEqual(['fetch1', 'setLastSession', 'fetch2']);
    expect(setLastSession.mock.calls[0][0]).toMatchObject({
      accessJwt: 'A2', refreshJwt: 'R2', did: 'did:plc:1',
    });
  });

  it('marks progress error and rethrows on helper failure', async () => {
    await expect(fetchHydrator.start({
      backend: { kind: 'helper' },
      origin: 'http://x',
      credentials: { handle: 'h', appPassword: 'p', pds: 'd' },
    }, { fetchSaves: () => { throw new Error('createSession failed'); } })).rejects.toThrow(/createSession failed/);
    expect(get(fetchProgress).status).toBe('cancelled');
  });
});

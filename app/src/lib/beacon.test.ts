import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

describe('beacon', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('throws if VITE_BEACON_AT_URI is empty', async () => {
    const original = import.meta.env.VITE_BEACON_AT_URI;
    Object.assign(import.meta.env, { VITE_BEACON_AT_URI: '' });
    vi.resetModules();
    try {
      const { likeBeacon, BeaconNotConfiguredError } = await import('./beacon');
      await expect(
        likeBeacon({ pds: 'https://bsky.social', accessJwt: 'jwt', did: 'd' }),
      ).rejects.toBeInstanceOf(BeaconNotConfiguredError);
    } finally {
      Object.assign(import.meta.env, { VITE_BEACON_AT_URI: original });
      vi.resetModules();
    }
  });

  it('POSTs createRecord to the PDS with the beacon target', async () => {
    Object.assign(import.meta.env, {
      VITE_BEACON_AT_URI: 'at://did:plc:op/app.bsky.feed.post/3lkx',
    });
    vi.resetModules();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ uri: 'at://x', cid: 'c' }), { status: 200 }),
    );
    const { likeBeacon } = await import('./beacon');
    await likeBeacon({ pds: 'https://bsky.social', accessJwt: 'jwt', did: 'did:plc:user' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://bsky.social/xrpc/com.atproto.repo.createRecord');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer jwt');
    const body = JSON.parse(init.body as string);
    expect(body.repo).toBe('did:plc:user');
    expect(body.collection).toBe('app.bsky.feed.like');
    expect(body.record.subject.uri).toBe('at://did:plc:op/app.bsky.feed.post/3lkx');
  });

  it('hasBeaconBeenSent persists state across calls', async () => {
    Object.assign(import.meta.env, {
      VITE_BEACON_AT_URI: 'at://did:plc:op/app.bsky.feed.post/3lkx',
    });
    vi.resetModules();
    const { hasBeaconBeenSent, markBeaconSent, clearBeaconSent } = await import('./beacon');
    await clearBeaconSent();
    expect(await hasBeaconBeenSent()).toBe(false);
    await markBeaconSent();
    expect(await hasBeaconBeenSent()).toBe(true);
    await clearBeaconSent();
    expect(await hasBeaconBeenSent()).toBe(false);
  });
});

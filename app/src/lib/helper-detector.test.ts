import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('helperDetector', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns "available" when /health responds 200 with ok=true', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, version: '0.1.0' }), { status: 200 }),
    );
    const { detectHelper } = await import('./helper-detector');
    const result = await detectHelper();
    expect(result).toEqual({ status: 'available', version: '0.1.0' });
  });

  it('returns "unavailable" on network error', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { detectHelper } = await import('./helper-detector');
    expect(await detectHelper()).toEqual({ status: 'unavailable' });
  });

  it('returns "unavailable" on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 503 }));
    const { detectHelper } = await import('./helper-detector');
    expect(await detectHelper()).toEqual({ status: 'unavailable' });
  });
});

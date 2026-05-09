import { describe, expect, it, vi } from 'vitest';
import {
  classifyOperatorProxyProbe,
  probeOperatorProxy,
} from './operator-proxy-probe';
import type { ProbeResult } from './user-worker-client';

describe('classifyOperatorProxyProbe', () => {
  it('maps capability-bearing results to ok', () => {
    const cases: ProbeResult[] = [
      { kind: 'has-articles' },
      { kind: 'image-only' },
      { kind: 'no-capabilities-endpoint' },
    ];
    for (const c of cases) {
      expect(classifyOperatorProxyProbe(c)).toBe('ok');
    }
  });

  it('maps origin-blocked to origin-blocked', () => {
    expect(classifyOperatorProxyProbe({ kind: 'origin-blocked' })).toBe('origin-blocked');
  });

  it('maps unauthorized to unauthorized', () => {
    expect(classifyOperatorProxyProbe({ kind: 'unauthorized' })).toBe('unauthorized');
  });

  it('maps unreachable to unreachable', () => {
    expect(
      classifyOperatorProxyProbe({ kind: 'unreachable', reason: 'Failed to fetch' }),
    ).toBe('unreachable');
  });
});

describe('probeOperatorProxy', () => {
  it('returns "unknown" when url is empty (operator proxy not configured)', async () => {
    const status = await probeOperatorProxy('', '');
    expect(status).toBe('unknown');
  });

  it('returns "unreachable" on a network failure (regression: bare-hostname misconfig)', async () => {
    // Simulate fetch() throwing — this is what happens for a host that
    // doesn't exist or refuses CORS preflight. The previous OPTIONS-only
    // probe returned "ok" when the page origin returned 204 for a bogus
    // path; the new probe goes through GET /capabilities and surfaces
    // the failure.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    try {
      const status = await probeOperatorProxy('https://nope.example.workers.dev', 'secret');
      expect(status).toBe('unreachable');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns "unauthorized" when the worker rejects the shared secret', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response('{"error":"Unauthorized"}', {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    try {
      const status = await probeOperatorProxy('https://operator.example.workers.dev', 'wrong');
      expect(status).toBe('unauthorized');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns "ok" when the worker returns a capabilities envelope', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ endpoints: ['/fetch'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    try {
      const status = await probeOperatorProxy('https://operator.example.workers.dev', 'right');
      expect(status).toBe('ok');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

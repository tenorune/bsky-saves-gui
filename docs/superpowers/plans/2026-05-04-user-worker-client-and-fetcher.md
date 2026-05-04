# Plan 3: User-worker client, backend resolver, and image-fetcher

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Wire the two image-fetching backends (local helper + user-deployed Cloudflare Worker) and a small dispatcher that picks the highest-priority available one.

**Architecture:** Three small TypeScript modules:
1. Extend `helper-client.ts` with `fetchImageViaHelper(url)` per the `bsky-saves serve` spec (`POST /fetch-image` returns raw bytes).
2. New `user-worker-client.ts` for the existing cf-worker template's `POST /fetch` (returns `body_b64` JSON; decoded to a Blob).
3. New `image-fetcher.ts` exposing `detectBackends()` and `fetchImage(url)` — the latter picks the highest-priority available backend and forwards.

The operator-hosted proxy backend is **not** in this plan. It needs a hardened cf-worker variant (URL allowlist, raw-bytes response) that doesn't exist yet; we'll add it in a later plan once the deployment story is decided.

**Tech Stack:** Same as Plan 2 (TypeScript 5, Vitest 2, idb-keyval).

**Spec references:** `docs/bsky-saves-serve-requirements.md` for the helper API; `templates/cf-worker/worker.js` for the user-worker API; `docs/superpowers/specs/2026-05-04-hydration-and-backup-ux-design.md` "Layered backend strategy".

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `dc2bc11` (Plan 2 final commit) or later.

---

## Task 1: Add `fetchImageViaHelper` to helper-client

Extend the helper client with a typed `fetchImageViaHelper(url)` that POSTs to `/fetch-image` and returns the raw response body as a `Blob`.

**Files:**
- Modify: `app/src/lib/helper-client.ts`
- Modify: `app/src/lib/helper-client.test.ts`

- [ ] **Step 1: Add tests for `fetchImageViaHelper`**

Append the following `describe` block to the END of `app/src/lib/helper-client.test.ts` (after the existing `describe('helper-client probeHelper', ...)`):

```ts
describe('helper-client fetchImageViaHelper', () => {
  it('POSTs the URL as JSON and returns the response body as a Blob', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'image/png' : null) },
      blob: async () => new Blob(['IMG'], { type: 'image/png' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchImageViaHelper } = await import('./helper-client');
    const blob = await fetchImageViaHelper('http://127.0.0.1:47826', 'https://cdn.bsky.app/img/foo.jpg');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(3);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:47826/fetch-image',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ url: 'https://cdn.bsky.app/img/foo.jpg' }),
      }),
    );
  });

  it('throws on non-2xx response with the upstream status in the message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, blob: async () => new Blob() })));
    const { fetchImageViaHelper } = await import('./helper-client');
    await expect(
      fetchImageViaHelper('http://127.0.0.1:47826', 'https://cdn.bsky.app/img/foo.jpg'),
    ).rejects.toThrow(/502/);
  });

  it('throws on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { fetchImageViaHelper } = await import('./helper-client');
    await expect(
      fetchImageViaHelper('http://127.0.0.1:47826', 'https://cdn.bsky.app/img/foo.jpg'),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail with "no such export"**

Run: `pnpm test helper-client`

Expected: 3 failures (the new ones); existing 5 still pass.

- [ ] **Step 3: Implement `fetchImageViaHelper` in helper-client.ts**

Add to `app/src/lib/helper-client.ts` (below `probeConfiguredHelper`):

```ts
/**
 * Fetch a single image via the local helper's POST /fetch-image endpoint.
 * The helper does the outbound HTTP from the user's machine and streams the
 * raw bytes back. Throws on non-2xx response or network error.
 */
export async function fetchImageViaHelper(origin: string, imageUrl: string): Promise<Blob> {
  const base = origin.replace(/\/+$/, '');
  const res = await fetch(`${base}/fetch-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: imageUrl }),
  });
  if (!res.ok) {
    throw new Error(`helper /fetch-image returned ${res.status}`);
  }
  return res.blob();
}
```

- [ ] **Step 4: Run tests — confirm all 8 pass**

Run: `pnpm test helper-client`

Expected: 8/8 passing.

- [ ] **Step 5: Run full type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 errors. Total goes 81 → 84.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(helper-client): add fetchImageViaHelper (POST /fetch-image)"
```

DO NOT push.

---

## Task 2: User-worker client (wraps the existing cf-worker /fetch)

The cf-worker template at `templates/cf-worker/worker.js` exposes `POST /fetch` with `X-Proxy-Secret` auth. The response is JSON: `{ status, headers, body_b64 }`. This task adds a typed client that calls it and decodes the base64 body into a Blob, reading `Content-Type` from the returned headers when present.

**Files:**
- Create: `app/src/lib/user-worker-client.ts`
- Create: `app/src/lib/user-worker-client.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/user-worker-client.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.unstubAllGlobals();
});

const SAMPLE_CONFIG = {
  url: 'https://my-worker.workers.dev',
  sharedSecret: 's3cret',
};

describe('user-worker-client fetchImageViaUserWorker', () => {
  it('POSTs the URL with the shared secret and decodes body_b64 into a Blob', async () => {
    // 'IMG' base64-encoded
    const b64 = btoa('IMG');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        status: 200,
        headers: { 'content-type': 'image/png' },
        body_b64: b64,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchImageViaUserWorker } = await import('./user-worker-client');
    const blob = await fetchImageViaUserWorker(SAMPLE_CONFIG, 'https://cdn.bsky.app/img/foo.jpg');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(3);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://my-worker.workers.dev/fetch',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Proxy-Secret': 's3cret',
        }),
        body: JSON.stringify({ url: 'https://cdn.bsky.app/img/foo.jpg' }),
      }),
    );
  });

  it('falls back to application/octet-stream when the upstream omits Content-Type', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 200, headers: {}, body_b64: btoa('IMG') }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchImageViaUserWorker } = await import('./user-worker-client');
    const blob = await fetchImageViaUserWorker(SAMPLE_CONFIG, 'https://x/y.jpg');
    expect(blob.type).toBe('application/octet-stream');
  });

  it('throws when the worker returns non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) })),
    );
    const { fetchImageViaUserWorker } = await import('./user-worker-client');
    await expect(
      fetchImageViaUserWorker(SAMPLE_CONFIG, 'https://x/y.jpg'),
    ).rejects.toThrow(/401/);
  });

  it('throws when upstream status (inside the worker payload) is non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: 404, headers: {}, body_b64: '' }),
      })),
    );
    const { fetchImageViaUserWorker } = await import('./user-worker-client');
    await expect(
      fetchImageViaUserWorker(SAMPLE_CONFIG, 'https://x/missing.jpg'),
    ).rejects.toThrow(/upstream 404/);
  });

  it('throws on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { fetchImageViaUserWorker } = await import('./user-worker-client');
    await expect(
      fetchImageViaUserWorker(SAMPLE_CONFIG, 'https://x/y.jpg'),
    ).rejects.toThrow();
  });

  it('strips a trailing slash from the worker URL before appending /fetch', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 200, headers: {}, body_b64: btoa('') }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchImageViaUserWorker } = await import('./user-worker-client');
    await fetchImageViaUserWorker(
      { ...SAMPLE_CONFIG, url: 'https://my-worker.workers.dev/' },
      'https://x/y.jpg',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://my-worker.workers.dev/fetch',
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail with module-not-found**

Run: `pnpm test user-worker-client`

Expected: failures because the module doesn't exist yet.

- [ ] **Step 3: Implement the module**

Create `app/src/lib/user-worker-client.ts`:

```ts
// Client for a user-deployed Cloudflare Worker (templates/cf-worker/worker.js).
// The worker exposes POST /fetch which fetches a URL server-side and returns
// JSON with the base64-encoded body. We decode that into a Blob with the
// upstream Content-Type when known.

import type { ProxyConfig } from './proxy-config';

interface FetchEnvelope {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body_b64: string;
}

function isFetchEnvelope(v: unknown): v is FetchEnvelope {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.status === 'number' &&
    typeof r.headers === 'object' &&
    r.headers !== null &&
    typeof r.body_b64 === 'string'
  );
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Fetch a single image through a user-deployed cf-worker proxy. The worker
 * receives the URL via POST /fetch with the shared-secret header, fetches it
 * server-side, and returns base64-encoded bytes. We decode and wrap as a Blob.
 *
 * Throws on:
 *   - non-2xx response from the worker itself (auth failure, missing config)
 *   - non-2xx upstream status carried inside the envelope (404 from the CDN)
 *   - malformed JSON envelope
 *   - network failure
 */
export async function fetchImageViaUserWorker(
  config: ProxyConfig,
  imageUrl: string,
): Promise<Blob> {
  const base = config.url.replace(/\/+$/, '');
  const res = await fetch(`${base}/fetch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Proxy-Secret': config.sharedSecret,
    },
    body: JSON.stringify({ url: imageUrl }),
  });
  if (!res.ok) {
    throw new Error(`user worker returned ${res.status}`);
  }
  const envelope = (await res.json()) as unknown;
  if (!isFetchEnvelope(envelope)) {
    throw new Error('user worker returned malformed JSON');
  }
  if (envelope.status < 200 || envelope.status >= 300) {
    throw new Error(`user worker reported upstream ${envelope.status}`);
  }
  const bytes = base64ToUint8(envelope.body_b64);
  const contentType =
    envelope.headers['content-type'] ??
    envelope.headers['Content-Type'] ??
    'application/octet-stream';
  return new Blob([bytes], { type: contentType });
}
```

- [ ] **Step 4: Run tests — confirm all 6 pass**

Run: `pnpm test user-worker-client`

Expected: 6/6 passing.

- [ ] **Step 5: Run full type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 errors. Total goes 84 → 90.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(user-worker-client): POST /fetch wrapper that returns a Blob"
```

DO NOT push.

---

## Task 3: Backend resolver + high-level `fetchImage`

A tiny dispatcher that detects which backends are available and exposes one entry point — `fetchImage(url)` — that picks the highest-priority available backend and forwards to its specific client.

Priority order (per the design spec):
1. **helper** (most private, fastest, no third party)
2. **user-worker** (private but slower, requires user setup)

The operator-proxy backend is NOT included in this plan (see plan header).

**Files:**
- Create: `app/src/lib/image-fetcher.ts`
- Create: `app/src/lib/image-fetcher.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/image-fetcher.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.resetModules();
  const { clearProxyConfig } = await import('./proxy-config');
  await clearProxyConfig();
});

describe('detectBackends', () => {
  it('returns helper first when both helper and user-worker are configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ name: 'bsky-saves', version: '0.2.4', features: ['fetch-image'] }),
      })),
    );
    const { saveProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://my.workers.dev', sharedSecret: 's' });
    const { detectBackends } = await import('./image-fetcher');
    const backends = await detectBackends();
    expect(backends.map((b) => b.kind)).toEqual(['helper', 'user-worker']);
  });

  it('omits the helper when probe fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { saveProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://my.workers.dev', sharedSecret: 's' });
    const { detectBackends } = await import('./image-fetcher');
    const backends = await detectBackends();
    expect(backends.map((b) => b.kind)).toEqual(['user-worker']);
  });

  it('omits user-worker when proxy config is unset', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ name: 'bsky-saves', version: '0.2.4', features: ['fetch-image'] }),
      })),
    );
    const { detectBackends } = await import('./image-fetcher');
    const backends = await detectBackends();
    expect(backends.map((b) => b.kind)).toEqual(['helper']);
  });

  it('returns an empty list when nothing is configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { detectBackends } = await import('./image-fetcher');
    expect(await detectBackends()).toEqual([]);
  });
});

describe('fetchImage', () => {
  it('uses the helper when available', async () => {
    // First call (probe) returns ping payload; second call (fetch-image) returns blob.
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string) => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            json: async () => ({ name: 'bsky-saves', version: '0.2.4', features: ['fetch-image'] }),
          };
        }
        return {
          ok: true,
          headers: { get: () => 'image/png' },
          blob: async () => new Blob(['IMG'], { type: 'image/png' }),
        };
      }),
    );
    const { fetchImage } = await import('./image-fetcher');
    const blob = await fetchImage('https://cdn.bsky.app/img/foo.jpg');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(3);
  });

  it('falls back to user-worker when helper is not running', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw new TypeError('Failed to fetch'); // helper probe fails
        return {
          ok: true,
          json: async () => ({ status: 200, headers: { 'content-type': 'image/png' }, body_b64: btoa('IMG') }),
        };
      }),
    );
    const { saveProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://my.workers.dev', sharedSecret: 's' });
    const { fetchImage } = await import('./image-fetcher');
    const blob = await fetchImage('https://cdn.bsky.app/img/foo.jpg');
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(3);
  });

  it('throws NoBackendsAvailable when nothing is configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { fetchImage, NoBackendsAvailableError } = await import('./image-fetcher');
    await expect(fetchImage('https://x/y')).rejects.toBeInstanceOf(NoBackendsAvailableError);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail with module-not-found**

Run: `pnpm test image-fetcher`

Expected: failures because `./image-fetcher` doesn't exist.

- [ ] **Step 3: Implement the module**

Create `app/src/lib/image-fetcher.ts`:

```ts
// Layered backend dispatcher for image fetching. Detects which backends are
// available and exposes fetchImage(url), which picks the highest-priority
// backend and delegates.
//
// Priority: helper > user-worker. The operator-hosted proxy is not yet
// implemented; it will be added in a later plan once the deployment story is
// settled.

import { probeConfiguredHelper, fetchImageViaHelper } from './helper-client';
import { loadProxyConfig, type ProxyConfig } from './proxy-config';
import { fetchImageViaUserWorker } from './user-worker-client';
import { config } from './config';

export type BackendKind = 'helper' | 'user-worker';

export interface HelperBackend {
  readonly kind: 'helper';
  readonly version: string;
  readonly features: readonly string[];
}

export interface UserWorkerBackend {
  readonly kind: 'user-worker';
  readonly config: ProxyConfig;
}

export type Backend = HelperBackend | UserWorkerBackend;

export class NoBackendsAvailableError extends Error {
  constructor() {
    super('No image-fetching backend is available.');
    this.name = 'NoBackendsAvailableError';
  }
}

/**
 * Detect which backends are currently usable. Returns them in priority order
 * (most preferred first). Probes are run in parallel.
 */
export async function detectBackends(): Promise<Backend[]> {
  const [helperStatus, proxyCfg] = await Promise.all([
    probeConfiguredHelper(),
    loadProxyConfig(),
  ]);

  const out: Backend[] = [];
  if (helperStatus.status === 'available') {
    out.push({
      kind: 'helper',
      version: helperStatus.version,
      features: helperStatus.features,
    });
  }
  if (proxyCfg !== null && proxyCfg.url !== '' && proxyCfg.sharedSecret !== '') {
    out.push({ kind: 'user-worker', config: proxyCfg });
  }
  return out;
}

/**
 * Fetch a single image via the highest-priority available backend. Throws
 * `NoBackendsAvailableError` if no backend is configured. Throws the backend's
 * own error if the chosen backend fails (no automatic failover — the caller
 * decides whether to retry).
 */
export async function fetchImage(imageUrl: string): Promise<Blob> {
  const backends = await detectBackends();
  if (backends.length === 0) throw new NoBackendsAvailableError();
  const backend = backends[0];
  if (backend.kind === 'helper') {
    return fetchImageViaHelper(config.helperOrigin, imageUrl);
  }
  return fetchImageViaUserWorker(backend.config, imageUrl);
}
```

- [ ] **Step 4: Run tests — confirm all 7 pass**

Run: `pnpm test image-fetcher`

Expected: 7/7 passing.

- [ ] **Step 5: Run full type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 errors. Total goes 90 → 97.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(image-fetcher): backend resolver + fetchImage dispatcher (helper > user-worker)"
```

DO NOT push.

---

## Final verification

- [ ] **Step 1: Run check + test + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 type errors (3 pre-existing CSS warnings tolerated). All ~97 tests pass. Both bundles build.

- [ ] **Step 2: Push**

```bash
git push origin main
```

---

## What's next

Plan 4 introduces the hydration state stores (Svelte writables for image-backup progress) and the background hydration loop that walks an inventory's image URLs, calls `fetchImage(url)` for each, writes successes to `image-store`, and updates the state store as it goes. After Plan 4, all the moving parts are in place; Plans 5+ build the UI on top.

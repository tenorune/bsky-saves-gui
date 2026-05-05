# Plan 22: cf-worker article extraction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Add a bundled cf-worker variant with a `POST /extract-article` endpoint (Mozilla Readability + linkedom), wire it into the GUI's article-backup backend so users without a local helper can hydrate articles via their custom worker.

**Architecture:** Two artifacts in `templates/cf-worker/`: the existing hand-written `worker.js` (image-only, gains `GET /capabilities`) and a new `dist/worker-with-articles.bundle.js` (esbuild-built from `src/worker-with-articles.ts`). The setup-guide modal shows tabs in step 3 to switch which artifact to copy. On save the GUI probes `/capabilities`, persists `supportsArticles` in the proxy config, and the article hydrator falls back to the worker when no helper is running.

**Tech Stack:** Cloudflare Workers, `@mozilla/readability`, `linkedom`, esbuild, Svelte 4, Vitest, Wrangler `unstable_dev`.

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `7b8b199` (spec commit) or later.

---

## File structure

**Created:**
- `templates/cf-worker/package.json` — declares Readability + linkedom + esbuild, defines the build script.
- `templates/cf-worker/src/worker-with-articles.ts` — TypeScript source for the bundled worker.
- `templates/cf-worker/build.mjs` — esbuild entrypoint.
- `templates/cf-worker/dist/worker-with-articles.bundle.js` — committed build output (binary-ish but text JS).
- `templates/cf-worker/tests/worker-with-articles.test.ts` — vitest suite for `/capabilities` and `/extract-article` against the bundle.
- `app/src/lib/extract-article-via-worker.test.ts` — vitest suite for the new client function.

**Modified:**
- `templates/cf-worker/worker.js` — adds `GET /capabilities`.
- `templates/cf-worker/tests/worker.test.ts` — adds `/capabilities` test.
- `templates/cf-worker/README.md` — documents the bundle, build, and `/extract-article`.
- `templates/cf-worker/.gitignore` — added; excludes node_modules but commits dist/.
- `app/src/lib/proxy-config.ts` — adds `supportsArticles` field with backward-compatible default.
- `app/src/lib/proxy-config.test.ts` — adds round-trip + legacy-config tests.
- `app/src/lib/user-worker-client.ts` — adds `extractArticleViaWorker`, `probeWorkerCapabilities`, and `WorkerNoArticlesError`.
- `app/src/lib/user-worker-client.test.ts` — adds tests for the new exports.
- `app/src/lib/article-hydrator.ts` — adds worker-fallback selection inside the default fetcher.
- `app/src/lib/article-hydrator.test.ts` — adds selection-priority cases.
- `app/src/lib/describe-backend.ts` — `describeArticleBackend` reports the user worker when the helper is absent and `supportsArticles` is true.
- `app/src/lib/describe-backend.test.ts` — adds the new case.
- `app/src/components/CustomProxySetupModal.svelte` — adds tabs in step 3, capability probe on save, status message.

---

## Task 1: cf-worker `GET /capabilities` on `worker.js`

**Files:**
- Modify: `templates/cf-worker/worker.js`
- Modify: `templates/cf-worker/tests/worker.test.ts`

- [ ] **Step 1: Add the failing test**

In `templates/cf-worker/tests/worker.test.ts`, append (before the final closing of the file):

```ts
// ---------------------------------------------------------------------------
// GET /capabilities
// ---------------------------------------------------------------------------
describe('GET /capabilities', () => {
  let worker: UnstableDevWorker;
  beforeAll(async () => {
    worker = await startGoodWorker();
  });
  afterAll(async () => {
    await worker.stop();
  });

  it('returns the endpoint list with /fetch only', async () => {
    const res = await worker.fetch('/capabilities', {
      method: 'GET',
      headers: { Origin: GOOD_ORIGIN, 'X-Proxy-Secret': GOOD_SECRET },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { endpoints: string[] };
    expect(body.endpoints).toEqual(['/fetch']);
  });

  it('returns 403 for a disallowed origin', async () => {
    const res = await worker.fetch('/capabilities', {
      method: 'GET',
      headers: { Origin: 'https://evil.example.com', 'X-Proxy-Secret': GOOD_SECRET },
    });
    expect(res.status).toBe(403);
  });

  it('returns 401 for a wrong secret', async () => {
    const res = await worker.fetch('/capabilities', {
      method: 'GET',
      headers: { Origin: GOOD_ORIGIN, 'X-Proxy-Secret': 'wrong' },
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
pnpm vitest run --config templates/cf-worker/vitest.config.ts -t "GET /capabilities"
```

Expected: 3 failures (the route returns 404).

- [ ] **Step 3: Add the route in `worker.js`**

In `templates/cf-worker/worker.js`, immediately after the OPTIONS-preflight block (the `if (request.method === 'OPTIONS')` return) and before the `// 4. Only POST /fetch is supported` comment, insert:

```js
    // 3b. GET /capabilities — auth-guarded endpoint listing.
    if (request.method === 'GET' && new URL(request.url).pathname === '/capabilities') {
      const secret = request.headers.get('X-Proxy-Secret') ?? '';
      if (secret !== env.SHARED_SECRET) {
        return jsonError('Unauthorized', 401, cors);
      }
      return new Response(
        JSON.stringify({ endpoints: ['/fetch'] }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }
```

- [ ] **Step 4: Run the new test + the full worker suite**

```bash
pnpm vitest run --config templates/cf-worker/vitest.config.ts
```

Expected: all tests pass (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add templates/cf-worker/worker.js templates/cf-worker/tests/worker.test.ts
git commit -m "feat(cf-worker): add GET /capabilities to worker.js"
```

---

## Task 2: cf-worker bundle infrastructure (package.json, esbuild, source)

**Files:**
- Create: `templates/cf-worker/package.json`
- Create: `templates/cf-worker/build.mjs`
- Create: `templates/cf-worker/src/worker-with-articles.ts`
- Create: `templates/cf-worker/.gitignore`

This task only sets up the build pipeline and emits a working bundle. Tests come in Task 3.

- [ ] **Step 1: Create `templates/cf-worker/package.json`**

```json
{
  "name": "bsky-saves-cf-worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build.mjs"
  },
  "dependencies": {
    "@mozilla/readability": "^0.6.0",
    "linkedom": "^0.18.5"
  },
  "devDependencies": {
    "esbuild": "^0.24.0",
    "@cloudflare/workers-types": "^4.20241011.0"
  }
}
```

- [ ] **Step 2: Create `templates/cf-worker/.gitignore`**

```
node_modules/
```

(`dist/` is intentionally NOT ignored — the built bundle is committed.)

- [ ] **Step 3: Create `templates/cf-worker/build.mjs`**

```js
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [resolve(here, 'src/worker-with-articles.ts')],
  outfile: resolve(here, 'dist/worker-with-articles.bundle.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  conditions: ['worker', 'browser'],
  minify: true,
  legalComments: 'none',
  banner: {
    js: '// bsky-saves-gui cf-worker — image proxy + article extraction.\n// Built artifact. Source: templates/cf-worker/src/worker-with-articles.ts\n// Rebuild: cd templates/cf-worker && pnpm install && pnpm build',
  },
});

console.log('built dist/worker-with-articles.bundle.js');
```

- [ ] **Step 4: Create `templates/cf-worker/src/worker-with-articles.ts`**

This file implements `/fetch`, `/capabilities`, and `/extract-article`. The `/fetch` logic mirrors the hand-written `worker.js`. The `/extract-article` logic uses `linkedom` + `@mozilla/readability`.

```ts
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

interface Env {
  ALLOWED_ORIGIN: string;
  SHARED_SECRET: string;
  URL_ALLOWLIST?: string;
}

const FETCH_TIMEOUT_MS = 20_000;
const BODY_SIZE_LIMIT = 10 * 1024 * 1024;
const SHORT_TEXT_THRESHOLD = 200;

function corsHeaders(allowedOrigin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Secret',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonError(message: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

function jsonOk(payload: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

function checkAllowlist(allowlist: string, target: string): boolean {
  const trimmed = allowlist.trim();
  if (trimmed === '') return true;
  const prefixes = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
  return prefixes.some((p) => target.startsWith(p));
}

async function fetchWithLimits(url: string): Promise<{ ok: true; res: Response } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'bsky-saves-gui-proxy/1' },
      redirect: 'follow',
    });
    return { ok: true, res };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return { ok: false, reason: isTimeout ? 'Upstream fetch timed out' : `Upstream fetch failed: ${(err as Error).message}` };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readBodyCapped(res: Response): Promise<{ ok: true; bytes: ArrayBuffer } | { ok: false; reason: string }> {
  const contentLength = res.headers.get('Content-Length');
  if (contentLength !== null && parseInt(contentLength, 10) > BODY_SIZE_LIMIT) {
    return { ok: false, reason: 'Upstream response too large' };
  }
  try {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > BODY_SIZE_LIMIT) {
      return { ok: false, reason: 'Upstream response too large' };
    }
    return { ok: true, bytes: buf };
  } catch (err) {
    return { ok: false, reason: `Failed to read upstream body: ${(err as Error).message}` };
  }
}

function bytesToBase64(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
  return btoa(binary);
}

function bytesToUtf8(buf: ArrayBuffer): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

async function handleFetch(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const secret = request.headers.get('X-Proxy-Secret') ?? '';
  if (secret !== env.SHARED_SECRET) return jsonError('Unauthorized', 401, cors);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Request body must be JSON', 400, cors);
  }
  const targetUrl = (body as { url?: unknown })?.url;
  if (typeof targetUrl !== 'string' || targetUrl.trim() === '') {
    return jsonError('Body must contain a non-empty "url" string', 400, cors);
  }
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return jsonError('Invalid URL', 400, cors);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return jsonError('Only http and https URLs are allowed', 400, cors);
  }
  if (!checkAllowlist(env.URL_ALLOWLIST ?? '', targetUrl)) {
    return jsonError('url not allowed', 400, cors);
  }

  const upstream = await fetchWithLimits(parsed.toString());
  if (!upstream.ok) return jsonError(upstream.reason, 502, cors);

  const read = await readBodyCapped(upstream.res);
  if (!read.ok) return jsonError(read.reason, 502, cors);

  const skipHeaders = new Set([
    'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer',
    'upgrade', 'proxy-authorization', 'proxy-authenticate',
  ]);
  const responseHeaders: Record<string, string> = {};
  upstream.res.headers.forEach((value, key) => {
    if (!skipHeaders.has(key.toLowerCase())) responseHeaders[key] = value;
  });

  return jsonOk(
    { status: upstream.res.status, headers: responseHeaders, body_b64: bytesToBase64(read.bytes) },
    cors,
  );
}

async function handleExtractArticle(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const secret = request.headers.get('X-Proxy-Secret') ?? '';
  if (secret !== env.SHARED_SECRET) return jsonError('Unauthorized', 401, cors);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Request body must be JSON', 400, cors);
  }
  const targetUrl = (body as { url?: unknown })?.url;
  if (typeof targetUrl !== 'string' || targetUrl.trim() === '') {
    return jsonError('Body must contain a non-empty "url" string', 400, cors);
  }
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return jsonError('Invalid URL', 400, cors);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return jsonError('Only http and https URLs are allowed', 400, cors);
  }
  if (!checkAllowlist(env.URL_ALLOWLIST ?? '', targetUrl)) {
    return jsonError('url not allowed', 400, cors);
  }

  const upstream = await fetchWithLimits(parsed.toString());
  if (!upstream.ok) return jsonError(upstream.reason, 502, cors);
  if (upstream.res.status < 200 || upstream.res.status >= 300) {
    return jsonError(`Upstream returned ${upstream.res.status}`, 502, cors);
  }

  const read = await readBodyCapped(upstream.res);
  if (!read.ok) return jsonError(read.reason, 502, cors);

  const html = bytesToUtf8(read.bytes);
  const { document } = parseHTML(html);
  // @ts-expect-error linkedom's Document is structurally compatible with Readability's expectations.
  const parsedArticle = new Readability(document).parse();
  const fetchedAt = new Date().toISOString();

  if (!parsedArticle) {
    return jsonOk(
      { url: parsed.toString(), title: '', text: '', fetched_at: fetchedAt, note: 'could not extract main content' },
      cors,
    );
  }

  const title = (parsedArticle.title ?? '').trim();
  const text = (parsedArticle.textContent ?? '').trim();
  const note = text.length < SHORT_TEXT_THRESHOLD ? 'extracted body looked short' : undefined;

  const payload: Record<string, unknown> = {
    url: parsed.toString(),
    title,
    text,
    fetched_at: fetchedAt,
  };
  if (note !== undefined) payload.note = note;

  return jsonOk(payload, cors);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.ALLOWED_ORIGIN || env.ALLOWED_ORIGIN.trim() === '') {
      return jsonError('Worker misconfigured: ALLOWED_ORIGIN is not set', 500);
    }
    if (!env.SHARED_SECRET || env.SHARED_SECRET.trim() === '') {
      return jsonError('Worker misconfigured: SHARED_SECRET is not set', 500);
    }
    const allowedOrigin = env.ALLOWED_ORIGIN.trim();
    const requestOrigin = request.headers.get('Origin') ?? '';
    if (requestOrigin !== allowedOrigin) return jsonError('Origin not allowed', 403);
    const cors = corsHeaders(allowedOrigin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/capabilities') {
      const secret = request.headers.get('X-Proxy-Secret') ?? '';
      if (secret !== env.SHARED_SECRET) return jsonError('Unauthorized', 401, cors);
      return jsonOk({ endpoints: ['/fetch', '/extract-article'] }, cors);
    }
    if (request.method === 'POST' && url.pathname === '/fetch') {
      return handleFetch(request, env, cors);
    }
    if (request.method === 'POST' && url.pathname === '/extract-article') {
      return handleExtractArticle(request, env, cors);
    }

    return new Response('Not found', { status: 404, headers: cors });
  },
};
```

- [ ] **Step 5: Install deps and build the bundle**

```bash
cd templates/cf-worker && pnpm install && pnpm build && cd ../..
```

Expected: `templates/cf-worker/dist/worker-with-articles.bundle.js` exists, file size ≈ 200–500 KB. The script prints `built dist/worker-with-articles.bundle.js`.

- [ ] **Step 6: Sanity-check the bundle imports work**

```bash
node -e "import('./templates/cf-worker/dist/worker-with-articles.bundle.js').then(m => console.log('default export keys:', Object.keys(m.default)))"
```

Expected output: `default export keys: [ 'fetch' ]`.

- [ ] **Step 7: Commit**

```bash
git add templates/cf-worker/package.json templates/cf-worker/.gitignore templates/cf-worker/build.mjs templates/cf-worker/src/worker-with-articles.ts templates/cf-worker/dist/worker-with-articles.bundle.js
git commit -m "feat(cf-worker): bundle build with article-extraction endpoint"
```

DO NOT commit `templates/cf-worker/node_modules/`.

---

## Task 3: cf-worker tests for the bundled artifact

**Files:**
- Create: `templates/cf-worker/tests/worker-with-articles.test.ts`

These tests run against the committed `dist/worker-with-articles.bundle.js`. They cover `/capabilities`, `/extract-article` happy path, soft-fails, and that the auth/origin checks still gate the new endpoint.

- [ ] **Step 1: Create the test file**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev } from 'wrangler';
import type { UnstableDevWorker } from 'wrangler';

const WORKER_SCRIPT = 'templates/cf-worker/dist/worker-with-articles.bundle.js';
const GOOD_ORIGIN = 'https://saves.example.com';
const GOOD_SECRET = 'test-secret-abc123';
const EXPERIMENTAL = { disableExperimentalWarning: true };

async function startWorker(): Promise<UnstableDevWorker> {
  return unstable_dev(WORKER_SCRIPT, {
    vars: { ALLOWED_ORIGIN: GOOD_ORIGIN, SHARED_SECRET: GOOD_SECRET },
    experimental: EXPERIMENTAL,
  });
}

describe('worker-with-articles bundle', () => {
  let worker: UnstableDevWorker;
  beforeAll(async () => {
    worker = await startWorker();
  });
  afterAll(async () => {
    await worker.stop();
  });

  it('GET /capabilities lists both endpoints', async () => {
    const res = await worker.fetch('/capabilities', {
      method: 'GET',
      headers: { Origin: GOOD_ORIGIN, 'X-Proxy-Secret': GOOD_SECRET },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { endpoints: string[] };
    expect(body.endpoints).toEqual(['/fetch', '/extract-article']);
  });

  it('GET /capabilities rejects wrong secret', async () => {
    const res = await worker.fetch('/capabilities', {
      method: 'GET',
      headers: { Origin: GOOD_ORIGIN, 'X-Proxy-Secret': 'nope' },
    });
    expect(res.status).toBe(401);
  });

  it('POST /extract-article rejects wrong origin', async () => {
    const res = await worker.fetch('/extract-article', {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com', 'X-Proxy-Secret': GOOD_SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    expect(res.status).toBe(403);
  });

  it('POST /extract-article rejects missing url', async () => {
    const res = await worker.fetch('/extract-article', {
      method: 'POST',
      headers: { Origin: GOOD_ORIGIN, 'X-Proxy-Secret': GOOD_SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST /extract-article rejects javascript: scheme', async () => {
    const res = await worker.fetch('/extract-article', {
      method: 'POST',
      headers: { Origin: GOOD_ORIGIN, 'X-Proxy-Secret': GOOD_SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'javascript:alert(1)' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /extract-article happy path returns parsed article shape', { timeout: 30_000 }, async () => {
    // Use example.com — small, stable, real article text via Readability is unlikely
    // (it's a very short page), so we expect note: "extracted body looked short" or similar.
    // The point of this test is the shape of the response, not the exact content.
    const res = await worker.fetch('/extract-article', {
      method: 'POST',
      headers: { Origin: GOOD_ORIGIN, 'X-Proxy-Secret': GOOD_SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/' }),
    });
    expect([200, 502]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.json() as {
        url: string; title: string; text: string; fetched_at: string; note?: string;
      };
      expect(body.url).toBe('https://example.com/');
      expect(typeof body.title).toBe('string');
      expect(typeof body.text).toBe('string');
      expect(typeof body.fetched_at).toBe('string');
      // example.com is short — expect a note.
      expect(body.note).toBeTypeOf('string');
    }
  });
});

describe('worker-with-articles URL_ALLOWLIST applies to /extract-article', () => {
  let worker: UnstableDevWorker;
  beforeAll(async () => {
    worker = await unstable_dev(WORKER_SCRIPT, {
      vars: {
        ALLOWED_ORIGIN: GOOD_ORIGIN,
        SHARED_SECRET: GOOD_SECRET,
        URL_ALLOWLIST: 'https://allowed.example.com/',
      },
      experimental: EXPERIMENTAL,
    });
  });
  afterAll(async () => {
    await worker.stop();
  });

  it('rejects URLs not on the allowlist', async () => {
    const res = await worker.fetch('/extract-article', {
      method: 'POST',
      headers: { Origin: GOOD_ORIGIN, 'X-Proxy-Secret': GOOD_SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://blocked.example.com/post' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/not allowed/i);
  });
});
```

- [ ] **Step 2: Run the new tests**

```bash
pnpm vitest run --config templates/cf-worker/vitest.config.ts
```

Expected: all tests pass — both existing `worker.test.ts` and new `worker-with-articles.test.ts`.

- [ ] **Step 3: Commit**

```bash
git add templates/cf-worker/tests/worker-with-articles.test.ts
git commit -m "test(cf-worker): cover /capabilities and /extract-article on bundled worker"
```

---

## Task 4: Proxy-config schema with `supportsArticles`

**Files:**
- Modify: `app/src/lib/proxy-config.ts`
- Modify: `app/src/lib/proxy-config.test.ts`

- [ ] **Step 1: Add the failing tests**

In `app/src/lib/proxy-config.test.ts`, append at the bottom of the existing `describe`:

```ts
  it('round-trips supportsArticles', async () => {
    await saveProxyConfig({ url: 'https://w.example/', sharedSecret: 's', supportsArticles: true });
    const loaded = await loadProxyConfig();
    expect(loaded).toEqual({ url: 'https://w.example/', sharedSecret: 's', supportsArticles: true });
  });

  it('defaults supportsArticles to false for legacy stored configs', async () => {
    // Simulate a config saved before the field existed.
    const { set } = await import('idb-keyval');
    await set('proxy-config:v1', { url: 'https://w.example/', sharedSecret: 's' });
    const loaded = await loadProxyConfig();
    expect(loaded).toEqual({ url: 'https://w.example/', sharedSecret: 's', supportsArticles: false });
  });
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm vitest run app/src/lib/proxy-config.test.ts
```

Expected: 2 failures (type error + assertion mismatch).

- [ ] **Step 3: Update `app/src/lib/proxy-config.ts`**

Replace the file with:

```ts
import { get, set, del } from 'idb-keyval';

const KEY = 'proxy-config:v1';

export interface ProxyConfig {
  readonly url: string;
  readonly sharedSecret: string;
  readonly supportsArticles: boolean;
}

export async function saveProxyConfig(config: ProxyConfig): Promise<void> {
  await set(KEY, config);
}

export async function loadProxyConfig(): Promise<ProxyConfig | null> {
  const v = (await get(KEY)) as Partial<ProxyConfig> | undefined;
  if (!v || typeof v.url !== 'string' || typeof v.sharedSecret !== 'string') return null;
  return {
    url: v.url,
    sharedSecret: v.sharedSecret,
    supportsArticles: v.supportsArticles === true,
  };
}

export async function clearProxyConfig(): Promise<void> {
  await del(KEY);
}
```

- [ ] **Step 4: Fix call sites that construct a `ProxyConfig` literal**

Run:

```bash
grep -rn "saveProxyConfig" app/src
```

Expected hits: `app/src/components/CustomProxySetupModal.svelte`. Update its `handleSaveWorker` to include `supportsArticles: false` when calling `saveProxyConfig` (the modal's capability probe in Task 6 will overwrite this value):

```svelte
    await saveProxyConfig({ url: workerUrl, sharedSecret: workerSecret, supportsArticles: false });
```

- [ ] **Step 5: Run check + tests**

```bash
pnpm check && pnpm vitest run app/src/lib/proxy-config.test.ts
```

Expected: 0 errors, 0 warnings; all proxy-config tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/proxy-config.ts app/src/lib/proxy-config.test.ts app/src/components/CustomProxySetupModal.svelte
git commit -m "feat(proxy-config): add supportsArticles with backward-compatible default"
```

---

## Task 5: `extractArticleViaWorker`, `probeWorkerCapabilities`, `WorkerNoArticlesError`

**Files:**
- Modify: `app/src/lib/user-worker-client.ts`
- Modify: `app/src/lib/user-worker-client.test.ts`

- [ ] **Step 1: Add the failing tests**

In `app/src/lib/user-worker-client.test.ts`, append:

```ts
import { extractArticleViaWorker, probeWorkerCapabilities, WorkerNoArticlesError } from './user-worker-client';

describe('extractArticleViaWorker', () => {
  const cfg = { url: 'https://w.example/', sharedSecret: 's', supportsArticles: true };

  it('returns the parsed article on 200', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      url: 'https://a.example/post', title: 'T', text: 'body', fetched_at: '2026-05-05T00:00:00Z',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const out = await extractArticleViaWorker(cfg, 'https://a.example/post');
      expect(out.title).toBe('T');
      expect(out.text).toBe('body');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://w.example/extract-article',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-Proxy-Secret': 's' }),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws WorkerNoArticlesError on 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    try {
      await expect(extractArticleViaWorker(cfg, 'https://a.example/p')).rejects.toBeInstanceOf(WorkerNoArticlesError);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws Error with reason on 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'upstream timeout' }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    })));
    try {
      await expect(extractArticleViaWorker(cfg, 'https://a.example/p')).rejects.toThrow(/upstream timeout/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws on malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ wrong: 'shape' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));
    try {
      await expect(extractArticleViaWorker(cfg, 'https://a.example/p')).rejects.toThrow(/malformed/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('probeWorkerCapabilities', () => {
  it('returns true when /extract-article is in the endpoints list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ endpoints: ['/fetch', '/extract-article'] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));
    try {
      expect(await probeWorkerCapabilities('https://w.example/', 's')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns false when only /fetch is listed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ endpoints: ['/fetch'] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));
    try {
      expect(await probeWorkerCapabilities('https://w.example/', 's')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns false when probe returns 404 (old worker, no /capabilities)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    try {
      expect(await probeWorkerCapabilities('https://w.example/', 's')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns false when probe network call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    try {
      expect(await probeWorkerCapabilities('https://w.example/', 's')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
```

(If `vi` is not yet imported in this file, add `import { vi } from 'vitest';` at the top alongside existing imports.)

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm vitest run app/src/lib/user-worker-client.test.ts
```

Expected: failures at import (`extractArticleViaWorker` not exported) and assertions.

- [ ] **Step 3: Update `app/src/lib/user-worker-client.ts`**

Append to the existing file (after `fetchImageViaUserWorker`):

```ts
export class WorkerNoArticlesError extends Error {
  constructor() {
    super('worker does not support /extract-article');
    this.name = 'WorkerNoArticlesError';
  }
}

interface ExtractArticleResponse {
  readonly url: string;
  readonly title: string;
  readonly text: string;
  readonly fetched_at: string;
  readonly note?: string;
}

function isExtractArticleResponse(v: unknown): v is ExtractArticleResponse {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.url === 'string' &&
    typeof r.title === 'string' &&
    typeof r.text === 'string' &&
    typeof r.fetched_at === 'string' &&
    (r.note === undefined || typeof r.note === 'string')
  );
}

/**
 * Call the user worker's POST /extract-article endpoint.
 *
 * Throws:
 *   - WorkerNoArticlesError on 404 (old worker without article support)
 *   - Error("worker reported …") with the worker's error message on other non-2xx
 *   - Error("malformed JSON") when the response shape is wrong
 */
export async function extractArticleViaWorker(
  config: ProxyConfig,
  articleUrl: string,
): Promise<ExtractArticleResponse> {
  const base = config.url.replace(/\/+$/, '');
  const res = await fetch(`${base}/extract-article`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Proxy-Secret': config.sharedSecret,
    },
    body: JSON.stringify({ url: articleUrl }),
  });
  if (res.status === 404) {
    throw new WorkerNoArticlesError();
  }
  if (!res.ok) {
    let reason = `user worker returned ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === 'string') reason = body.error;
    } catch {
      // keep default reason
    }
    throw new Error(reason);
  }
  const body = (await res.json()) as unknown;
  if (!isExtractArticleResponse(body)) {
    throw new Error('user worker /extract-article returned malformed JSON');
  }
  return body;
}

/**
 * Probe the worker's GET /capabilities endpoint.
 * Returns true if the response lists "/extract-article". Returns false on
 * any failure (404, non-2xx, malformed body, network error) — the caller
 * conservatively treats anything ambiguous as "image-only worker".
 */
export async function probeWorkerCapabilities(
  url: string,
  sharedSecret: string,
): Promise<boolean> {
  const base = url.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/capabilities`, {
      method: 'GET',
      headers: { 'X-Proxy-Secret': sharedSecret },
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { endpoints?: unknown };
    if (!Array.isArray(body.endpoints)) return false;
    return body.endpoints.includes('/extract-article');
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests + check**

```bash
pnpm check && pnpm vitest run app/src/lib/user-worker-client.test.ts
```

Expected: 0 errors / 0 warnings; all user-worker-client tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/user-worker-client.ts app/src/lib/user-worker-client.test.ts
git commit -m "feat(user-worker-client): add extractArticleViaWorker + probeWorkerCapabilities"
```

---

## Task 6: Modal capability probe + tabs in step 3

**Files:**
- Modify: `app/src/components/CustomProxySetupModal.svelte`

This task does both: the probe-on-save (drives `supportsArticles` + status message) and the step-3 tabs (drives which source the user copies).

- [ ] **Step 1: Update the script section**

In `app/src/components/CustomProxySetupModal.svelte`, replace the existing imports + script logic with the following augmented version. Specifically:

1. Import the bundled artifact via `?raw`:

```svelte
  import workerSourceImageOnly from '../../../templates/cf-worker/worker.js?raw';
  import workerSourceWithArticles from '../../../templates/cf-worker/dist/worker-with-articles.bundle.js?raw';
```

(Remove the existing single `workerSource` import.)

2. Import the new probe function:

```svelte
  import { probeWorkerCapabilities } from '$lib/user-worker-client';
```

3. Add tab + status state:

```svelte
  type Tab = 'image' | 'articles';
  let activeTab: Tab = 'image';
  $: workerSource = activeTab === 'image' ? workerSourceImageOnly : workerSourceWithArticles;
  $: workerCopyLabel = activeTab === 'image' ? 'Copy worker source' : 'Copy bundled worker';
  $: workerHint = activeTab === 'image'
    ? 'Image-only proxy. ~200 lines of readable source.'
    : 'Image proxy + article extraction. Pre-built bundle (minified). Source: templates/cf-worker/src/worker-with-articles.ts in the repo.';
```

4. Replace `handleSaveWorker` so it (a) saves with `supportsArticles: false`, (b) probes capabilities, (c) updates the saved config + `saveStatus` accordingly, (d) dispatches `change`:

```svelte
  async function handleSaveWorker() {
    if (!workerUrl || !workerSecret) {
      saveStatus = 'Both URL and shared secret are required.';
      return;
    }
    await saveProxyConfig({ url: workerUrl, sharedSecret: workerSecret, supportsArticles: false });
    saveStatus = 'Saved. Probing capabilities…';
    const supports = await probeWorkerCapabilities(workerUrl, workerSecret);
    await saveProxyConfig({ url: workerUrl, sharedSecret: workerSecret, supportsArticles: supports });
    saveStatus = supports
      ? '✓ Saved. Article extraction is enabled on this worker.'
      : '⚠ Saved. This worker is image-only — paste the article-enabled bundle in step 3 to enable article backup.';
    dispatch('change');
  }
```

5. Update `handleClearWorker` (no functional change other than ensuring `saveStatus` resets):

(Leave existing logic; just ensure it dispatches `change`, which it already does.)

- [ ] **Step 2: Update the template (step 3) and step-1 status text**

Replace the step 3 list item with:

```svelte
        <li>
          <strong>Paste the worker source.</strong>
          On the worker page click <em>Edit code</em>. Paste the source below
          over the placeholder. Click <em>Deploy</em>.
          <div class="modal__tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'image'}
              class="modal__tab"
              class:modal__tab--active={activeTab === 'image'}
              on:click={() => (activeTab = 'image')}
            >Image only</button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'articles'}
              class="modal__tab"
              class:modal__tab--active={activeTab === 'articles'}
              on:click={() => (activeTab = 'articles')}
            >Image + article extraction</button>
          </div>
          <p class="modal__tab-hint">{workerHint}</p>
          <div class="modal__codeblock modal__codeblock--scroll">
            <pre>{workerSource}</pre>
            <CopyButton text={workerSource} label={workerCopyLabel} />
          </div>
        </li>
```

- [ ] **Step 3: Add CSS for the tabs**

Inside the `<style>` block, add:

```css
  .modal__tabs {
    display: flex;
    gap: 0.25rem;
    margin: 0.5rem 0 0.25rem;
    border-bottom: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
  }
  .modal__tab {
    font: inherit;
    padding: 0.35rem 0.75rem;
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    color: inherit;
    cursor: pointer;
    opacity: 0.7;
  }
  .modal__tab:hover { opacity: 1; }
  .modal__tab--active {
    opacity: 1;
    font-weight: 600;
    border-bottom-color: CanvasText;
  }
  .modal__tab-hint {
    margin: 0.25rem 0 0;
    font-size: 0.8rem;
    opacity: 0.75;
  }
```

- [ ] **Step 4: Run check + build + manual visual test**

```bash
pnpm check && pnpm build
```

Expected: 0 errors, 0 warnings; build succeeds.

Then start the dev server in the background and verify in a browser:

```bash
pnpm dev &
```

- Open Settings → Backup → Advanced → Setup guide.
- Confirm tabs exist at step 3, default is "Image only", clicking "Image + article extraction" swaps the `<pre>` content (visibly larger, minified) and the copy button's label.
- Paste a fake URL+secret and click Save. Confirm the status text reads "Saved. Probing capabilities…" briefly and then the warn-style "⚠ Saved. This worker is image-only…" (probe will fail because the URL is fake).
- Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/CustomProxySetupModal.svelte
git commit -m "feat(setup-modal): tabs in step 3; capability probe on save"
```

---

## Task 7: `describeArticleBackend` reports the user worker

**Files:**
- Modify: `app/src/lib/describe-backend.ts`
- Modify: `app/src/lib/describe-backend.test.ts`

- [ ] **Step 1: Read the existing module to understand its shape**

Run `cat app/src/lib/describe-backend.ts`. The function `describeArticleBackend` currently checks the helper only and returns `{ available, description }`.

- [ ] **Step 2: Add the failing test**

In `app/src/lib/describe-backend.test.ts`, append a new case:

```ts
  it('reports the user worker for articles when helper is absent and supportsArticles is true', async () => {
    // Arrange: helper returns 404; proxy config supports articles.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      const u = typeof input === 'string' ? input : (input as Request).url;
      if (u.includes('/ping')) return new Response('nope', { status: 404 });
      throw new Error(`unexpected fetch ${u}`);
    }));
    const { saveProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://w.example/', sharedSecret: 's', supportsArticles: true });
    try {
      const result = await describeArticleBackend();
      expect(result.available).toBe(true);
      expect(result.description).toMatch(/custom Cloudflare Worker/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports unavailable when helper is absent and worker is image-only', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    const { saveProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://w.example/', sharedSecret: 's', supportsArticles: false });
    try {
      const result = await describeArticleBackend();
      expect(result.available).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
```

If `vi` is not imported, add `import { vi } from 'vitest';`.

- [ ] **Step 3: Run tests to confirm they fail**

```bash
pnpm vitest run app/src/lib/describe-backend.test.ts
```

Expected: 2 failures.

- [ ] **Step 4: Update `describeArticleBackend`**

In `app/src/lib/describe-backend.ts`, in the body of `describeArticleBackend`, after the existing helper check, add a worker check:

```ts
  // Existing: try helper. If reachable, return { available: true, description: 'the local helper' }.
  // (Keep that logic untouched.)

  // NEW: helper absent — fall back to user worker if it supports articles.
  const proxy = await loadProxyConfig();
  if (proxy && proxy.supportsArticles) {
    return { available: true, description: 'your custom Cloudflare Worker' };
  }

  return { available: false, description: 'the local helper is not running' };
```

Add `import { loadProxyConfig } from './proxy-config';` at the top of the file.

- [ ] **Step 5: Run tests + check**

```bash
pnpm check && pnpm vitest run app/src/lib/describe-backend.test.ts
```

Expected: 0 errors, 0 warnings; all describe-backend tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/describe-backend.ts app/src/lib/describe-backend.test.ts
git commit -m "feat(describe-backend): articles via user worker when helper absent"
```

---

## Task 8: article-hydrator backend selection

**Files:**
- Modify: `app/src/lib/article-hydrator.ts`
- Modify: `app/src/lib/article-hydrator.test.ts`

The default fetcher in `hydrateArticles` currently always calls the helper. Change it to: helper if reachable on first call, else worker (when `supportsArticles`), else fail per-URL with a clear note. On `WorkerNoArticlesError` at runtime, flip the stored flag and continue failing remaining articles fast with the same note.

- [ ] **Step 1: Add the failing tests**

In `app/src/lib/article-hydrator.test.ts`, append:

```ts
  it('uses worker fetcher when helper is absent and worker supportsArticles', async () => {
    // The hydrator is given an inventory with one article URL.
    // We do NOT pass a custom fetcher, so the default backend-selection logic runs.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      const u = typeof input === 'string' ? input : (input as Request).url;
      if (u.endsWith('/ping')) return new Response('nope', { status: 404 });
      if (u.endsWith('/extract-article')) {
        return new Response(JSON.stringify({
          url: 'https://a.example/p', title: 'T', text: 'body', fetched_at: '2026-05-05T00:00:00Z',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`unexpected fetch ${u}`);
    }));
    const { saveProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://w.example/', sharedSecret: 's', supportsArticles: true });
    const inv = { saves: [{ embed: { url: 'https://a.example/p' } }] };
    try {
      const r = await hydrateArticles(inv);
      expect(r.fetched).toBe(1);
      expect(r.failed).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('flips supportsArticles to false on runtime 404 from worker', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      const u = typeof input === 'string' ? input : (input as Request).url;
      if (u.endsWith('/ping')) return new Response('nope', { status: 404 });
      if (u.endsWith('/extract-article')) return new Response('not found', { status: 404 });
      throw new Error(`unexpected fetch ${u}`);
    }));
    const { saveProxyConfig, loadProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://w.example/', sharedSecret: 's', supportsArticles: true });
    const inv = { saves: [{ embed: { url: 'https://a.example/p' } }, { embed: { url: 'https://a.example/q' } }] };
    try {
      const r = await hydrateArticles(inv);
      expect(r.failed).toBe(2);
      const updated = await loadProxyConfig();
      expect(updated?.supportsArticles).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails with a clear note when neither helper nor worker is available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    const { clearProxyConfig } = await import('./proxy-config');
    await clearProxyConfig();
    const inv = { saves: [{ embed: { url: 'https://a.example/p' } }] };
    try {
      const r = await hydrateArticles(inv);
      expect(r.failed).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
```

If `vi` is not imported, add the import.

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm vitest run app/src/lib/article-hydrator.test.ts
```

Expected: 3 failures.

- [ ] **Step 3: Update `article-hydrator.ts`**

Replace the construction of the default fetcher with a backend-selecting fetcher. Change:

```ts
  const fetcher =
    options.fetcher ?? ((url: string) => extractArticleViaHelper(config.helperOrigin, url));
```

to:

```ts
  const fetcher = options.fetcher ?? makeDefaultFetcher();
```

And add a helper at the top of the file:

```ts
import { loadProxyConfig, saveProxyConfig } from './proxy-config';
import { extractArticleViaWorker, WorkerNoArticlesError } from './user-worker-client';
import { pingHelper } from './helper-client';

function makeDefaultFetcher(): (url: string) => Promise<ExtractedArticle> {
  // Cache the backend choice for the duration of the run. Probe lazily on first
  // call so unit tests that don't actually fetch still see the right shape.
  let resolved: 'helper' | 'worker' | 'none' | undefined;
  let proxy: { url: string; sharedSecret: string; supportsArticles: boolean } | null = null;

  async function resolveBackend() {
    if (resolved !== undefined) return;
    if (await pingHelper(config.helperOrigin)) {
      resolved = 'helper';
      return;
    }
    proxy = await loadProxyConfig();
    if (proxy && proxy.supportsArticles) {
      resolved = 'worker';
      return;
    }
    resolved = 'none';
  }

  return async (url: string) => {
    await resolveBackend();
    if (resolved === 'helper') {
      return extractArticleViaHelper(config.helperOrigin, url);
    }
    if (resolved === 'worker' && proxy) {
      try {
        return await extractArticleViaWorker(proxy, url);
      } catch (err) {
        if (err instanceof WorkerNoArticlesError) {
          // Worker was downgraded since the last capability probe. Persist the
          // new state and fall through to "no backend".
          await saveProxyConfig({ ...proxy, supportsArticles: false });
          resolved = 'none';
          throw new Error('worker no longer supports articles — redeploy with the article-enabled bundle');
        }
        throw err;
      }
    }
    throw new Error('no article backend available — start the local helper or enable article extraction on your custom worker');
  };
}
```

You also need a `pingHelper` helper. Check if it exists in `helper-client.ts` (`grep -n "pingHelper\|/ping" app/src/lib/helper-client.ts`). If it doesn't, add this minimal version to `helper-client.ts`:

```ts
export async function pingHelper(origin: string): Promise<boolean> {
  const base = origin.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/ping`);
    return res.ok;
  } catch {
    return false;
  }
}
```

(If a similar function exists under another name, use the existing one instead and update the import.)

- [ ] **Step 4: Run all tests + check**

```bash
pnpm check && pnpm test
```

Expected: 0 errors, 0 warnings; all tests pass (including the 3 new article-hydrator cases).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/article-hydrator.ts app/src/lib/article-hydrator.test.ts app/src/lib/helper-client.ts
git commit -m "feat(article-hydrator): fall back to user worker; flip flag on runtime 404"
```

---

## Task 9: README updates for the cf-worker

**Files:**
- Modify: `templates/cf-worker/README.md`

- [ ] **Step 1: Read the existing README**

Run `cat templates/cf-worker/README.md` to see its current shape.

- [ ] **Step 2: Add a new section after the existing deploy instructions**

Append the following to `templates/cf-worker/README.md`:

```markdown
## Article extraction (optional)

Two worker variants ship in this directory:

- `worker.js` — image proxy only. Hand-written, ~200 lines, easy to audit.
- `dist/worker-with-articles.bundle.js` — image proxy + article extraction
  (`POST /extract-article`, Mozilla Readability + linkedom). Pre-built ESM bundle.

Source for the bundled variant lives at `src/worker-with-articles.ts`.

### Build the bundle

```bash
cd templates/cf-worker
pnpm install
pnpm build
```

This regenerates `dist/worker-with-articles.bundle.js`. The bundle is committed
to the repo so users who copy-paste from the in-app Setup Guide can use it
without running a build.

### Endpoints

Both variants:
- `OPTIONS /fetch` — CORS preflight.
- `POST /fetch` — image/raw-bytes proxy. Body: `{ "url": "https://..." }`.
- `GET /capabilities` — returns `{ "endpoints": [...] }` for runtime detection.

`worker-with-articles.bundle.js` only:
- `POST /extract-article` — body `{ "url": "https://..." }`, returns
  `{ url, title, text, fetched_at, note? }` matching the local helper's shape.

### Notes
- Cloudflare Workers' free plan limits CPU per request; large pages with heavy
  Readability work may need the Standard usage model.
- The `URL_ALLOWLIST` env var (if set) applies to both `/fetch` and
  `/extract-article`.
```

- [ ] **Step 3: Commit**

```bash
git add templates/cf-worker/README.md
git commit -m "docs(cf-worker): document /capabilities, /extract-article, and the bundle build"
```

---

## Final verification

- [ ] **Step 1: Run the full test matrix + build**

```bash
pnpm check && pnpm test && pnpm build && pnpm vitest run --config templates/cf-worker/vitest.config.ts
```

Expected: 0 errors, 0 warnings, all tests pass on both vitest configs, both bundles build.

- [ ] **Step 2: Manual smoke test**

```bash
pnpm dev &
```

- Open Settings → Backup → Advanced → Setup guide.
- Switch tabs in step 3; confirm the source and copy-button text both swap.
- Save a fake worker URL+secret; confirm the warn-style status text appears.
- Stop the dev server.

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

## What's next

Plan 22 closes the helper-only gap for article hydration. Remaining candidates:

- **Plan 18+**: Clarify the article "Set up backup" / "Set up article backup" buttons.
- **Plan 19**: Show Details modal for backup failures (per-failure list + reasons).
- **Plan 20**: Banner sequencing (image first, article waits).
- **Plan 21**: PostFocus per-post backup status footer.

## Self-Review Checklist

- Two artifacts shipped: `worker.js` (image-only + `/capabilities`) and `dist/worker-with-articles.bundle.js` (full).
- `GET /capabilities` works on both, auth-gated like `/fetch`, returns `{endpoints}` with the right list.
- `POST /extract-article` returns helper-compatible JSON with soft-fail `note` cases.
- `URL_ALLOWLIST` applied to `/extract-article`.
- `ProxyConfig` gained `supportsArticles` with backward-compat default.
- `extractArticleViaWorker`, `probeWorkerCapabilities`, `WorkerNoArticlesError` exported from `user-worker-client.ts` and tested.
- Setup modal step 3 has tabs + dynamic source + dynamic copy label.
- Save flow probes capabilities, persists `supportsArticles`, surfaces a clear status string.
- `describeArticleBackend` reports the worker when helper is absent + `supportsArticles` is true.
- Article hydrator picks helper → worker → fail with clear note; flips flag on runtime 404 and persists.
- README explains build, endpoints, and Cloudflare CPU caveat.
- Bundle is committed to the repo (not gitignored).
- All existing tests still pass.

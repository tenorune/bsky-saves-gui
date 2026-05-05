# Plan 24: probe diagnostics + setup-guide example text

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Make the capability probe distinguish failure modes (image-only vs unauthorized vs origin-blocked vs missing endpoint vs unreachable) and surface specific guidance in the setup modal. Also fix the modal's step-5 example response text to match what the worker actually returns.

**Architecture:** Change `probeWorkerCapabilities` to return a discriminated union instead of a boolean. Update `CustomProxySetupModal.handleSaveWorker` to map each kind to a tailored status message. Persist `supportsArticles: true` only when the probe returns `has-articles`.

**Tech Stack:** Svelte 4, TypeScript 5, Vitest. No new dependencies.

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `c898d18` or later.

---

## File structure

**Modified:**
- `app/src/lib/user-worker-client.ts` — `probeWorkerCapabilities` returns a discriminated union.
- `app/src/lib/user-worker-client.test.ts` — tests cover each kind.
- `app/src/components/CustomProxySetupModal.svelte` — `handleSaveWorker` maps the result; step-5 example text fixed.

---

## Task 1: Probe returns a discriminated union

**Files:**
- Modify: `app/src/lib/user-worker-client.ts`
- Modify: `app/src/lib/user-worker-client.test.ts`

- [ ] **Step 1: Update the failing tests**

Open `app/src/lib/user-worker-client.test.ts`. Find the existing `describe('probeWorkerCapabilities', ...)` block. Replace its four tests with the following set, which assert on the new union shape:

```ts
describe('probeWorkerCapabilities', () => {
  it('returns has-articles when /extract-article is in endpoints', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ endpoints: ['/fetch', '/extract-article'] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));
    try {
      expect(await probeWorkerCapabilities('https://w.example/', 's')).toEqual({ kind: 'has-articles' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns image-only when only /fetch is listed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ endpoints: ['/fetch'] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));
    try {
      expect(await probeWorkerCapabilities('https://w.example/', 's')).toEqual({ kind: 'image-only' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns unauthorized on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
    try {
      expect(await probeWorkerCapabilities('https://w.example/', 's')).toEqual({ kind: 'unauthorized' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns origin-blocked on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })));
    try {
      expect(await probeWorkerCapabilities('https://w.example/', 's')).toEqual({ kind: 'origin-blocked' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns no-capabilities-endpoint on 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    try {
      expect(await probeWorkerCapabilities('https://w.example/', 's')).toEqual({ kind: 'no-capabilities-endpoint' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns unreachable on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    try {
      const r = await probeWorkerCapabilities('https://w.example/', 's');
      expect(r.kind).toBe('unreachable');
      if (r.kind === 'unreachable') expect(r.reason).toMatch(/network down/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns unreachable on 5xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 502 })));
    try {
      const r = await probeWorkerCapabilities('https://w.example/', 's');
      expect(r.kind).toBe('unreachable');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns image-only when 200 OK but body is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ wrong: 'shape' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));
    try {
      expect(await probeWorkerCapabilities('https://w.example/', 's')).toEqual({ kind: 'image-only' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run app/src/lib/user-worker-client.test.ts
```

Expected: all the new probeWorkerCapabilities tests fail because the function still returns a boolean.

- [ ] **Step 3: Update `probeWorkerCapabilities` in `app/src/lib/user-worker-client.ts`**

Find:

```ts
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

Replace with:

```ts
/**
 * Result of probing a user worker's GET /capabilities endpoint. The caller
 * uses the kind to surface specific guidance:
 *   - has-articles: the worker advertises POST /extract-article.
 *   - image-only: the worker is reachable but only advertises /fetch.
 *   - unauthorized: 401 — wrong shared secret.
 *   - origin-blocked: 403 — ALLOWED_ORIGIN doesn't match the GUI's origin.
 *   - no-capabilities-endpoint: 404 — old worker (predates GET /capabilities).
 *   - unreachable: network error, CORS preflight failure, 5xx, etc.
 */
export type ProbeResult =
  | { kind: 'has-articles' }
  | { kind: 'image-only' }
  | { kind: 'unauthorized' }
  | { kind: 'origin-blocked' }
  | { kind: 'no-capabilities-endpoint' }
  | { kind: 'unreachable'; reason: string };

/**
 * Probe the worker's GET /capabilities endpoint.
 *
 * Never throws — every failure mode is reported via the `kind` discriminator.
 */
export async function probeWorkerCapabilities(
  url: string,
  sharedSecret: string,
): Promise<ProbeResult> {
  const base = url.replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}/capabilities`, {
      method: 'GET',
      headers: { 'X-Proxy-Secret': sharedSecret },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { kind: 'unreachable', reason };
  }
  if (res.status === 401) return { kind: 'unauthorized' };
  if (res.status === 403) return { kind: 'origin-blocked' };
  if (res.status === 404) return { kind: 'no-capabilities-endpoint' };
  if (!res.ok) {
    return { kind: 'unreachable', reason: `HTTP ${res.status}` };
  }
  let body: { endpoints?: unknown };
  try {
    body = (await res.json()) as { endpoints?: unknown };
  } catch {
    return { kind: 'image-only' };
  }
  if (!Array.isArray(body.endpoints)) return { kind: 'image-only' };
  if (body.endpoints.includes('/extract-article')) return { kind: 'has-articles' };
  return { kind: 'image-only' };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm check && pnpm vitest run app/src/lib/user-worker-client.test.ts
```

Expected: 0 errors, 0 warnings; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/user-worker-client.ts app/src/lib/user-worker-client.test.ts
git commit -m "feat(user-worker-client): probeWorkerCapabilities returns discriminated union"
```

DO NOT push.

---

## Task 2: Modal status messages + step-5 example text

**Files:**
- Modify: `app/src/components/CustomProxySetupModal.svelte`

- [ ] **Step 1: Update `handleSaveWorker`**

In `app/src/components/CustomProxySetupModal.svelte`, find the existing `handleSaveWorker`:

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

Replace with:

```svelte
  async function handleSaveWorker() {
    if (!workerUrl || !workerSecret) {
      saveStatus = 'Both URL and shared secret are required.';
      return;
    }
    await saveProxyConfig({ url: workerUrl, sharedSecret: workerSecret, supportsArticles: false });
    saveStatus = 'Saved. Probing capabilities…';
    const result = await probeWorkerCapabilities(workerUrl, workerSecret);
    const supports = result.kind === 'has-articles';
    await saveProxyConfig({ url: workerUrl, sharedSecret: workerSecret, supportsArticles: supports });
    saveStatus = describeProbeResult(result, allowedOrigin);
    dispatch('change');
  }

  function describeProbeResult(result: ProbeResult, origin: string): string {
    switch (result.kind) {
      case 'has-articles':
        return '✓ Saved. Article extraction is enabled on this worker.';
      case 'image-only':
        return '⚠ Saved. This worker is image-only — paste the article-enabled bundle in step 3 to enable article backup.';
      case 'unauthorized':
        return '⚠ Saved. The shared secret doesn’t match — check the SHARED_SECRET env var on your worker.';
      case 'origin-blocked':
        return `⚠ Saved. The worker rejected this origin — set ALLOWED_ORIGIN to ${origin} on your worker.`;
      case 'no-capabilities-endpoint':
        return '⚠ Saved. The worker doesn’t expose /capabilities — redeploy with the current source from step 3.';
      case 'unreachable':
        return `⚠ Saved. Couldn’t reach the worker (${result.reason}). Check the URL and that the worker is deployed.`;
    }
  }
```

Update the import line at the top of the script to also import the type:

```svelte
  import { probeWorkerCapabilities, type ProbeResult } from '$lib/user-worker-client';
```

- [ ] **Step 2: Fix the step-5 example response text**

In the same file, find the `<li>` for step 5:

```svelte
        <li>
          <strong>Copy the worker URL.</strong>
          It's at the top of the worker page, ending in
          <code>.workers.dev</code>. Test it by pasting
          <code>&lt;that URL&gt;/fetch</code> into a browser tab — you should
          see <code>{`{"error":"forbidden"}`}</code> with status 403. That
          means the worker is reachable.
        </li>
```

Replace the example response with what the worker actually returns:

```svelte
        <li>
          <strong>Copy the worker URL.</strong>
          It's at the top of the worker page, ending in
          <code>.workers.dev</code>. Test it by pasting
          <code>&lt;that URL&gt;/fetch</code> into a browser tab — you should
          see <code>{`{"error":"Origin not allowed"}`}</code> with status 403.
          That means the worker is reachable and gating origins correctly.
        </li>
```

- [ ] **Step 3: Run check + tests + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 errors, 0 warnings; all tests pass; both bundles build.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/CustomProxySetupModal.svelte
git commit -m "feat(setup-modal): tailored save-status per probe result; fix step-5 example response"
```

DO NOT push.

---

## Final verification

- [ ] **Step 1: Run the full test matrix + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 errors, 0 warnings; all GUI tests pass; both bundles build.

- [ ] **Step 2: Push**

```bash
git push origin main
```

---

## Self-Review Checklist

- `probeWorkerCapabilities` never throws; returns a `ProbeResult` discriminated union.
- All eight test cases pass.
- `handleSaveWorker` persists `supportsArticles: true` only when `kind === 'has-articles'`.
- Modal status messages are specific to each probe outcome and point to the exact env var to check (when relevant).
- Step-5 example text matches the worker's actual error string (`{"error":"Origin not allowed"}`).
- Two commits, in order.
- `pnpm check && pnpm test && pnpm build` clean.

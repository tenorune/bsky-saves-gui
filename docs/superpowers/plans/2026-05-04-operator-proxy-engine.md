# Plan 12: Operator-hosted image-proxy backend (engine)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Restore the third image-backup backend deferred from Plan 3: an operator-hosted Cloudflare Worker that the deployed GUI uses as a fallback when no local helper or user-worker is configured. After this plan, the engine routes through `helper > user-worker > operator-proxy` automatically. **No UX yet** — Plan 13 adds the Settings panel, the opt-out toggle in the user-facing UI, and the operator-deploy README + privacy doc updates.

**Architecture:**

- **cf-worker template hardening (Task 1):** Add a `URL_ALLOWLIST` env var to `templates/cf-worker/worker.js`. When set, only request URLs starting with one of the comma-separated prefixes are accepted; everything else returns 400. Backward-compatible: empty/unset = no restriction (existing user deployments keep working). Operators deploy with `URL_ALLOWLIST=https://cdn.bsky.app/img/` to constrain abuse surface to the bsky CDN.
- **GUI image-fetcher (Task 2):** Read `VITE_OPERATOR_IMAGE_PROXY_URL` and `VITE_OPERATOR_IMAGE_PROXY_SECRET` at build time. When both are set, register an `'operator-proxy'` backend in `detectBackends`, with priority *below* user-worker (privacy ordering per design spec). Dispatch via the existing `user-worker-client` (same `POST /fetch` envelope shape).
- **Opt-out preference (Task 3):** Top-level boolean in `backup-prefs` (`operatorProxyOptOut`). When true, `detectBackends` skips the operator-proxy regardless of build-time configuration. Plan 13 surfaces this toggle in Settings.

**Out of scope (Plan 13):**
- Settings → Backup → Advanced panel showing operator proxy info + opt-out toggle.
- `templates/cf-worker/README.md` for operator deployment.
- Privacy doc updates describing the operator-proxy data flow.

**Tech Stack:** Same as previous plans. No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-05-04-hydration-and-backup-ux-design.md` — sections "Layered backend strategy" (priority order) and "Operator-hosted Cloudflare Worker" (the deferred backend).

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `7c79fe7` (Plan 11 commit) or later.

---

## Task 1: cf-worker URL allowlist

Add an env-var-driven URL prefix allowlist to `templates/cf-worker/worker.js`. Operators set it to `https://cdn.bsky.app/img/` to constrain the proxy to bsky's image CDN.

**Files:**
- Modify: `templates/cf-worker/worker.js`
- Modify: `templates/cf-worker/tests/worker.test.ts`

- [ ] **Step 1: Read the existing worker to understand current structure**

Run: `cat templates/cf-worker/worker.js | head -80` so the implementer sees the validation flow. The current flow validates `Origin` and `X-Proxy-Secret` before fetching. The allowlist check should slot in AFTER auth validation but BEFORE the upstream fetch.

- [ ] **Step 2: Add the URL allowlist check**

In `templates/cf-worker/worker.js`, after the existing `Origin` + secret validation but before the line that performs the upstream `fetch(url, ...)` call, add a URL allowlist check:

```js
    // 7. Optional URL allowlist. If URL_ALLOWLIST is set, the request URL
    //    must start with one of the comma-separated prefixes. Empty/unset
    //    means no restriction (backward compatible for unrestricted user
    //    deployments).
    const allowlist = (env.URL_ALLOWLIST ?? '').trim();
    if (allowlist !== '') {
      const prefixes = allowlist.split(',').map((p) => p.trim()).filter(Boolean);
      const allowed = prefixes.some((p) => url.startsWith(p));
      if (!allowed) {
        return jsonError('url not allowed', 400, corsHeaders(env.ALLOWED_ORIGIN));
      }
    }
```

(`url` here is whatever the existing code names the parsed request URL. If the existing code names it differently, adapt the variable name. The allowlist check goes INSIDE the request handler, AFTER the JSON parse pulls out the request URL, and BEFORE the upstream fetch.)

If the existing worker uses different control flow (e.g., extracts `url` later), insert the check at the appropriate place — directly before the upstream `fetch(url, ...)`.

Update the `Env` typedef at the top of the file to include `URL_ALLOWLIST`:

```js
/**
 * @typedef {{ ALLOWED_ORIGIN: string; SHARED_SECRET: string; URL_ALLOWLIST?: string }} Env
 */
```

- [ ] **Step 3: Add tests**

Open `templates/cf-worker/tests/worker.test.ts`. Find a section where existing tests use `wrangler dev`'s `unstable_dev` to spin up the worker. Add a new describe block at the END of the file:

```ts
describe('URL_ALLOWLIST', () => {
  let worker: UnstableDevWorker;
  beforeAll(async () => {
    worker = await unstable_dev('worker.js', {
      vars: {
        ALLOWED_ORIGIN: GOOD_ORIGIN,
        SHARED_SECRET: GOOD_SECRET,
        URL_ALLOWLIST: 'https://cdn.bsky.app/img/',
      },
      experimental: { disableExperimentalWarning: true },
    });
  });
  afterAll(async () => {
    await worker.stop();
  });

  it('allows URLs that match the allowlist prefix', { timeout: 20_000 }, async () => {
    const res = await worker.fetch('/fetch', {
      method: 'POST',
      headers: {
        Origin: GOOD_ORIGIN,
        'Content-Type': 'application/json',
        'X-Proxy-Secret': GOOD_SECRET,
      },
      body: JSON.stringify({ url: 'https://cdn.bsky.app/img/anything' }),
    });
    // We accept any non-400 status (success or upstream error) — what we're
    // testing is that the allowlist check did NOT reject the URL.
    expect(res.status).not.toBe(400);
  });

  it('rejects URLs that do not match the allowlist prefix', async () => {
    const res = await worker.fetch('/fetch', {
      method: 'POST',
      headers: {
        Origin: GOOD_ORIGIN,
        'Content-Type': 'application/json',
        'X-Proxy-Secret': GOOD_SECRET,
      },
      body: JSON.stringify({ url: 'https://example.com/anything' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/not allowed/i);
  });
});
```

(The constants `GOOD_ORIGIN`, `GOOD_SECRET`, the `unstable_dev` import, and `UnstableDevWorker` type are already established at the top of the existing test file. Reuse them.)

If the existing test file uses a slightly different test-bootstrap pattern, follow that pattern instead. The new tests should slot in alongside existing happy-path / auth-rejection tests.

- [ ] **Step 4: Run worker tests**

Run: `pnpm --dir templates/cf-worker test`

Or the equivalent command the existing worker tests use (check `templates/cf-worker/package.json` for a `test` script). The existing tests should still pass; the two new ones should pass.

If the existing test infrastructure spins up real wrangler instances and that's flaky in this environment, the implementer can mark the new describe block with longer timeouts (matching the pre-existing online-proxy test that uses `{ timeout: 20_000 }`).

- [ ] **Step 5: Run the full GUI test suite + check + build**

Run from repo root: `pnpm check && pnpm test && pnpm build`

Expected: 0 errors. The cf-worker tests are NOT part of this run (separate project), but the main GUI suite should still be green at 152/152.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(cf-worker): URL_ALLOWLIST env var to constrain proxy to allowed prefixes"
```

DO NOT push.

---

## Task 2: GUI operator-proxy backend in `image-fetcher`

Read `VITE_OPERATOR_IMAGE_PROXY_URL` and `VITE_OPERATOR_IMAGE_PROXY_SECRET` from build-time env. When both are set, register an `operator-proxy` backend in `detectBackends`, ordered AFTER `helper` and `user-worker` (per the design spec's privacy ordering). Dispatch via `fetchImageViaUserWorker` since the cf-worker shape is the same.

**Files:**
- Modify: `app/src/lib/config.ts`
- Modify: `.env.example`
- Modify: `app/src/lib/image-fetcher.ts`
- Modify: `app/src/lib/image-fetcher.test.ts`

- [ ] **Step 1: Add env vars to config and `.env.example`**

Open `app/src/lib/config.ts`. Add two new optional fields to the config interface:

```ts
  readonly operatorImageProxyUrl: string;
  readonly operatorImageProxySecret: string;
```

In the helper that reads env vars, add an `optional()` reader (alongside the existing `required()`) if it doesn't already exist. The pattern depends on how the file is currently structured. Most likely there's a `required(name)` that throws on missing; add an `optional(name)` that returns `import.meta.env[name] ?? ''`.

Then populate the two new fields:

```ts
  operatorImageProxyUrl: optional('VITE_OPERATOR_IMAGE_PROXY_URL'),
  operatorImageProxySecret: optional('VITE_OPERATOR_IMAGE_PROXY_SECRET'),
```

(Both default to `''` when unset. The image-fetcher will check for non-empty strings before treating the operator proxy as configured.)

In `.env.example`, add the two new entries near the existing `VITE_HELPER_ORIGIN`:

```
# Optional: operator-deployed Cloudflare Worker for image backup, used as a
# fallback when no local helper or user-worker is available. Set both URL and
# secret to enable. Leave blank to disable.
VITE_OPERATOR_IMAGE_PROXY_URL=
VITE_OPERATOR_IMAGE_PROXY_SECRET=
```

- [ ] **Step 2: Update existing config.test.ts if it exists**

Run: `ls app/src/lib/config.test.ts && cat app/src/lib/config.test.ts | head -40`

If the test file expects a specific shape, add the two new fields to the test fixture.

- [ ] **Step 3: Add the operator-proxy backend type to `image-fetcher.ts`**

Open `app/src/lib/image-fetcher.ts`. Add a new backend variant:

```ts
export type BackendKind = 'helper' | 'user-worker' | 'operator-proxy';

export interface OperatorProxyBackend {
  readonly kind: 'operator-proxy';
  readonly config: ProxyConfig;
}

export type Backend = HelperBackend | UserWorkerBackend | OperatorProxyBackend;
```

(`ProxyConfig` is already imported. Reuse its `{ url, sharedSecret }` shape for the operator proxy too — same envelope.)

- [ ] **Step 4: Update `detectBackends` to add operator-proxy after helper and user-worker**

Modify `detectBackends` to also consider operator-proxy:

```ts
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
  if (
    config.operatorImageProxyUrl !== '' &&
    config.operatorImageProxySecret !== ''
  ) {
    out.push({
      kind: 'operator-proxy',
      config: {
        url: config.operatorImageProxyUrl,
        sharedSecret: config.operatorImageProxySecret,
      },
    });
  }
  return out;
}
```

- [ ] **Step 5: Update `fetchImage` to dispatch operator-proxy through user-worker-client**

Modify `fetchImage`:

```ts
export async function fetchImage(imageUrl: string): Promise<Blob> {
  const backends = await detectBackends();
  if (backends.length === 0) throw new NoBackendsAvailableError();
  const backend = backends[0];
  if (backend.kind === 'helper') {
    return fetchImageViaHelper(config.helperOrigin, imageUrl);
  }
  // Both user-worker and operator-proxy use the same cf-worker template's
  // POST /fetch envelope, so we can dispatch through the same client.
  return fetchImageViaUserWorker(backend.config, imageUrl);
}
```

- [ ] **Step 6: Add tests**

Open `app/src/lib/image-fetcher.test.ts`. Add a new describe block AFTER the existing `describe('fetchImage', ...)` block:

```ts
describe('operator-proxy backend', () => {
  it('detectBackends includes operator-proxy when configured at build time', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch'); // helper probe fails
      }),
    );
    vi.doMock('./config', () => ({
      config: {
        helperOrigin: 'http://127.0.0.1:47826',
        operatorImageProxyUrl: 'https://operator.example/fetch',
        operatorImageProxySecret: 'op-secret',
      },
    }));
    const { detectBackends } = await import('./image-fetcher');
    const backends = await detectBackends();
    expect(backends.map((b) => b.kind)).toEqual(['operator-proxy']);
    vi.doUnmock('./config');
  });

  it('detectBackends orders operator-proxy AFTER user-worker', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch'); // helper probe fails
      }),
    );
    vi.doMock('./config', () => ({
      config: {
        helperOrigin: 'http://127.0.0.1:47826',
        operatorImageProxyUrl: 'https://operator.example/fetch',
        operatorImageProxySecret: 'op-secret',
      },
    }));
    const { saveProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://my.workers.dev', sharedSecret: 's' });
    const { detectBackends } = await import('./image-fetcher');
    const backends = await detectBackends();
    expect(backends.map((b) => b.kind)).toEqual(['user-worker', 'operator-proxy']);
    vi.doUnmock('./config');
  });

  it('detectBackends omits operator-proxy when not configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    // Default config (test setup) has empty operator URL.
    const { detectBackends } = await import('./image-fetcher');
    const backends = await detectBackends();
    expect(backends.map((b) => b.kind)).not.toContain('operator-proxy');
  });
});
```

These tests use `vi.doMock` to override the `config` module. If the existing test file uses a different mocking approach (e.g., environment-variable manipulation), follow that pattern instead.

- [ ] **Step 7: Run check + tests + build**

Run: `pnpm check && pnpm test && pnpm build`

Expected: 0 errors, 0 warnings. ~155 tests pass (3 new). Both bundles build.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(image-fetcher): operator-proxy backend (priority below user-worker)"
```

DO NOT push.

---

## Task 3: `operatorProxyOptOut` preference in `backup-prefs`

Add a top-level boolean to `BackupPrefs` (NOT per-feature — operator proxy is image-only, but the opt-out is a single user-level preference). When true, `detectBackends` skips the operator-proxy regardless of build-time config.

**Files:**
- Modify: `app/src/lib/backup-prefs.ts`
- Modify: `app/src/lib/backup-prefs.test.ts`
- Modify: `app/src/lib/image-fetcher.ts`
- Modify: `app/src/lib/image-fetcher.test.ts`

- [ ] **Step 1: Extend `BackupPrefs` with `operatorProxyOptOut`**

In `app/src/lib/backup-prefs.ts`, update the `BackupPrefs` interface and `DEFAULTS`:

```ts
export interface BackupPrefs {
  readonly images: FeaturePrefs;
  readonly articles: FeaturePrefs;
  readonly operatorProxyOptOut: boolean;
}
```

```ts
const DEFAULTS: BackupPrefs = Object.freeze({
  images: { snoozeUntil: null, dontAsk: false, enabled: false },
  articles: { snoozeUntil: null, dontAsk: false, enabled: false },
  operatorProxyOptOut: false,
});
```

Update the `isBackupPrefs` type guard:

```ts
function isBackupPrefs(v: unknown): v is BackupPrefs {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    isFeaturePrefs(r.images) &&
    isFeaturePrefs(r.articles) &&
    typeof r.operatorProxyOptOut === 'boolean'
  );
}
```

(Note: existing persisted prefs don't have `operatorProxyOptOut`. The guard will reject them, falling back to DEFAULTS. That's a one-time migration — users who previously interacted with backup will lose their snooze/dontAsk state. Acceptable since the feature is recent. Document the breaking shape change in the commit message.)

Add a setter:

```ts
export async function setOperatorProxyOptOut(optOut: boolean): Promise<void> {
  const prefs = await loadBackupPrefs();
  const next: BackupPrefs = { ...prefs, operatorProxyOptOut: optOut };
  await saveBackupPrefs(next);
}
```

- [ ] **Step 2: Update existing backup-prefs tests for the new shape**

In `app/src/lib/backup-prefs.test.ts`, find tests that compare against the full `BackupPrefs` shape (e.g. the "returns defaults" test) and add `operatorProxyOptOut: false` to the expected object.

Add a new test for the setter:

```ts
  it('setOperatorProxyOptOut persists and round-trips', async () => {
    const { setOperatorProxyOptOut, loadBackupPrefs } = await import('./backup-prefs');
    await setOperatorProxyOptOut(true);
    expect((await loadBackupPrefs()).operatorProxyOptOut).toBe(true);
    await setOperatorProxyOptOut(false);
    expect((await loadBackupPrefs()).operatorProxyOptOut).toBe(false);
  });
```

- [ ] **Step 3: Update `detectBackends` to honor the opt-out**

In `app/src/lib/image-fetcher.ts`, update `detectBackends` to load prefs and skip operator-proxy when opt-out is set:

```ts
import { loadBackupPrefs } from './backup-prefs';

// ...

export async function detectBackends(): Promise<Backend[]> {
  const [helperStatus, proxyCfg, prefs] = await Promise.all([
    probeConfiguredHelper(),
    loadProxyConfig(),
    loadBackupPrefs(),
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
  if (
    !prefs.operatorProxyOptOut &&
    config.operatorImageProxyUrl !== '' &&
    config.operatorImageProxySecret !== ''
  ) {
    out.push({
      kind: 'operator-proxy',
      config: {
        url: config.operatorImageProxyUrl,
        sharedSecret: config.operatorImageProxySecret,
      },
    });
  }
  return out;
}
```

- [ ] **Step 4: Add a test for the opt-out behavior**

In `app/src/lib/image-fetcher.test.ts`, in the operator-proxy describe block (added in Task 2), add:

```ts
  it('respects operatorProxyOptOut: omits operator-proxy when opted out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    vi.doMock('./config', () => ({
      config: {
        helperOrigin: 'http://127.0.0.1:47826',
        operatorImageProxyUrl: 'https://operator.example/fetch',
        operatorImageProxySecret: 'op-secret',
      },
    }));
    const { setOperatorProxyOptOut } = await import('./backup-prefs');
    await setOperatorProxyOptOut(true);
    const { detectBackends } = await import('./image-fetcher');
    const backends = await detectBackends();
    expect(backends.map((b) => b.kind)).toEqual([]);
    vi.doUnmock('./config');
  });
```

Make sure the test file's `beforeEach` block clears `backup-prefs` (so opt-out from this test doesn't leak into others). If it doesn't already, add:

```ts
  const { clearBackupPrefs } = await import('./backup-prefs');
  await clearBackupPrefs();
```

…to the existing `beforeEach`.

- [ ] **Step 5: Run check + tests + build**

Run: `pnpm check && pnpm test && pnpm build`

Expected: 0 errors, 0 warnings. ~157 tests pass (existing 152 + 3 from Task 2 + 2 from Task 3). Both bundles build.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(backup-prefs): operatorProxyOptOut top-level flag; detect honors it"
```

DO NOT push.

---

## Final verification

- [ ] **Step 1: Run check + test + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 type errors, 0 warnings. ~157 tests pass. Both bundles build.

- [ ] **Step 2: Push**

```bash
git push origin main
```

---

## What's next

Plan 12 ships the engine for operator-proxy support but no UX surfaces. With `VITE_OPERATOR_IMAGE_PROXY_URL` and `VITE_OPERATOR_IMAGE_PROXY_SECRET` set at build time, the deployed GUI will silently fall back to the operator proxy when no helper or user-worker is configured.

Plan 13 will add the user-facing pieces:
- Settings → Backup → Advanced shows the operator proxy URL + reachability + opt-out toggle when configured.
- `templates/cf-worker/README.md` for operator deployment (`wrangler deploy`, GitHub Actions secrets, the new `URL_ALLOWLIST` var).
- Privacy doc updates: an honest description of the operator-proxy data flow and the opt-out path.

After Plan 13, the operator proxy is fully integrated and discoverable.

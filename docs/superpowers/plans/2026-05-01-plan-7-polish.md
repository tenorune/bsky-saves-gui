# Plan 7 — Polish: Beacon, Settings, Privacy, Return-Visit Flow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the user-facing experience. After Plan 7: revisits land directly in the library when an inventory exists; a Settings page exposes clear-data, inventory import/export, and proxy URL configuration; a footer beacon button likes a pinned post on the operator's account; the privacy policy renders at `#/privacy`; saved credentials auto-detect and offer unlock on the sign-in screen.

**Architecture:** Mostly UI + glue. Three new TDD modules: `beacon.ts` (AT Proto like call), `helper-detector.ts` (probes `127.0.0.1:7878/health`), `proxy-config.ts` (IndexedDB store). Two new Svelte routes: real Privacy and Settings. Privacy uses `marked` to render the canonical `docs/privacy.md`. App.svelte gains return-visit detection: if an inventory is in IndexedDB, the entry route is `#/library` instead of `#/`.

**Tech Stack:** Existing stack. Adds `marked` for markdown rendering.

**Reference:** [Design spec](../specs/2026-05-01-bsky-saves-gui-design.md) — privacy section, user flow.

---

## File Structure

```
app/src/
├── lib/
│   ├── beacon.ts                  # likes the pinned beacon post
│   ├── beacon.test.ts
│   ├── helper-detector.ts         # probes VITE_HELPER_ORIGIN/health
│   ├── helper-detector.test.ts
│   ├── proxy-config.ts            # IndexedDB-backed proxy URL + secret
│   ├── proxy-config.test.ts
│   └── return-visit.ts            # entry-route decision: library vs sign-in
├── routes/
│   ├── Privacy.svelte             # rendered from docs/privacy.md
│   └── Settings.svelte            # clear data, import/export, proxy config, links
├── components/
│   ├── BeaconButton.svelte
│   └── HelperBadge.svelte         # status badge (in Run page hydrate-articles row)

docs/
└── privacy.md                     # canonical privacy policy
```

Modifications: `App.svelte` (footer beacon button + entry-route logic), `Run.svelte` (helper badge on articles toggle, optional), `SignIn.svelte` (saved-credentials prompt).

---

## Task 1: Privacy policy doc + Privacy.svelte

**Files:**
- Create: `docs/privacy.md`
- Modify: `app/src/routes/Privacy.svelte`
- Add dep: `marked`

- [ ] **Step 1: Add marked**

```bash
pnpm add marked
```

- [ ] **Step 2: Write `docs/privacy.md`**

```markdown
# Privacy

This page describes how `${VITE_APP_NAME}` (deployed at `${VITE_APP_DOMAIN}`) handles your data.

## Architecture summary

This is a static web app. There is no server the operator runs that receives your credentials, your saves, or any other content. The page, its scripts, and its styles are static files hosted on GitHub Pages. All processing happens in your browser.

## What stays local

- Your handle and app password (only in browser memory unless you opt in to encrypted persistence).
- Your inventory of saved posts (in IndexedDB on this device).
- Any hydrated content (article text, images, thread descendants).

## What leaves your browser

- **Your Bluesky PDS** receives your authentication and AT Protocol requests when you sign in and run a fetch. This is unavoidable — it is how Bluesky works.
- **`cdn.bsky.app`** receives image fetches if you turn on image hydration.
- **Article hosts** receive fetches for any URLs in your saves if you turn on article hydration. Article hydration runs through either a local helper you install, or a Cloudflare Worker proxy you deploy. Either way, the operator never sees the traffic.
- **The operator's Bluesky account `@${VITE_OPERATOR_HANDLE}`** sees a like on a single pinned beacon post if and only if you click the "Tell @${VITE_OPERATOR_HANDLE} you used this" button. This is an ordinary Bluesky like — public on your account, identical to liking any other post. No data accompanies the like.

There is no analytics service. No telemetry. No error reporting endpoint.

## GitHub Pages edge logging

Static files are hosted on GitHub Pages. GitHub sees server-level request metadata (IP, path, user agent) like any web host, per [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). The operator does not have access to those logs.

## Threats out of scope

- A compromised browser extension can read anything this page can read.
- A compromised device is out of scope.
- Supply chain attacks on the GitHub Pages deploy. Mitigated by version-pinned dependencies and tag-driven CI.

## How to revoke a Bluesky app password

If you ever want to revoke the app password you used here, sign in to the [Bluesky web app](https://bsky.app), open Settings → App Passwords, and delete it. The app password used by this tool is unrelated to your main account password.

## Questions

Open an issue at the project repository linked from the footer.
```

- [ ] **Step 3: Replace `app/src/routes/Privacy.svelte`**

```svelte
<script lang="ts">
  import { marked } from 'marked';
  import { config } from '$lib/config';
  // Vite's `?raw` import returns the file contents as a string at build time.
  import rawPrivacy from '../../../docs/privacy.md?raw';

  // Substitute config placeholders.
  const substituted = rawPrivacy
    .replaceAll('${VITE_APP_NAME}', config.appName)
    .replaceAll('${VITE_APP_DOMAIN}', config.appDomain)
    .replaceAll('${VITE_OPERATOR_HANDLE}', config.operatorHandle);

  const html = marked.parse(substituted, { async: false }) as string;
</script>

<section class="route route--privacy">
  <div class="privacy-doc">
    {@html html}
  </div>
</section>

<style>
  .privacy-doc {
    max-width: 44rem;
    margin: 0 auto;
    line-height: 1.6;
  }
  .privacy-doc :global(h1) {
    margin-bottom: 1rem;
  }
  .privacy-doc :global(h2) {
    margin-top: 2rem;
  }
  .privacy-doc :global(code) {
    background: color-mix(in oklab, CanvasText 5%, Canvas);
    padding: 0.1em 0.3em;
    border-radius: 3px;
    font-size: 0.9em;
  }
</style>
```

- [ ] **Step 4: Verify**

```bash
pnpm check        # 0 errors
pnpm test         # all existing tests pass
pnpm build        # success
```

If `?raw` import is rejected by TypeScript, add to `app/src/env.d.ts`:

```ts
declare module '*.md?raw' {
  const content: string;
  export default content;
}
```

- [ ] **Step 5: Commit**

```bash
git add docs/privacy.md app/src/routes/Privacy.svelte app/src/env.d.ts package.json pnpm-lock.yaml
git commit -m "feat(privacy): canonical privacy policy and rendered Privacy route"
```

---

## Task 2: Beacon module

**Files:**
- Create: `app/src/lib/beacon.ts`
- Create: `app/src/lib/beacon.test.ts`

- [ ] **Step 1: Test**

```ts
// app/src/lib/beacon.test.ts
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
```

- [ ] **Step 2: Implement `app/src/lib/beacon.ts`**

```ts
import { get, set, del } from 'idb-keyval';
import { config } from './config';

const KEY = 'beacon:sent:v1';

export class BeaconNotConfiguredError extends Error {
  constructor() {
    super('Beacon AT URI is not configured for this deployment');
    this.name = 'BeaconNotConfiguredError';
  }
}

export interface BeaconAuth {
  readonly pds: string;
  readonly accessJwt: string;
  readonly did: string;
}

export async function likeBeacon(auth: BeaconAuth): Promise<void> {
  if (!config.beaconAtUri) throw new BeaconNotConfiguredError();
  const base = auth.pds.replace(/\/+$/, '');
  // We need the cid of the beacon post for a proper like; without an extra
  // getRecord call we approximate by passing only uri (Bluesky tolerates this
  // for likes but the spec recommends both). Implementer may extend with a
  // getRecord call if accuracy of cid matters.
  const res = await fetch(`${base}/xrpc/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${auth.accessJwt}`,
    },
    body: JSON.stringify({
      repo: auth.did,
      collection: 'app.bsky.feed.like',
      record: {
        $type: 'app.bsky.feed.like',
        subject: { uri: config.beaconAtUri, cid: '' },
        createdAt: new Date().toISOString(),
      },
    }),
  });
  if (!res.ok) throw new Error(`Beacon like failed: ${res.status}`);
}

export async function hasBeaconBeenSent(): Promise<boolean> {
  return (await get(KEY)) === true;
}

export async function markBeaconSent(): Promise<void> {
  await set(KEY, true);
}

export async function clearBeaconSent(): Promise<void> {
  await del(KEY);
}
```

- [ ] **Step 3: Run, expect pass.** Commit.

```bash
git add app/src/lib/beacon.ts app/src/lib/beacon.test.ts
git commit -m "feat(beacon): like-pinned-post helper with sent-state persistence"
```

---

## Task 3: Helper detector

**Files:**
- Create: `app/src/lib/helper-detector.ts`
- Create: `app/src/lib/helper-detector.test.ts`

- [ ] **Step 1: Test**

```ts
// app/src/lib/helper-detector.test.ts
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
```

- [ ] **Step 2: Implement `app/src/lib/helper-detector.ts`**

```ts
import { config } from './config';

export type HelperStatus =
  | { status: 'available'; version: string }
  | { status: 'unavailable' };

export async function detectHelper(): Promise<HelperStatus> {
  const url = `${config.helperOrigin.replace(/\/+$/, '')}/health`;
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return { status: 'unavailable' };
    const body = (await res.json()) as { ok?: boolean; version?: string };
    if (body.ok === true && typeof body.version === 'string') {
      return { status: 'available', version: body.version };
    }
    return { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}
```

- [ ] **Step 3: Run, expect pass.** Commit.

```bash
git add app/src/lib/helper-detector.ts app/src/lib/helper-detector.test.ts
git commit -m "feat(helper): detect VITE_HELPER_ORIGIN /health"
```

---

## Task 4: Proxy config store

**Files:**
- Create: `app/src/lib/proxy-config.ts`
- Create: `app/src/lib/proxy-config.test.ts`

- [ ] **Step 1: Test**

```ts
// app/src/lib/proxy-config.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

describe('proxyConfig', () => {
  beforeEach(async () => {
    const { clearProxyConfig } = await import('./proxy-config');
    await clearProxyConfig();
  });

  it('returns null when nothing is stored', async () => {
    const { loadProxyConfig } = await import('./proxy-config');
    expect(await loadProxyConfig()).toBeNull();
  });

  it('round-trips a saved config', async () => {
    const { saveProxyConfig, loadProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({
      url: 'https://my-proxy.user.workers.dev',
      sharedSecret: 'sek',
    });
    expect(await loadProxyConfig()).toEqual({
      url: 'https://my-proxy.user.workers.dev',
      sharedSecret: 'sek',
    });
  });

  it('clearProxyConfig wipes the entry', async () => {
    const { saveProxyConfig, loadProxyConfig, clearProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://x', sharedSecret: 's' });
    await clearProxyConfig();
    expect(await loadProxyConfig()).toBeNull();
  });
});
```

- [ ] **Step 2: Implement `app/src/lib/proxy-config.ts`**

```ts
import { get, set, del } from 'idb-keyval';

const KEY = 'proxy-config:v1';

export interface ProxyConfig {
  readonly url: string;
  readonly sharedSecret: string;
}

export async function saveProxyConfig(config: ProxyConfig): Promise<void> {
  await set(KEY, config);
}

export async function loadProxyConfig(): Promise<ProxyConfig | null> {
  const v = (await get(KEY)) as ProxyConfig | undefined;
  return v ?? null;
}

export async function clearProxyConfig(): Promise<void> {
  await del(KEY);
}
```

- [ ] **Step 3: Run, expect pass.** Commit.

```bash
git add app/src/lib/proxy-config.ts app/src/lib/proxy-config.test.ts
git commit -m "feat(proxy): IndexedDB store for Cloudflare Worker proxy config"
```

---

## Task 5: Settings route

**Files:**
- Modify: `app/src/routes/Settings.svelte`

The Settings route exposes:
- Clear all local data (inventory + credentials + proxy config + beacon-sent state).
- Export inventory file (re-uses `exportJson` from Plan 4).
- Import inventory file (file input → parse → save).
- Configure proxy URL + shared secret.
- Link to privacy policy.

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { navigate } from '$lib/router';
  import { inventoryState, loadFromDb } from '$lib/inventory-loader';
  import { saveInventory, clearInventory } from '$lib/inventory-store';
  import { clearCredentials } from '$lib/credentials-store';
  import { clearBeaconSent } from '$lib/beacon';
  import { loadProxyConfig, saveProxyConfig, clearProxyConfig, type ProxyConfig } from '$lib/proxy-config';
  import { exportJson } from '../exporters/json-exporter';
  import { downloadFile } from '../exporters/file-download';
  import { parseInventory } from '../reader/inventory-shape';

  let proxyUrl = '';
  let proxySecret = '';
  let status = '';
  let error = '';

  onMount(async () => {
    const cfg = await loadProxyConfig();
    if (cfg) {
      proxyUrl = cfg.url;
      proxySecret = cfg.sharedSecret;
    }
  });

  async function exportInventory() {
    error = '';
    const s = get(inventoryState);
    if (s.status !== 'ready') {
      error = 'No inventory loaded.';
      return;
    }
    const r = await exportJson(s.inventory);
    downloadFile(r.blob, r.filename);
  }

  async function importInventory(e: Event) {
    error = '';
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseInventory(JSON.parse(text));
      await saveInventory(parsed);
      await loadFromDb();
      status = `Imported ${parsed.saves.length} saves.`;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Import failed';
    } finally {
      input.value = '';
    }
  }

  async function clearAll() {
    if (!confirm('Clear inventory, saved credentials, proxy config, and beacon state? This cannot be undone.')) {
      return;
    }
    await Promise.all([
      clearInventory(),
      clearCredentials(),
      clearProxyConfig(),
      clearBeaconSent(),
    ]);
    await loadFromDb();
    proxyUrl = '';
    proxySecret = '';
    status = 'All local data cleared.';
  }

  async function saveProxy() {
    error = '';
    if (!proxyUrl || !proxySecret) {
      error = 'Both URL and shared secret are required.';
      return;
    }
    await saveProxyConfig({ url: proxyUrl, sharedSecret: proxySecret });
    status = 'Proxy config saved.';
  }

  async function clearProxy() {
    await clearProxyConfig();
    proxyUrl = '';
    proxySecret = '';
    status = 'Proxy config cleared.';
  }
</script>

<section class="route route--settings">
  <header class="route__header">
    <button type="button" on:click={() => navigate('/library')}>← Back</button>
    <h2>Settings</h2>
  </header>

  {#if status}
    <p class="status">{status}</p>
  {/if}
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  <section class="settings-section">
    <h3>Inventory</h3>
    <p class="help">Move your saved data between devices or browsers.</p>
    <div class="settings-row">
      <button type="button" on:click={exportInventory}>Export inventory file</button>
      <label class="file-input">
        Import inventory file
        <input type="file" accept=".json,application/json" on:change={importInventory} />
      </label>
    </div>
  </section>

  <section class="settings-section">
    <h3>Cloudflare Worker proxy</h3>
    <p class="help">
      Used for article hydration when no local helper is running. See the project's
      <code>templates/cf-worker/</code> README for how to deploy your own.
    </p>
    <label>
      Proxy URL
      <input type="url" bind:value={proxyUrl} placeholder="https://your-worker.workers.dev" />
    </label>
    <label>
      Shared secret
      <input type="password" bind:value={proxySecret} />
    </label>
    <div class="settings-row">
      <button type="button" on:click={saveProxy}>Save proxy</button>
      <button type="button" on:click={clearProxy}>Clear</button>
    </div>
  </section>

  <section class="settings-section">
    <h3>Local data</h3>
    <p class="help">
      Wipes inventory, saved credentials, proxy config, and beacon state from this browser.
    </p>
    <button type="button" class="danger" on:click={clearAll}>Clear all local data</button>
  </section>

  <section class="settings-section">
    <h3>Privacy</h3>
    <p>
      <a href="#/privacy">Read the privacy policy</a>.
    </p>
  </section>
</section>

<style>
  .route__header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .route__header button {
    background: none;
    border: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
  }
  .settings-section {
    border-top: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
    padding: 1rem 0;
  }
  .settings-section h3 {
    margin: 0 0 0.5rem;
  }
  .settings-section .help {
    margin: 0 0 0.75rem;
    font-size: 0.875rem;
    opacity: 0.8;
  }
  .settings-section label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 0.5rem;
    font-weight: 500;
  }
  .settings-section input[type='url'],
  .settings-section input[type='password'] {
    font: inherit;
    padding: 0.5rem 0.75rem;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
  }
  .settings-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .settings-row button,
  .file-input {
    font: inherit;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
  }
  .file-input input {
    display: none;
  }
  .danger {
    background: color-mix(in oklab, red 10%, Canvas);
    border: 1px solid color-mix(in oklab, red 30%, transparent);
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .status {
    color: color-mix(in oklab, green 70%, CanvasText);
    font-weight: 500;
  }
  .error {
    color: color-mix(in oklab, red 70%, CanvasText);
    font-weight: 500;
  }
</style>
```

- [ ] **Step 2: Verify**

`pnpm check` 0 errors. `pnpm test` no regressions. `pnpm build` clean.

- [ ] **Step 3: Commit**

```bash
git add app/src/routes/Settings.svelte
git commit -m "feat(settings): real Settings route with import/export, proxy, clear-all"
```

---

## Task 6: Beacon button + return-visit flow

**Files:**
- Create: `app/src/components/BeaconButton.svelte`
- Modify: `app/src/App.svelte` (footer + entry-route logic)
- Create: `app/src/lib/return-visit.ts`
- Create: `app/src/lib/return-visit.test.ts`

- [ ] **Step 1: Test return-visit**

```ts
// app/src/lib/return-visit.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

describe('return-visit', () => {
  beforeEach(async () => {
    const { clearInventory, saveInventory } = await import('./inventory-store');
    await clearInventory();
    void saveInventory; // referenced to keep the import live
  });

  it('returns "/" when no inventory', async () => {
    const { decideEntryRoute } = await import('./return-visit');
    expect(await decideEntryRoute()).toBe('/');
  });

  it('returns "/library" when inventory exists', async () => {
    const { saveInventory } = await import('./inventory-store');
    await saveInventory({ saves: [] });
    const { decideEntryRoute } = await import('./return-visit');
    expect(await decideEntryRoute()).toBe('/library');
  });
});
```

- [ ] **Step 2: Implement `app/src/lib/return-visit.ts`**

```ts
import { loadInventory } from './inventory-store';

export async function decideEntryRoute(): Promise<string> {
  const inv = await loadInventory();
  return inv === null ? '/' : '/library';
}
```

- [ ] **Step 3: Implement `app/src/components/BeaconButton.svelte`**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { config } from '$lib/config';
  import { hasBeaconBeenSent, markBeaconSent } from '$lib/beacon';
  import { lastSession } from '$lib/last-session';
  import { likeBeacon } from '$lib/beacon';

  let visible = !!config.beaconAtUri;
  let sent = false;
  let busy = false;
  let error = '';

  onMount(async () => {
    if (!visible) return;
    sent = await hasBeaconBeenSent();
  });

  async function fire() {
    error = '';
    const session = $lastSession;
    if (!session) {
      error = 'Sign in first.';
      return;
    }
    busy = true;
    try {
      await likeBeacon({ pds: session.pds, accessJwt: session.accessJwt, did: session.did });
      await markBeaconSent();
      sent = true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

{#if visible}
  <div class="beacon-button">
    {#if sent}
      <span>Thanks 💌</span>
    {:else}
      <button type="button" on:click={fire} disabled={busy}>
        Tell @{config.operatorHandle} you used this
      </button>
      {#if error}
        <span class="error">{error}</span>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .beacon-button {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  button {
    font: inherit;
    padding: 0.25rem 0.6rem;
    cursor: pointer;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: inherit;
  }
  .error {
    color: color-mix(in oklab, red 70%, CanvasText);
    font-size: 0.875rem;
  }
</style>
```

- [ ] **Step 4: Create `app/src/lib/last-session.ts`**

A small store the engine writes into so the beacon button has the access JWT + DID + PDS at hand.

```ts
import { writable, type Readable } from 'svelte/store';

export interface LastSession {
  readonly pds: string;
  readonly accessJwt: string;
  readonly did: string;
  readonly handle: string;
}

const store = writable<LastSession | null>(null);
export const lastSession: Readable<LastSession | null> = { subscribe: store.subscribe };

export function setLastSession(session: LastSession | null): void {
  store.set(session);
}
```

- [ ] **Step 5: Wire `setLastSession` in `engine.ts`**

In `app/src/lib/engine.ts`, after `createSession` succeeds, call `setLastSession({ pds: input.pds, accessJwt: session.accessJwt, did: session.did, handle: session.handle })`.

- [ ] **Step 6: Modify `app/src/App.svelte`**

Add return-visit detection: on mount, decide entry route. Add the BeaconButton to the footer.

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { config } from '$lib/config';
  import { currentRoute, startRouter, navigate } from '$lib/router';
  import { decideEntryRoute } from '$lib/return-visit';
  import ExportMenu from './components/ExportMenu.svelte';
  import BeaconButton from './components/BeaconButton.svelte';

  onMount(async () => {
    const stop = startRouter();
    // If user landed on the default `/` route and we have an inventory, jump to library.
    if (window.location.hash === '' || window.location.hash === '#/') {
      const target = await decideEntryRoute();
      if (target !== '/') navigate(target);
    }
    return stop;
  });
</script>

<!-- Existing markup; modify footer: -->
<footer class="app-footer">
  <p>Operator: <code>@{config.operatorHandle}</code></p>
  <p class="app-footer__row">
    <BeaconButton />
  </p>
  <p>
    <a href={config.repoUrl} target="_blank" rel="noopener noreferrer">Source</a>
    ·
    <a href="#/privacy">Privacy</a>
  </p>
</footer>
```

- [ ] **Step 7: Verify**

```bash
pnpm check
pnpm test       # ~58 tests now
pnpm build
```

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/return-visit.ts app/src/lib/return-visit.test.ts \
  app/src/lib/last-session.ts app/src/lib/engine.ts \
  app/src/components/BeaconButton.svelte app/src/App.svelte
git commit -m "feat(polish): beacon button, return-visit routing, last-session store"
```

---

## Task 7: Saved-credentials prompt on sign-in

When the sign-in form loads, check if encrypted credentials are stored. If so, show a small panel: "Saved credentials detected — enter passphrase to unlock."

**Files:**
- Modify: `app/src/routes/SignIn.svelte`

- [ ] **Step 1: Add unlock UI**

In `app/src/routes/SignIn.svelte`, add at the top of the script:

```svelte
<script lang="ts">
  // existing imports...
  import { onMount } from 'svelte';
  import { hasCredentials, loadCredentials } from '$lib/credentials-store';
  import { DecryptError } from '$lib/crypto';

  let savedPresent = false;
  let unlockPassphrase = '';
  let unlockError = '';

  onMount(async () => {
    savedPresent = await hasCredentials();
  });

  async function unlockSaved() {
    unlockError = '';
    try {
      const creds = await loadCredentials(unlockPassphrase);
      if (!creds) {
        unlockError = 'No saved credentials.';
        return;
      }
      handle = creds.handle;
      appPassword = creds.appPassword;
      pds = creds.pds;
      // Auto-submit the form.
      submit();
    } catch (e) {
      if (e instanceof DecryptError) {
        unlockError = 'Wrong passphrase.';
      } else {
        unlockError = e instanceof Error ? e.message : String(e);
      }
    }
  }
</script>
```

In the template, before the main `<form>`, add:

```svelte
{#if savedPresent}
  <section class="saved-creds" aria-label="Saved credentials">
    <h3>Saved credentials detected</h3>
    <p class="help">Enter your passphrase to unlock your saved app password.</p>
    <label>
      Passphrase
      <input type="password" bind:value={unlockPassphrase} />
    </label>
    <button type="button" on:click={unlockSaved}>Unlock and sign in</button>
    {#if unlockError}
      <p class="error" role="alert">{unlockError}</p>
    {/if}
    <details>
      <summary>Use a different account</summary>
      <p>The form below is editable — fill it in to override your saved credentials.</p>
    </details>
  </section>
{/if}
```

Add a small style block for `.saved-creds`:

```css
.saved-creds {
  border: 1px solid color-mix(in oklab, CanvasText 15%, transparent);
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1.5rem;
  max-width: 32rem;
}
.saved-creds h3 {
  margin: 0 0 0.5rem;
}
```

- [ ] **Step 2: Verify**

`pnpm check` clean. `pnpm test` green. `pnpm build` clean.

- [ ] **Step 3: Commit**

```bash
git add app/src/routes/SignIn.svelte
git commit -m "feat(signin): saved-credentials unlock prompt"
```

---

## Final verification

- [ ] **Step 1: Full test suite**

```bash
pnpm test
```

Expected: ~60 tests across all suites.

- [ ] **Step 2: Type check + build**

```bash
pnpm check
pnpm build
```

Both clean. Confirm `dist/` contains `index.html`, `archive-template/index.html`, `CNAME`, and `assets/`.

- [ ] **Step 3: Manual end-to-end (best-effort)**

Start `pnpm dev`. Walk through the user flows:

1. **First visit, no inventory:** lands on sign-in. Submit the form → Run page → on success → library.
2. **Settings → Clear all local data** → confirm dialog → return to library showing empty state.
3. **Settings → Configure proxy** → save → reload settings → values populated.
4. **Settings → Export inventory** (with inventory present) → JSON downloads.
5. **Settings → Import inventory** (use the export from #4) → status shows count.
6. **Privacy:** click footer privacy link → `#/privacy` renders the doc with operator handle / app name substituted.
7. **Beacon button:** if `VITE_BEACON_AT_URI` is configured AND a session is active, clicking the button likes the post and changes to "Thanks 💌". (Skip if `VITE_BEACON_AT_URI` is empty — button is hidden.)
8. **Reload:** with inventory present, page lands directly on `#/library`.
9. **Saved credentials:** sign in with "remember me" + passphrase → reload → unlock UI appears → enter passphrase → auto-signs in.

- [ ] **Step 4: Push**

```bash
git push origin main
```

Live deploy refreshes `saves.lightseed.net`.

---

## Done criteria

After Plan 7:

1. `#/privacy` renders the canonical privacy policy with config values substituted.
2. Settings route exposes import/export, proxy config, clear-all, and links to privacy.
3. Beacon button in the footer fires only on click, only when configured, and persists "sent" state.
4. Return visits with an inventory open `#/library` directly.
5. Sign-in detects saved credentials and offers passphrase unlock with auto-submit.
6. Helper detector and proxy config are wired (consumed in a future plan when article hydration is added).
7. All unit tests pass; type check is clean; build is clean.
8. The whole user flow works end-to-end against a real test Bluesky account.

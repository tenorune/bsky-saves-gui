# Plan 8: "Image backup enabled" preference + Settings → Backup section

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Close two remaining usability gaps:

1. After a user starts image backup once, the banner stops re-showing on reload (instead of waiting on the 7-day snooze).
2. Settings gets a Backup section so the user can see current state, disable backup, manage the don't-ask preference, and (under Advanced) configure a custom Cloudflare Worker.

**Architecture:** Three small steps, each isolated:
1. Extend `backup-prefs` with an `enabled: boolean` per-feature flag and a `setBackupEnabled` writer. `shouldShowBackupBanner` returns false when `enabled` is true.
2. `start-image-backup` calls `setBackupEnabled('images', true)` on successful start (fire and forget — banner suppression is a side-effect, not a precondition).
3. New conditional Backup section in `Settings.svelte` — appears once any pref differs from default. Per-feature status row, "Disable" button, "Don't ask me about image backup" toggle, Advanced disclosure with custom-worker URL + secret form (re-introducing the proxy-config UI we removed in Plan 1).

**Out of scope (later plans):**
- Article-backup row (Plan 9+).
- Setup wizard modal (Plan 9+).
- PostFocus backup footer (Plan 9+).
- Show Details modal (Plan 9+).
- "Test connection" button under Advanced (Plan 9+).

**Tech Stack:** Svelte 4, TypeScript 5, Vitest 2. No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-05-04-hydration-and-backup-ux-design.md` — section "Settings page" describes the conditional Backup section, the Advanced disclosure, and the "Don't ask me about" toggles.

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `3d75efe` (Plan 7 final commit) or later.

---

## Task 1: Extend `backup-prefs` with an `enabled` flag

`FeaturePrefs` gets a third boolean: `enabled`. New writer `setBackupEnabled(feature, bool)`. `shouldShowBackupBanner` is updated to return `false` when `enabled` is true (the user has opted in; no need to nudge).

**Files:**
- Modify: `app/src/lib/backup-prefs.ts`
- Modify: `app/src/lib/backup-prefs.test.ts`

- [ ] **Step 1: Extend the interface and DEFAULTS in `backup-prefs.ts`**

Open `app/src/lib/backup-prefs.ts`. Update the `FeaturePrefs` interface to include `enabled`:

```ts
export interface FeaturePrefs {
  readonly snoozeUntil: number | null; // epoch ms; null means never snoozed
  readonly dontAsk: boolean;
  readonly enabled: boolean;
}
```

Update the `DEFAULTS` constant:

```ts
const DEFAULTS: BackupPrefs = Object.freeze({
  images: { snoozeUntil: null, dontAsk: false, enabled: false },
  articles: { snoozeUntil: null, dontAsk: false, enabled: false },
});
```

Update the `isFeaturePrefs` type guard:

```ts
function isFeaturePrefs(v: unknown): v is FeaturePrefs {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    (r.snoozeUntil === null || typeof r.snoozeUntil === 'number') &&
    typeof r.dontAsk === 'boolean' &&
    typeof r.enabled === 'boolean'
  );
}
```

- [ ] **Step 2: Add `setBackupEnabled` writer**

Below the existing `setBackupDontAsk` function, add:

```ts
export async function setBackupEnabled(
  feature: BackupFeature,
  enabled: boolean,
): Promise<void> {
  const prefs = await loadBackupPrefs();
  const next: BackupPrefs = {
    ...prefs,
    [feature]: { ...prefs[feature], enabled },
  };
  await saveBackupPrefs(next);
}
```

- [ ] **Step 3: Update `shouldShowBackupBanner` to suppress when enabled**

Replace the existing function body:

```ts
export async function shouldShowBackupBanner(feature: BackupFeature): Promise<boolean> {
  const prefs = await loadBackupPrefs();
  const f = prefs[feature];
  if (f.dontAsk) return false;
  if (f.enabled) return false;
  if (f.snoozeUntil !== null && Date.now() < f.snoozeUntil) return false;
  return true;
}
```

- [ ] **Step 4: Update existing tests for the new `enabled` field**

Open `app/src/lib/backup-prefs.test.ts`. Update the "returns defaults" test to include `enabled: false` in the expected shape:

```ts
it('returns defaults when nothing is set', async () => {
  const { loadBackupPrefs } = await import('./backup-prefs');
  expect(await loadBackupPrefs()).toEqual({
    images: { snoozeUntil: null, dontAsk: false, enabled: false },
    articles: { snoozeUntil: null, dontAsk: false, enabled: false },
  });
});
```

- [ ] **Step 5: Add new tests for `setBackupEnabled` and the suppression behavior**

Append the following tests inside the existing `describe('backup-prefs', ...)` block, BEFORE its closing `});`:

```ts
  it('setBackupEnabled persists and round-trips', async () => {
    const { setBackupEnabled, loadBackupPrefs } = await import('./backup-prefs');
    await setBackupEnabled('images', true);
    expect((await loadBackupPrefs()).images.enabled).toBe(true);
    await setBackupEnabled('images', false);
    expect((await loadBackupPrefs()).images.enabled).toBe(false);
  });

  it('shouldShowBackupBanner is false when enabled is true (even without snooze)', async () => {
    const { setBackupEnabled, shouldShowBackupBanner } = await import('./backup-prefs');
    await setBackupEnabled('images', true);
    expect(await shouldShowBackupBanner('images')).toBe(false);
  });

  it('enabled does not affect the OTHER feature', async () => {
    const { setBackupEnabled, shouldShowBackupBanner } = await import('./backup-prefs');
    await setBackupEnabled('images', true);
    expect(await shouldShowBackupBanner('articles')).toBe(true);
  });
```

- [ ] **Step 6: Run tests**

Run: `pnpm test backup-prefs`

Expected: all tests passing (was 7; now 10).

- [ ] **Step 7: Run full type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 errors. Total goes 122 → 125.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(backup-prefs): add enabled flag; suppress banner when enabled"
```

DO NOT push.

---

## Task 2: `start-image-backup` flips the enabled flag on successful start

Wire the engine to set `enabled = true` for images on the first successful run. This is fire-and-forget — the start path doesn't need to wait for the IDB write.

**Files:**
- Modify: `app/src/lib/start-image-backup.ts`
- Modify: `app/src/lib/start-image-backup.test.ts`

- [ ] **Step 1: Add the test**

Append a test to `app/src/lib/start-image-backup.test.ts` inside the existing `describe('startImageBackup', ...)` block, BEFORE its closing `});`:

```ts
  it('sets backup-prefs.images.enabled = true on successful start', async () => {
    let pingCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        pingCalls++;
        if (pingCalls === 1) return okPing;
        return {
          ok: true,
          headers: { get: () => 'image/png' },
          blob: async () => new Blob(['IMG'], { type: 'image/png' }),
        };
      }),
    );
    const { startImageBackup } = await import('./start-image-backup');
    const { loadBackupPrefs } = await import('./backup-prefs');

    const result = await startImageBackup({
      saves: [{ images: [{ url: 'https://x/1.jpg' }] }],
    });
    expect(result.started).toBe(true);

    // Wait long enough for the fire-and-forget enable write to land.
    await vi.waitUntil(async () => (await loadBackupPrefs()).images.enabled, { timeout: 1000 });
    expect((await loadBackupPrefs()).images.enabled).toBe(true);
  });

  it('does NOT flip enabled when started is false (no backend)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { startImageBackup } = await import('./start-image-backup');
    const { loadBackupPrefs } = await import('./backup-prefs');

    const result = await startImageBackup({ saves: [{ images: [{ url: 'https://x/1.jpg' }] }] });
    expect(result.started).toBe(false);
    expect((await loadBackupPrefs()).images.enabled).toBe(false);
  });
```

Also extend the existing `beforeEach` block at the top of the file to clear backup-prefs:

```ts
beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.resetModules();
  const { clearImageBlobs } = await import('./image-store');
  await clearImageBlobs();
  const { clearProxyConfig } = await import('./proxy-config');
  await clearProxyConfig();
  const { resetImageHydration } = await import('./hydration-state');
  resetImageHydration();
  const { clearBackupPrefs } = await import('./backup-prefs');
  await clearBackupPrefs();
});
```

- [ ] **Step 2: Run tests — confirm new tests fail**

Run: `pnpm test start-image-backup`

Expected: at least the "sets enabled" test fails because nothing flips the flag yet.

- [ ] **Step 3: Wire `setBackupEnabled` into `startImageBackup` on success**

Edit `app/src/lib/start-image-backup.ts`. Add the import at the top:

```ts
import { setBackupEnabled } from './backup-prefs';
```

Inside `startImageBackup`, after the `activeController = controller;` line and before the `void hydrateImages(...)` call, add a fire-and-forget enable write:

```ts
  // Mark images as enabled so the discovery banner stops re-showing.
  // Fire-and-forget: a slow IDB write shouldn't delay starting the run.
  void setBackupEnabled('images', true);
```

- [ ] **Step 4: Run tests — confirm both new tests pass**

Run: `pnpm test start-image-backup`

Expected: 6/6 passing (was 4; now 6).

- [ ] **Step 5: Run full type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 errors. Total goes 125 → 127.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(start-image-backup): mark images backup enabled on first successful start"
```

DO NOT push.

---

## Task 3: Backup section in Settings

Add a conditional Backup section between the Library and Reset sections. Visible iff any pref differs from default. Contents:

- Per-feature (images only in this plan) status row showing current state with a Disable / Set up button.
- "Don't ask me about image backup" checkbox.
- Advanced disclosure with custom-worker URL + secret form (re-introducing the proxy-config UI).

**Files:**
- Modify: `app/src/routes/Settings.svelte`

- [ ] **Step 1: Extend imports**

Open `app/src/routes/Settings.svelte`. Add these imports at the top of the `<script>` block, after the existing ones:

```ts
import { onMount } from 'svelte';
import {
  loadBackupPrefs,
  setBackupDontAsk,
  setBackupEnabled,
  type BackupPrefs,
} from '$lib/backup-prefs';
import { detectBackends, type Backend } from '$lib/image-fetcher';
import { cancelImageBackup } from '$lib/start-image-backup';
import { loadProxyConfig, saveProxyConfig, clearProxyConfig, type ProxyConfig } from '$lib/proxy-config';
```

(Note: this re-adds `onMount`, `loadProxyConfig`, `saveProxyConfig`, and `ProxyConfig` — all dropped from Settings in Plan 1.)

- [ ] **Step 2: Add state and load logic**

In the `<script>` block, add state declarations and an `onMount` hook below the existing `let importInputEl` declaration:

```ts
  let backupPrefs: BackupPrefs | null = null;
  let detectedBackends: Backend[] = [];
  let backupAdvancedOpen = false;
  let workerUrl = '';
  let workerSecret = '';

  onMount(async () => {
    backupPrefs = await loadBackupPrefs();
    detectedBackends = await detectBackends();
    const cfg = await loadProxyConfig();
    if (cfg) {
      workerUrl = cfg.url;
      workerSecret = cfg.sharedSecret;
    }
  });

  $: imagesEnabled = backupPrefs?.images.enabled ?? false;
  $: imagesDontAsk = backupPrefs?.images.dontAsk ?? false;
  $: backupSectionVisible =
    imagesEnabled ||
    imagesDontAsk ||
    (backupPrefs?.images.snoozeUntil ?? null) !== null;
  $: helperBackend = detectedBackends.find((b) => b.kind === 'helper');
  $: workerBackend = detectedBackends.find((b) => b.kind === 'user-worker');
  $: imagesBackendLabel = imagesEnabled
    ? helperBackend
      ? `using local helper (bsky-saves ${helperBackend.version})`
      : workerBackend
        ? 'using your custom Cloudflare Worker'
        : 'no backend reachable right now'
    : 'not set up';

  async function reloadBackupPrefs() {
    backupPrefs = await loadBackupPrefs();
  }

  async function handleDisableImages() {
    cancelImageBackup();
    await setBackupEnabled('images', false);
    await reloadBackupPrefs();
  }

  async function handleToggleDontAsk(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    await setBackupDontAsk('images', checked);
    await reloadBackupPrefs();
  }

  async function handleSaveWorker() {
    if (!workerUrl || !workerSecret) return;
    await saveProxyConfig({ url: workerUrl, sharedSecret: workerSecret });
    detectedBackends = await detectBackends();
    status = 'Worker config saved.';
  }

  async function handleClearWorker() {
    await clearProxyConfig();
    workerUrl = '';
    workerSecret = '';
    detectedBackends = await detectBackends();
    status = 'Worker config cleared.';
  }
```

- [ ] **Step 3: Render the Backup section between Library and Reset**

In the template, find the closing `</section>` of the Library section (the one whose `<h3>` is "Library") and the opening of the Reset section (whose `<h3>` is "Reset"). Insert the new Backup section between them:

```svelte
  {#if backupSectionVisible}
    <section class="settings-section">
      <h3>Backup</h3>
      <p class="help">
        Save your own copy of images so they keep showing up even if Bluesky
        changes. Articles will be added in a future update.
      </p>

      <div class="settings-row">
        <strong>Images:</strong>
        <span>{imagesBackendLabel}</span>
        {#if imagesEnabled}
          <button type="button" on:click={handleDisableImages}>Disable</button>
        {/if}
      </div>

      <label class="checkbox">
        <input
          type="checkbox"
          checked={imagesDontAsk}
          on:change={handleToggleDontAsk}
        />
        <span>Don't ask me about image backup</span>
      </label>

      <details
        class="advanced-toggle"
        bind:open={backupAdvancedOpen}
      >
        <summary>Advanced backup options</summary>

        <p class="help">
          Custom Cloudflare Worker proxy. Used as a fallback when no local helper
          is running. See <code>templates/cf-worker/</code> in the project repo
          for how to deploy your own.
        </p>

        <label>
          Proxy URL
          <input
            type="url"
            bind:value={workerUrl}
            placeholder="https://your-worker.workers.dev"
          />
        </label>
        <label>
          Shared secret
          <input type="password" bind:value={workerSecret} />
        </label>
        <div class="settings-row">
          <button type="button" on:click={handleSaveWorker}>Save</button>
          <button type="button" on:click={handleClearWorker}>Clear</button>
        </div>
      </details>
    </section>
  {/if}
```

This goes RIGHT BEFORE the existing Reset section (`<h3>Reset</h3>`).

- [ ] **Step 4: Verify the existing CSS rules cover the form inputs**

In Plan 1 we kept the `.settings-section label` and `.settings-section input[type='url'|'password']` rules with a "retained for Plan 2" comment. The `details summary` styling is also already present from a prior plan. No new CSS rules required — but since the Plan 1 retention comment said "Plan 2," update the comment to reflect that these are now in active use.

Find this in the `<style>` block:

```css
  /* Retained for Plan 2 — Backup → Advanced reintroduces the URL/secret form. */
  .settings-section label {
```

…and change the comment to:

```css
  /* Used by Backup → Advanced (URL/secret form). */
  .settings-section label {
```

After this, the `pnpm check` warnings about "unused CSS selector" for those three rules should go away.

- [ ] **Step 5: Run check + tests + build**

Run: `pnpm check && pnpm test && pnpm build`

Expected: **0 warnings now** (the three retained-CSS warnings should be gone since the rules are matching the newly-added Advanced form). 0 errors. All 127 tests still pass. Both bundles build.

If any new warnings appear (e.g., the `.help code` selector being unused), they're acceptable — note them in your report.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(settings): conditional Backup section with status, disable, dont-ask, advanced"
```

DO NOT push.

---

## Final verification

- [ ] **Step 1: Run check + test + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 type errors, 0 (or near 0) warnings. All ~127 tests pass. Both bundles build.

- [ ] **Step 2: Push**

```bash
git push origin main
```

---

## What's next

After Plan 8, the user-visible image-backup loop is fully closed:

- Banner shows up on first applicable Library load → clicked → Settings shows Backup section → user sees state, can disable, can manage prefs, can configure custom worker.
- Reload no longer re-shows the banner (`enabled` flag suppresses it).
- "Don't ask me again" mirrors as a checkbox in Settings (and clears it re-enables prompts on next applicable visit).

Plan 9 candidates, each tightly scoped:
- **Setup wizard modal** — banner button currently fails with a raw error message when no backend; the wizard walks A-tier users through helper install / worker config.
- **PostFocus backup footer** — per-post status indicator under each post.
- **Show Details modal** — failures listed with permalinks + reasons, triggered from `BackupStatusRow` when failures > 0.
- **Article backup** — extend Plans 2-8 patterns to article hydration (`extract-article` endpoint, separate banner + status row, etc.).

# Plan 17: Setup-modal refinements + worker.js comment fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Polish the setup-modal flow per user feedback:

1. Fix the misleading `worker.js` header comment that says "for article hydration" (the cf-worker template handles images; articles still go through the helper).
2. Add a "step 0" to the modal pointing CLI users at the README.
3. Move the Proxy URL + Shared secret form into the modal (out of the inline Advanced disclosure) so the whole setup flow is in one place.
4. Rename the "Setup guide" trigger button to "Edit setup" when a custom proxy is already configured.

**Architecture:**

- **`worker.js` text edit.** Two-line tweak.
- **`CustomProxySetupModal.svelte`** gains:
  - A "step 0" prepended with a link to the cf-worker README on GitHub.
  - The Proxy URL + Shared secret form (loaded from `proxy-config` on mount), with Save/Clear handlers that dispatch a `change` event.
- **`Settings.svelte`**:
  - Removes the inline form and the `workerUrl` / `workerSecret` state, plus `handleSaveWorker` / `handleClearWorker`.
  - Adds a `customProxyConfigured` reactive that's true when `loadProxyConfig` returns a populated config.
  - The setup-guide trigger button text reads "Edit setup" when configured, "Setup guide" when not.
  - Subscribes to the modal's `change` event to refresh `detectedBackends` and `availableImageBackendDesc`.

**Out of scope:**
- Validating the worker URL/secret before save (no test-connection button).
- Making the modal more accessible (focus trap, etc.).
- The article-button confusion (separate plan).
- cf-worker article-extraction support (Plan 20+).

**Tech Stack:** Svelte 4. No new dependencies.

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `89ef31f` (Plan 16 final commit) or later.

---

## Task 1: `worker.js` header-comment fix

**Files:**
- Modify: `templates/cf-worker/worker.js`

- [ ] **Step 1: Update the top-of-file comment**

Open `templates/cf-worker/worker.js`. The current header reads:

```js
// Cloudflare Worker — CORS proxy for bsky-saves-gui article hydration.
// Deploy instructions: see README.md in this directory.
```

Replace those two lines with:

```js
// Cloudflare Worker — CORS proxy for bsky-saves-gui image backup.
// User-deployed (via the in-app setup guide) or operator-deployed.
```

(Article extraction is helper-only in v1; the cf-worker only handles image fetching. Removing the README pointer is per user request — the GUI's setup guide is now the canonical doc, and the README is still discoverable from the project repo for CLI deployers.)

- [ ] **Step 2: Run check + tests + build**

Run: `pnpm check && pnpm test && pnpm build`

Expected: 0 errors, 0 warnings, 164/164 tests pass.

This change affects the embedded worker source in `CustomProxySetupModal.svelte` (because Vite's `?raw` import re-bundles on file changes), so the modal will show the corrected comment after this commit.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "fix(cf-worker): correct header comment (image backup, not article hydration)"
```

DO NOT push.

---

## Task 2: Modal gains step 0 + URL/Secret form

The modal becomes the single place to manage custom-proxy config. Step 0 points CLI users at the README. The URL/Secret form (currently inline in Settings) moves to the bottom of the modal.

**Files:**
- Modify: `app/src/components/CustomProxySetupModal.svelte`

- [ ] **Step 1: Extend imports and state**

In `CustomProxySetupModal.svelte`'s `<script>` block, add after the existing imports:

```ts
import { onMount } from 'svelte';
import { loadProxyConfig, saveProxyConfig, clearProxyConfig } from '$lib/proxy-config';
```

Add state near the existing declarations:

```ts
  let workerUrl = '';
  let workerSecret = '';
  let saveStatus = '';

  onMount(async () => {
    const cfg = await loadProxyConfig();
    if (cfg) {
      workerUrl = cfg.url;
      workerSecret = cfg.sharedSecret;
    }
  });

  async function handleSaveWorker() {
    if (!workerUrl || !workerSecret) {
      saveStatus = 'Both URL and shared secret are required.';
      return;
    }
    await saveProxyConfig({ url: workerUrl, sharedSecret: workerSecret });
    saveStatus = 'Saved.';
    dispatch('change');
  }

  async function handleClearWorker() {
    await clearProxyConfig();
    workerUrl = '';
    workerSecret = '';
    saveStatus = 'Cleared.';
    dispatch('change');
  }
```

Update the existing `dispatch` typing to also include `change`:

Find:
```ts
const dispatch = createEventDispatcher<{ close: void }>();
```

Replace with:
```ts
const dispatch = createEventDispatcher<{ close: void; change: void }>();
```

- [ ] **Step 2: Add step 0 above the existing `<ol>`**

In the modal template, find the `<ol class="modal__steps">` block. ABOVE it (between the `</header>` and the `<ol>`), insert:

```svelte
      <p class="modal__step0">
        <strong>Prefer the command line?</strong>
        See the
        <a
          href="https://github.com/tenorune/bsky-saves-gui/blob/main/templates/cf-worker/README.md"
          target="_blank"
          rel="noopener noreferrer"
        >cf-worker README</a>
        for <code>wrangler deploy</code> instructions.
      </p>
```

- [ ] **Step 3: Replace step 6 with the embedded form**

The current step 6 says "Paste below". Replace its `<li>` content with the actual form:

Find the existing step 6:

```svelte
        <li>
          <strong>Paste below.</strong>
          Put the URL into <em>Proxy URL</em> and the same hex string into
          <em>Shared secret</em>. Click Save.
        </li>
```

Replace with:

```svelte
        <li>
          <strong>Paste here.</strong>
          Put the URL into <em>Proxy URL</em> and the same hex string into
          <em>Shared secret</em>. Click Save.
          <div class="modal__form">
            <label class="modal__field">
              Proxy URL
              <input type="url" bind:value={workerUrl} placeholder="https://your-worker.workers.dev" />
            </label>
            <label class="modal__field">
              Shared secret
              <input type="password" bind:value={workerSecret} />
            </label>
            <div class="modal__form-actions">
              <button type="button" on:click={handleSaveWorker}>Save</button>
              <button type="button" on:click={handleClearWorker}>Clear</button>
              {#if saveStatus}<span class="modal__form-status">{saveStatus}</span>{/if}
            </div>
          </div>
        </li>
```

- [ ] **Step 4: Add CSS for step 0 and the form**

Inside the modal's `<style>` block (after the existing `.modal__codeblock` rules), add:

```css
  .modal__step0 {
    margin: 0 0 0.75rem;
    padding: 0.5rem 0.75rem;
    background: color-mix(in oklab, CanvasText 4%, Canvas);
    border-radius: 6px;
    font-size: 0.85rem;
  }
  .modal__form {
    margin-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .modal__field {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.85rem;
    font-weight: 500;
  }
  .modal__field input {
    font: inherit;
    padding: 0.4rem 0.6rem;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 4px;
    background: Canvas;
    color: CanvasText;
  }
  .modal__form-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .modal__form-actions button {
    font: inherit;
    padding: 0.35rem 0.85rem;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 4px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
  }
  .modal__form-status {
    font-size: 0.85rem;
    opacity: 0.8;
  }
```

- [ ] **Step 5: Run check + tests + build**

Run: `pnpm check && pnpm test && pnpm build`

Expected: 0 errors, 0 warnings, 164/164 tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(setup-modal): step 0 (CLI alt link); embedded URL/secret form"
```

DO NOT push.

---

## Task 3: Settings updates — remove inline form; rename trigger when configured

**Files:**
- Modify: `app/src/routes/Settings.svelte`

- [ ] **Step 1: Add `customProxyConfigured` reactive state**

In `Settings.svelte`'s `<script>` block, near the existing `let workerUrl = '';` and `workerSecret = '';` (which we'll delete in step 3), add:

```ts
  let customProxyConfigured = false;

  async function refreshCustomProxyStatus(): Promise<void> {
    const cfg = await loadProxyConfig();
    customProxyConfigured = cfg !== null && cfg.url !== '' && cfg.sharedSecret !== '';
  }

  async function handleSetupModalChange(): Promise<void> {
    await refreshCustomProxyStatus();
    detectedBackends = await detectBackends();
    availableImageBackendDesc = await describeAvailableImageBackend();
  }
```

In the existing `onMount`, add a call to `refreshCustomProxyStatus()` (after `articleBackendStatus = await describeArticleBackend();`):

```ts
    await refreshCustomProxyStatus();
```

- [ ] **Step 2: Update the modal mount to subscribe to change**

Find the existing modal mount:

```svelte
  <CustomProxySetupModal open={setupModalOpen} on:close={() => (setupModalOpen = false)} />
```

Replace with:

```svelte
  <CustomProxySetupModal
    open={setupModalOpen}
    on:close={() => (setupModalOpen = false)}
    on:change={handleSetupModalChange}
  />
```

- [ ] **Step 3: Remove the inline form, state, handlers, and CSS**

In the `<script>` block:

(a) Delete these state declarations:

```ts
  let workerUrl = '';
  let workerSecret = '';
```

(b) Delete the `handleSaveWorker` and `handleClearWorker` functions.

(c) In `onMount`, remove the lines that load the proxy config into `workerUrl` / `workerSecret`:

```ts
    const cfg = await loadProxyConfig();
    if (cfg) {
      workerUrl = cfg.url;
      workerSecret = cfg.sharedSecret;
    }
```

In the template, find the existing form inside the Advanced disclosure (the section with `<label>Proxy URL</label>`, `<label>Shared secret</label>`, and the `<div class="settings-row">` with Save/Clear buttons). DELETE the entire form — keep only the help paragraph above it and the new "Setup guide" button.

In the `<style>` block, remove the `.settings-section input[type='url']` and `.settings-section input[type='password']` rules (and the `/* Used by Backup → Advanced (URL/secret form). */` comment), AND the `.settings-section label` rule UNLESS it's still in use elsewhere — check by running `pnpm check` after the deletion to see if any unused-CSS warnings appear. The label rule MAY still be needed for other inputs in Settings; leave it if `pnpm check` doesn't flag it as unused.

- [ ] **Step 4: Update the trigger button text**

Find the existing button:

```svelte
        <button type="button" class="setup-guide-trigger" on:click={() => (setupModalOpen = true)}>
          Setup guide
        </button>
```

Replace with:

```svelte
        <button type="button" class="setup-guide-trigger" on:click={() => (setupModalOpen = true)}>
          {customProxyConfigured ? 'Edit setup' : 'Setup guide'}
        </button>
```

- [ ] **Step 5: Run check + tests + build**

Run: `pnpm check && pnpm test && pnpm build`

Expected: 0 errors. Possible WARNINGS for newly-unused CSS selectors — if any appear in `Settings.svelte`, delete those CSS rules until warnings clear.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(settings): URL/secret form moves to modal; trigger says 'Edit setup' when configured"
```

DO NOT push.

---

## Final verification

- [ ] **Step 1: Run check + test + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 type errors, 0 warnings. 164/164 tests pass.

- [ ] **Step 2: Push**

```bash
git push origin main
```

---

## What's next

After Plan 17, the custom-proxy setup is fully self-contained inside the modal: setup steps + form fields. The Advanced disclosure becomes minimal (just the help paragraph and the "Setup guide" / "Edit setup" trigger button + the operator-proxy info panel).

Remaining queue:
- **Plan 18**: clarify the article "Set up backup" / "Set up article backup" button (label says "Set up" but the click immediately starts hydration — confusing).
- **Plan 19**: Show Details modal for backup failures.
- **Plan 20**: Banner sequencing (image first, article waits).
- **Plan 21**: PostFocus per-post backup status footer.
- **Plan 22**: cf-worker article extraction endpoint (Mozilla Readability).

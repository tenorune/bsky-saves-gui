# Plan 16: Setup guide as modal with copy-to-clipboard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Replace the inline `<details>` setup guide (Plan 15) with a modal that opens when the user clicks a "Setup guide" button. Each code block in the guide gets a copy-to-clipboard icon. The worker source is embedded directly in the modal (loaded at build time via Vite's `?raw` import) so users don't need to open another browser tab to fetch it from GitHub.

Plus the user-requested copy edits to steps 2 and 3.

**Architecture:**

1. **`CopyButton.svelte`** — small reusable component that takes a `text` prop, renders a small icon-button, copies to clipboard via `navigator.clipboard.writeText` on click, and shows transient "Copied" feedback.
2. **`CustomProxySetupModal.svelte`** — modal with the six setup steps. Worker source loaded at build time as `import workerSource from '../../templates/cf-worker/worker.js?raw'`. ESC and backdrop-click close. Focus management is nice-to-have but not strictly required for v1.
3. **`Settings.svelte` update** — remove the inline `<details class="setup-guide">` block (and its CSS) added by Plan 15. Replace with a "Setup guide" button that opens the new modal.

**Out of scope:**
- Full ARIA modal compliance (focus trap, role=dialog) — get it shipping first; refine if accessibility issues surface.
- Animations on modal open/close.
- Saving "I've completed setup" preference.

**Tech Stack:** Svelte 4. Vite's `?raw` import (already supported by the existing build; no config change needed). `navigator.clipboard.writeText` (browser API, available in all modern browsers).

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `d7fd251` (Plan 15 commit) or later.

---

## Task 1: `CopyButton.svelte` component

Reusable copy-to-clipboard icon-button. Renders an SVG copy icon by default; flips to a checkmark for ~1.5s after a successful copy.

**Files:**
- Create: `app/src/components/CopyButton.svelte`

- [ ] **Step 1: Implement the component**

Create `app/src/components/CopyButton.svelte`:

```svelte
<script lang="ts">
  /** The text to copy to the clipboard. */
  export let text: string;
  /** Optional accessible label. Default: "Copy". */
  export let label: string = 'Copy';

  let copied = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        copied = false;
        timeoutId = null;
      }, 1500);
    } catch {
      // Older browsers without clipboard API; ignore.
    }
  }
</script>

<button
  type="button"
  class="copy-button"
  on:click={handleClick}
  aria-label={copied ? 'Copied' : label}
  title={copied ? 'Copied' : label}
>
  {#if copied}
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  {:else}
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  {/if}
</button>

<style>
  .copy-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    padding: 0;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 4px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.15s ease;
  }
  .copy-button:hover,
  .copy-button:focus-visible {
    opacity: 1;
  }
</style>
```

- [ ] **Step 2: Verify type check**

Run: `pnpm check`

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(CopyButton): copy-to-clipboard icon component with transient feedback"
```

DO NOT push.

---

## Task 2: `CustomProxySetupModal.svelte` component

Modal containing the six setup steps. Worker source embedded inline via `?raw` import. Each pre-formatted code block has a `<CopyButton>` in its top-right corner.

**Files:**
- Create: `app/src/components/CustomProxySetupModal.svelte`

- [ ] **Step 1: Implement the modal**

Create `app/src/components/CustomProxySetupModal.svelte`:

```svelte
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import CopyButton from './CopyButton.svelte';
  // The cf-worker source, loaded at build time. The `?raw` suffix is a Vite
  // feature that bundles the file content as a string. Path is relative to
  // this file (app/src/components/) → up two → into templates/cf-worker.
  import workerSource from '../../../templates/cf-worker/worker.js?raw';

  export let open = false;

  const dispatch = createEventDispatcher<{ close: void }>();

  const SECRET_GEN = `crypto.getRandomValues(new Uint8Array(32)).reduce((a,b)=>a+b.toString(16).padStart(2,'0'),'')`;

  $: allowedOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  function close() {
    dispatch('close');
  }

  function onBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) close();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (open && event.key === 'Escape') close();
  }
</script>

<svelte:window on:keydown={onKeyDown} />

{#if open}
  <div
    class="modal-backdrop"
    on:click={onBackdropClick}
    on:keydown|self
    role="presentation"
  >
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="setup-modal-title">
      <header class="modal__header">
        <h3 id="setup-modal-title" class="modal__title">
          Set up a custom Cloudflare Worker proxy
        </h3>
        <button type="button" class="modal__close" on:click={close} aria-label="Close">
          ✕
        </button>
      </header>

      <ol class="modal__steps">
        <li>
          <strong>Generate a shared secret.</strong>
          Open your browser's DevTools (F12 → Console). Paste this and press
          Enter:
          <div class="modal__codeblock">
            <pre>{SECRET_GEN}</pre>
            <CopyButton text={SECRET_GEN} label="Copy command" />
          </div>
          You'll get a 64-character hex string. Copy it — you'll paste it twice
          below.
        </li>

        <li>
          <strong>Create the worker on Cloudflare.</strong>
          Go to
          <a href="https://dash.cloudflare.com" target="_blank" rel="noopener noreferrer">dash.cloudflare.com</a>
          → Compute → Workers &amp; Pages → Create application → Start with
          Hello World! → Create Worker. Name it something like
          <code>bsky-saves-image-proxy</code>. Click <em>Deploy</em> to accept
          the placeholder.
        </li>

        <li>
          <strong>Paste the worker source.</strong>
          On the worker page click <em>Edit code</em>. Paste the following over
          the placeholder. Click <em>Deploy</em>.
          <div class="modal__codeblock modal__codeblock--scroll">
            <pre>{workerSource}</pre>
            <CopyButton text={workerSource} label="Copy worker source" />
          </div>
        </li>

        <li>
          <strong>Set environment variables.</strong>
          Worker page → Settings → Variables and Secrets:
          <ul>
            <li>
              Variable <code>ALLOWED_ORIGIN</code> = <code>{allowedOrigin}</code>
              <CopyButton text={allowedOrigin} label="Copy origin" />
            </li>
            <li>
              Secret <code>SHARED_SECRET</code> = the 64-character hex string
              from step 1
            </li>
          </ul>
        </li>

        <li>
          <strong>Copy the worker URL.</strong>
          It's at the top of the worker page, ending in
          <code>.workers.dev</code>. Test it by pasting
          <code>&lt;that URL&gt;/fetch</code> into a browser tab — you should
          see <code>{`{"error":"forbidden"}`}</code> with status 403. That
          means the worker is reachable.
        </li>

        <li>
          <strong>Paste below.</strong>
          Put the URL into <em>Proxy URL</em> and the same hex string into
          <em>Shared secret</em>. Click Save.
        </li>
      </ol>

      <footer class="modal__footer">
        <button type="button" on:click={close}>Done</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    z-index: 100;
  }
  .modal {
    max-width: 44rem;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    background: Canvas;
    color: CanvasText;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    padding: 1rem 1.25rem 1.25rem;
  }
  .modal__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }
  .modal__title {
    margin: 0;
    font-size: 1.05rem;
  }
  .modal__close {
    background: none;
    border: 0;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
    font-size: 1.1rem;
    color: inherit;
    opacity: 0.6;
  }
  .modal__close:hover {
    opacity: 1;
  }
  .modal__steps {
    margin: 0 0 0.5rem 1.25rem;
    padding: 0;
    font-size: 0.9rem;
    line-height: 1.55;
  }
  .modal__steps li {
    margin-bottom: 1rem;
  }
  .modal__steps ul {
    margin: 0.5rem 0 0 1rem;
    padding: 0;
  }
  .modal__codeblock {
    position: relative;
    margin: 0.5rem 0;
  }
  .modal__codeblock pre {
    margin: 0;
    padding: 0.6rem 2.5rem 0.6rem 0.75rem;
    background: color-mix(in oklab, CanvasText 8%, Canvas);
    border-radius: 4px;
    font-size: 0.8rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .modal__codeblock--scroll pre {
    max-height: 14rem;
    overflow: auto;
    word-break: normal;
    white-space: pre;
  }
  .modal__codeblock :global(.copy-button) {
    position: absolute;
    top: 0.4rem;
    right: 0.4rem;
  }
  .modal__steps li :global(.copy-button) {
    margin-left: 0.4rem;
    vertical-align: middle;
  }
  .modal__footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.5rem;
  }
  .modal__footer button {
    font: inherit;
    padding: 0.4rem 1rem;
    border: 1px solid color-mix(in oklab, CanvasText 25%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
  }
  a {
    color: inherit;
    text-decoration: underline;
  }
</style>
```

- [ ] **Step 2: Verify Vite supports the `?raw` import**

Run: `pnpm check`

Expected: 0 errors. If TypeScript complains about the `?raw` import, add a type declaration. The simplest path: append to `app/src/env.d.ts`:

```ts
declare module '*.js?raw' {
  const content: string;
  export default content;
}
```

(Existing module declarations are already in `env.d.ts`; reuse the file.)

Run `pnpm check` again — expected: 0 errors.

- [ ] **Step 3: Verify the build picks up the worker source**

Run: `pnpm build`

Expected: build succeeds. Bundle size grows by ~3 KB gzipped (the cf-worker source is ~6 KB raw, ~3 KB gzipped).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(CustomProxySetupModal): modal with embedded worker source + copy buttons"
```

DO NOT push.

---

## Task 3: Replace inline `<details>` in Settings with a modal trigger

**Files:**
- Modify: `app/src/routes/Settings.svelte`

- [ ] **Step 1: Add imports and modal state**

In `Settings.svelte`'s `<script>` block, after the existing component imports, add:

```ts
import CustomProxySetupModal from '../components/CustomProxySetupModal.svelte';
```

Add a state variable near the other `let` declarations:

```ts
  let setupModalOpen = false;
```

- [ ] **Step 2: Replace the inline `<details class="setup-guide">` block with a button**

In the template, find the entire `<details class="setup-guide">...</details>` block (added by Plan 15 inside the Advanced disclosure). Replace it with:

```svelte
        <button type="button" class="setup-guide-trigger" on:click={() => (setupModalOpen = true)}>
          Setup guide
        </button>
```

- [ ] **Step 3: Mount the modal at the end of the route's `<section>`**

Find the closing `</section>` of the outer `<section class="route route--settings">`. Add the modal immediately above it:

```svelte
  <CustomProxySetupModal open={setupModalOpen} on:close={() => (setupModalOpen = false)} />
</section>
```

- [ ] **Step 4: Remove the now-unused setup-guide CSS**

In the `<style>` block, find and DELETE these rules (they were added by Plan 15 and are no longer used):

- `.setup-guide`
- `.setup-guide summary`
- `.setup-guide__steps`
- `.setup-guide__steps li`
- `.setup-guide__steps li:last-child`
- `.setup-guide__steps ul`
- `.setup-guide__code`
- `.setup-guide a`

Add a small style for the new trigger button:

```css
  .setup-guide-trigger {
    font: inherit;
    padding: 0.35rem 0.75rem;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
    margin: 0.5rem 0;
  }
```

- [ ] **Step 5: Run check + tests + build**

Run: `pnpm check && pnpm test && pnpm build`

Expected: 0 errors, 0 warnings, 164/164 tests pass. Both bundles build.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(settings): open setup guide in modal instead of inline"
```

DO NOT push.

---

## Final verification

- [ ] **Step 1: Run check + test + build**

```bash
pnpm check && pnpm test && pnpm build
```

- [ ] **Step 2: Push**

```bash
git push origin main
```

---

## What's next

Plan 16 wraps up the user-deployed-proxy onboarding story. The remaining queued candidates:

- Plan 17: Show Details modal for backup failures.
- Plan 18: Banner sequencing (image first, article waits).
- Plan 19: PostFocus per-post backup status footer.
- Plan 20: cf-worker article extraction endpoint via Mozilla Readability.

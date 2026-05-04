# Plan 1: Settings restructure & toggle pruning

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up the GUI's Settings page and remove the redundant "Add precise dates" toggle, setting up a structural foundation for the backup features that follow in Plan 2.

**Architecture:** Tactical refactor — no new features, no new dependencies. Drop the `enrich` toggle wiring from both UI (SignIn, Refresh) and the engine pipeline (worker always runs enrich). Restructure Settings into the conditional sections defined by the design spec (Account / Library / Reset; Backup deferred to Plan 2). The Cloudflare Worker proxy UI is removed; the underlying `proxy-config.ts` module stays put (Plan 2 will re-introduce it under Backup → Advanced).

**Tech Stack:** Svelte 4, TypeScript 5, Vitest 2, Pyodide (untouched), idb-keyval (untouched).

**Spec reference:** `docs/superpowers/specs/2026-05-04-hydration-and-backup-ux-design.md` — sections "First-fetch flow" and "Settings page".

**Out of scope (Plan 2+):** Backup section, banners, setup wizard, hydration state, helper detection, Backup → Advanced (which re-introduces proxy fields). Article and image hydration loops. Status indicators on Library and PostFocus.

**Working directory:** `/home/user/bsky-saves-gui`. All commands assume cwd is repo root unless noted.

---

## Task 1: Always-on enrich (drop the toggle from types, worker, and UI)

The engine and worker take a per-call `enrich` flag. Remove it entirely; the worker will always run `bsky_saves.enrich.enrich_inventory`. Update tests first, watch them fail, then update code in lockstep so the codebase passes type-check and tests at the end.

This is one task with one commit because dropping `enrich` from `SignInDraft` would break `SignIn.svelte` / `Refresh.svelte` / `Run.svelte` until they're also cleaned up — splitting the work would leave a broken intermediate commit.

**Files:**
- Modify: `app/src/lib/engine.test.ts`
- Modify: `app/src/lib/pyodide-runner.test.ts`
- Modify: `app/src/lib/engine.ts`
- Modify: `app/src/lib/pyodide-runner.ts`
- Modify: `app/src/worker/pyodide-worker.ts`
- Modify: `app/src/lib/sign-in-draft.ts`
- Modify: `app/src/routes/SignIn.svelte`
- Modify: `app/src/routes/Refresh.svelte`
- Modify: `app/src/routes/Run.svelte`

- [ ] **Step 1: Remove `enrich` from `engine.test.ts` test inputs and `runFetch` expectations**

Open `app/src/lib/engine.test.ts`. There are three test cases. In each, find every line that passes `enrich:` to `runJob` or expects it on `runFetch`, and remove that line.

After editing, the password-mode test's input object should look like:

```ts
{
  mode: 'password',
  handle: 'alice.bsky.social',
  appPassword: 'pw',
  pds: 'https://bsky.social',
  fetch: true,
  threads: false,
}
```

…and its `expect(runFetch).toHaveBeenCalledWith(...)` should look like:

```ts
expect(runFetch).toHaveBeenCalledWith({
  handle: 'h',
  appPassword: 'pw',
  pds: 'https://bsky.social',
  fetch: true,
  threads: false,
  existingInventory: undefined,
  preauthSession: {
    accessJwt: session.accessJwt,
    refreshJwt: session.refreshJwt,
    did: session.did,
    handle: session.handle,
  },
});
```

Repeat for the session-mode test (drop `enrich: false,` line) and the failed-sign-in test (drop `enrich: false,` line).

- [ ] **Step 2: Remove `enrich` from `pyodide-runner.test.ts`**

Open `app/src/lib/pyodide-runner.test.ts`. There are two `runner.runFetch({...})` calls. Remove the `enrich:` line from each. Also remove the `enrich: true,` line from the `expect(fake.posted[1]).toMatchObject({...})` block in the first test.

After editing, the first test's runFetch call should be:

```ts
const inventory = await runner.runFetch({
  handle: 'alice.bsky.social',
  appPassword: 'pw',
  pds: 'https://bsky.social',
  fetch: true,
  threads: false,
});
```

- [ ] **Step 3: Run tests — confirm they fail**

Run: `pnpm test engine pyodide-runner`

Expected: failures. They may manifest as TypeScript errors (RunJobInput / FetchInput require `enrich`) or as `toHaveBeenCalledWith` assertion mismatches (received object still has `enrich`). Either confirms the tests describe the new behavior and the code hasn't caught up yet.

- [ ] **Step 4: Drop `enrich` from `RunJobOptionsCommon` and `RunnerFetchInput` in `engine.ts`**

Edit `app/src/lib/engine.ts`. Remove the `readonly enrich: boolean;` line from `RunJobOptionsCommon` and from `RunnerFetchInput`. Remove the `!input.enrich` clause from the empty-step guard. Remove `enrich: input.enrich,` from the `runner.runFetch({...})` call.

The interfaces become:

```ts
export interface RunJobOptionsCommon {
  readonly pds: string;
  readonly fetch: boolean;
  readonly threads: boolean;
}
```

```ts
interface RunnerFetchInput {
  readonly handle: string;
  readonly appPassword: string;
  readonly pds: string;
  readonly fetch: boolean;
  readonly threads: boolean;
  readonly existingInventory?: unknown;
  readonly preauthSession?: {
    readonly accessJwt: string;
    readonly refreshJwt: string;
    readonly did: string;
    readonly handle: string;
  };
}
```

The empty-step guard becomes:

```ts
if (!input.fetch && !input.threads) {
  throw new Error('Pick at least one step to run.');
}
```

- [ ] **Step 5: Drop `enrich` from `FetchInput` in `pyodide-runner.ts`**

Edit `app/src/lib/pyodide-runner.ts`. Remove the `readonly enrich: boolean;` line from the `FetchInput` interface.

The interface becomes:

```ts
export interface FetchInput {
  readonly handle: string;
  readonly appPassword: string;
  readonly pds: string;
  readonly fetch: boolean;
  readonly threads: boolean;
  readonly existingInventory?: unknown;
  readonly preauthSession?: {
    readonly accessJwt: string;
    readonly refreshJwt: string;
    readonly did: string;
    readonly handle: string;
  };
}
```

- [ ] **Step 6: Drop `enrich` from worker's `FetchInput`; always run enrich**

Edit `app/src/worker/pyodide-worker.ts`. Remove `readonly enrich: boolean;` from the `FetchInput` interface (around line 20). Then find the `if (input.enrich) { ... }` block (around line 274) and unwrap it so the enrich step always runs.

The block becomes:

```ts
log('Enriching…');
await pyodide.runPythonAsync(`
from pathlib import Path
import bsky_saves.enrich as _bsky_enrich
_bsky_enrich.enrich_inventory(Path('${INVENTORY_PATH}'))
`);
```

- [ ] **Step 7: Drop `enrich` from `SignInDraft`**

Edit `app/src/lib/sign-in-draft.ts`. Remove the `enrich: boolean;` line.

The interface becomes:

```ts
export interface SignInDraft {
  handle: string;
  appPassword: string;
  pds: string;
  fetch: boolean;
  threads: boolean;
  saveInventory: boolean;
  saveCredentials: boolean;
  passphrase: string;
}
```

- [ ] **Step 8: Remove enrich UI from `SignIn.svelte`**

Open `app/src/routes/SignIn.svelte`.

(a) Delete the `let enrich = true;` line (around line 48).

(b) Delete the `enrich,` line from the `signInDraft.set({ ... })` call (around line 71).

(c) Delete the entire enrich checkbox block in the template (around lines 167–171):

```svelte
        <label class="checkbox">
          <input type="checkbox" bind:checked={enrich} />
          <span>Add precise dates</span>
        </label>
        <p class="help">Show the exact time each post was made.</p>
```

After this step, the Advanced disclosure should contain (in order): Server address; Include same-author replies; Keep my saves in this browser; Remember my app password.

- [ ] **Step 9: Remove enrich UI from `Refresh.svelte`**

Open `app/src/routes/Refresh.svelte`.

(a) Delete the `let enrich = false;` line (around line 10).

(b) Update the `$: canUpdate` reactive line to drop `enrich`:

```ts
$: canUpdate = canRefresh && (fetchNew || threads);
```

(c) In the `signInDraft.update` callback (around line 38), drop `enrich` from both branches:

```ts
signInDraft.update((d) =>
  d
    ? { ...d, fetch: fetchNew, threads }
    : {
        handle,
        appPassword: '',
        pds: '',
        fetch: fetchNew,
        threads,
        saveInventory: false,
        saveCredentials: false,
        passphrase: '',
      },
);
```

(d) Delete the enrich checkbox block in the template (around lines 85–88):

```svelte
      <label class="checkbox">
        <input type="checkbox" bind:checked={enrich} />
        <span>Add precise dates to posts that don't have them</span>
      </label>
```

- [ ] **Step 10: Remove enrich from `Run.svelte`**

Open `app/src/routes/Run.svelte`. There are two `RunJobInput` constructions (around lines 28–35 and 38–50).

In the password-mode object (around line 28), remove the `enrich: draft.enrich,` line.

In the session-mode object (around line 38), remove the `enrich: draft?.enrich ?? true,` line.

The two objects become:

```ts
input = {
  mode: 'password',
  handle: draft.handle,
  appPassword: draft.appPassword,
  pds: draft.pds,
  fetch: draft.fetch,
  threads: draft.threads,
};
```

```ts
input = {
  mode: 'session',
  session: {
    accessJwt: session.accessJwt,
    refreshJwt: session.refreshJwt,
    did: session.did,
    handle: session.handle,
  },
  pds: session.pds,
  fetch: draft?.fetch ?? true,
  threads: draft?.threads ?? false,
};
```

- [ ] **Step 11: Run type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 type errors. All tests pass.

- [ ] **Step 12: Confirm no `enrich` references remain in source**

Run:

```bash
grep -rn "enrich" app/src --include='*.ts' --include='*.svelte' --include='*.test.ts'
```

Expected: only matches inside the worker's Python string for the `bsky_saves.enrich` import (those are legitimate — the toggle is gone but the worker still calls the Python module). No `let enrich`, no `enrich:` object key, no `bind:checked={enrich}`.

- [ ] **Step 13: Manual smoke test in dev**

Run: `pnpm dev`

Expected: dev server starts on http://localhost:5173.

(a) Open the site. Sign-in flow: expand Advanced disclosure, verify "Add precise dates" checkbox is gone.

(b) Navigate to /#/refresh: verify the Refresh-screen "Add precise dates" checkbox is gone, and confirm the "Update now" button enables when at least one of (Pull in new posts, Save thread replies) is checked.

(c) Stop the dev server (Ctrl-C).

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "refactor: always-on enrich; drop 'Add precise dates' toggle"
```

---

## Task 2: Add `Account` section to Settings

Settings gets a new top section showing the active handle and a Sign out button that clears the session token without touching the inventory.

**Files:**
- Modify: `app/src/routes/Settings.svelte`

- [ ] **Step 1: Add imports for `lastSession`, `clearLastSession`, and `navigate`**

At the top of `app/src/routes/Settings.svelte`'s `<script>`, after the existing imports, add:

```ts
import { lastSession, clearLastSession } from '$lib/last-session';
import { navigate } from '$lib/router';
```

`lastSession` is a Svelte readable store. The same pattern is already used in `app/src/App.svelte` — reference it as `$lastSession` in the template.

- [ ] **Step 2: Add a `signOut` handler**

Below the existing `clearAll` function, add:

```ts
function signOut() {
  // Sign out clears only the session token. Inventory, saved credentials,
  // and account label all stay so the user can sign in again and pick up
  // where they left off. To wipe everything, use "Clear all local data".
  clearLastSession();
  navigate('/');
}
```

- [ ] **Step 3: Render the Account section as the FIRST settings-section**

Find the existing `<section class="settings-section">` for Inventory in the template (around line 106). Insert a new section ABOVE it:

```svelte
  <section class="settings-section">
    <h3>Account</h3>
    {#if $lastSession}
      <p class="help">
        Signed in as <code>@{$lastSession.handle}</code>.
      </p>
      <div class="settings-row">
        <button type="button" on:click={signOut}>Sign out</button>
      </div>
    {:else}
      <p class="help">Not signed in.</p>
      <div class="settings-row">
        <button type="button" on:click={() => navigate('/')}>Sign in</button>
      </div>
    {/if}
  </section>
```

- [ ] **Step 4: Add a CSS rule for `code` inside settings sections**

If the existing `<style>` block doesn't already style `code`, add this rule near the other `.settings-section` rules:

```css
  .settings-section code {
    background: color-mix(in oklab, CanvasText 5%, Canvas);
    padding: 0.1em 0.3em;
    border-radius: 3px;
    font-size: 0.9em;
  }
```

(This matches the `code` styling used in `Refresh.svelte` for the `@handle` chip.)

- [ ] **Step 5: Manual smoke test**

Run: `pnpm dev`. Navigate to /#/settings.

(a) When signed in: Account section shows "Signed in as @your-handle." and a Sign out button. Click Sign out — page navigates to /. Confirm via the URL bar (`#/`) and that the sign-in form renders. Inventory should still be present in IndexedDB; navigate to /#/library to confirm the library still shows.

(b) Sign in fresh; verify Account section reflects the new handle.

(c) Stop the dev server (Ctrl-C).

- [ ] **Step 6: Run type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 type errors. All tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(settings): add Account section with handle and sign out"
```

---

## Task 3: Show inventory size and last-updated date in the Inventory section

Replace the generic help text in the Inventory section with a richer status line: `156 saves, last updated 2026-05-03`. The Inventory heading is renamed in Task 4.

**Files:**
- Modify: `app/src/routes/Settings.svelte`

- [ ] **Step 1: Add a reactive `libraryFetchedAt` declaration**

In `Settings.svelte`'s `<script>` block, below the existing variable declarations (after `let importInputEl: HTMLInputElement | undefined;`), add:

```ts
$: libraryFetchedAt = (() => {
  const s = $inventoryState;
  if (s.status !== 'ready') return null;
  const inv = s.inventory as unknown as { fetched_at?: unknown };
  if (typeof inv.fetched_at !== 'string') return null;
  return inv.fetched_at.slice(0, 10);
})();
```

`fetched_at` is written by bsky-saves' enrich/threads/images steps as an ISO 8601 timestamp at the inventory root. Slicing the first 10 characters gives `YYYY-MM-DD`. If the field is missing (older inventories), the value is `null` and the conditional in Step 2 omits the trailing clause.

- [ ] **Step 2: Replace the help text in the Inventory section with the status line**

Find the Inventory section in the template:

```svelte
  <section class="settings-section">
    <h3>Inventory</h3>
    <p class="help">Move your saved data between devices or browsers.</p>
    <div class="settings-row">
```

Replace the `<p class="help">...</p>` line with:

```svelte
    {#if $inventoryState.status === 'ready'}
      <p class="help">
        {$inventoryState.inventory.saves.length} saves{#if libraryFetchedAt}, last updated {libraryFetchedAt}{/if}.
      </p>
    {:else if $inventoryState.status === 'empty'}
      <p class="help">No saves yet.</p>
    {/if}
```

- [ ] **Step 3: Manual smoke test**

Run: `pnpm dev`. Navigate to /#/settings.

Expected (with an inventory loaded): "Inventory" section shows e.g. "156 saves, last updated 2026-05-03." If the inventory has no `fetched_at`, the section shows just "156 saves." If empty, "No saves yet."

Stop the dev server (Ctrl-C).

- [ ] **Step 4: Run type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 errors, all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(settings): show inventory size and last-fetched date"
```

---

## Task 4: Rename "Inventory" section to "Library"

The spec uses "Library" everywhere user-facing. Rename the heading; keep the button labels ("Export inventory file" / "Import inventory file") because those refer to the file format, not the user-facing concept.

**Files:**
- Modify: `app/src/routes/Settings.svelte`

- [ ] **Step 1: Update the heading**

In the template, change `<h3>Inventory</h3>` to `<h3>Library</h3>`.

- [ ] **Step 2: Manual smoke test**

Run: `pnpm dev`. Settings should show: Account, Library (was Inventory), Cloudflare Worker proxy, Local data. The proxy + Local data sections are cleaned up in Tasks 5 and 6.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "ui(settings): rename Inventory section to Library"
```

---

## Task 5: Remove the Cloudflare Worker proxy section UI

The proxy fields are dead UI today (article hydration isn't wired). Plan 2 will re-introduce them under Backup → Advanced. For Plan 1, delete the section entirely. Keep `proxy-config.ts` and the `clearProxyConfig` import in `clearAll` — Plan 2 needs them.

**Files:**
- Modify: `app/src/routes/Settings.svelte`

- [ ] **Step 1: Delete the proxy section from the template**

Find the `<section class="settings-section">...</section>` block whose `<h3>` says "Cloudflare Worker proxy" (around lines 124–142). Delete the entire block.

- [ ] **Step 2: Delete proxy-related script state, handlers, and unused imports**

In the `<script>` block:

(a) Delete the two state lines:

```ts
let proxyUrl = '';
let proxySecret = '';
```

(b) Update the proxy-config import to keep only `clearProxyConfig` (still used by `clearAll`):

```ts
import { clearProxyConfig } from '$lib/proxy-config';
```

(c) Delete the `onMount(async () => {...})` block that loads proxy config, and remove the now-unused `onMount` import. Find at the top:

```ts
import { onMount } from 'svelte';
```

…and delete it. Then find and delete the entire `onMount(async () => { const cfg = await loadProxyConfig(); ... })` block.

(d) Delete the `saveProxy` and `clearProxy` functions.

(e) In the `clearAll` function, delete the lines `proxyUrl = '';` and `proxySecret = '';` (they reference deleted state).

- [ ] **Step 3: Run type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 errors, all pass.

- [ ] **Step 4: Manual smoke test**

Run: `pnpm dev`. Settings should now show: Account, Library, Local data. No proxy fields anywhere.

Stop the dev server (Ctrl-C).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "ui(settings): remove Cloudflare Worker proxy UI (proxy-config code retained for Plan 2)"
```

---

## Task 6: Rename "Local data" section to "Reset"

Match the spec's section name.

**Files:**
- Modify: `app/src/routes/Settings.svelte`

- [ ] **Step 1: Update heading and help text**

Find:

```svelte
  <section class="settings-section">
    <h3>Local data</h3>
    <p class="help">
      Wipes inventory, saved credentials, proxy config, and beacon state from this browser.
    </p>
    <button type="button" class="danger" on:click={clearAll}>Clear all local data</button>
  </section>
```

Replace with:

```svelte
  <section class="settings-section">
    <h3>Reset</h3>
    <p class="help">
      Wipes the inventory, saved credentials, proxy config, and beacon state from this browser. This cannot be undone.
    </p>
    <button type="button" class="danger" on:click={clearAll}>Clear all local data</button>
  </section>
```

- [ ] **Step 2: Manual smoke test**

Run: `pnpm dev`. Settings should show three sections: Account, Library, Reset.

Stop the dev server (Ctrl-C).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "ui(settings): rename 'Local data' section to 'Reset'"
```

---

## Task 7: Final verification

Confirm everything passes end-to-end before this plan is considered done.

**Files:** none (verification only).

- [ ] **Step 1: Run type check**

Run: `pnpm check`

Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`

Expected: all tests pass (count should be 67, possibly differing by ±1 if Vitest reports fixture changes).

- [ ] **Step 3: Run production build**

Run: `pnpm build`

Expected: both Vite builds (main + archive-template) succeed. Output reports gzipped sizes for the main bundle and the archive bundle. No errors.

- [ ] **Step 4: Manual end-to-end walkthrough in dev**

Run: `pnpm dev`

Walk this exact path:

(a) Open http://localhost:5173. If signed in from a previous session, verify the Library renders.

(b) Open Settings. Confirm three sections in this order: **Account** (handle + Sign out), **Library** (size + last-updated, Export/Import buttons), **Reset** (Clear all local data button). No Inventory heading. No "Cloudflare Worker proxy" heading. No "Local data" heading.

(c) Click Sign out. Page navigates to / (sign-in form).

(d) Sign in fresh with valid credentials. Expand the Advanced disclosure and confirm it shows: Server address; Include same-author replies (no precise-dates checkbox); Keep my saves; Remember my app password. Submit.

(e) Run page completes. Library renders.

(f) Open Settings again. Account section shows the new handle. Library section shows N saves with a date.

(g) Click Refresh in Library header → /#/refresh. The Refresh card shows two checkboxes: Pull in any newly saved posts, Save same-author thread replies. No precise-dates checkbox. Update now button enables when at least one is checked. Click Cancel.

(h) Stop the dev server (Ctrl-C).

- [ ] **Step 5: Push the branch**

```bash
git push origin main
```

If the user has indicated they want a feature branch, push to that branch instead. Default to `main` unless told otherwise.

---

## Self-review checklist (executor: read before claiming complete)

- [ ] Every task above has its checkboxes ticked.
- [ ] `pnpm check` reports 0 errors.
- [ ] `pnpm test` reports all tests passing.
- [ ] `pnpm build` reports a successful build for both bundles.
- [ ] Manual walkthrough in Step 4 of Task 7 was completed without surprises.
- [ ] Settings page now matches the spec's "Settings page" diagram for Plan 1's scope (Account / Library / Reset). Backup section is intentionally absent — that's Plan 2's job.
- [ ] No `enrich` toggle references remain in source. Run `grep -rn "enrich" app/src --include='*.ts' --include='*.svelte'` to confirm — only matches should be inside the worker's Python string for the `bsky_saves.enrich` import (those are legitimate, the toggle is gone but the worker still calls the Python module).
- [ ] No commits left uncommitted (`git status` shows clean tree).

If any checkbox above fails, do not claim Plan 1 complete. Investigate and fix; if blocked, document the blocker and surface it.

---

## What's next (Plan 2)

Plan 2 will add the Backup section to Settings, define helper detection, build the setup wizard, the image-backup banner, and the live status row. It depends on this plan being merged first; the Backup section needs the section structure laid down here, and the wizard's "Custom worker URL / Shared secret" fields will reuse `proxy-config.ts` (which Plan 1 deliberately retained).

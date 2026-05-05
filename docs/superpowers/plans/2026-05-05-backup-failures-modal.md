# Plan 19: Backup failures Details modal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** A shared "Details" modal that lists backup failures (URL + reason + permalink to source post), triggered from `BackupStatusRow` ("(N failed)" links) and from `PostFocus`'s footer when any of the post's assets failed.

**Architecture:** New presentational component `BackupFailuresModal.svelte`. New pure helper `findSaveByAssetUrl` mirrors the same URL-walking logic as `extract-image-urls.ts` / `extract-article-urls.ts`. New tiny helper `bskyPostUrl` consolidates the bsky.app permalink builder used in PostFocus. `BackupStatusRow` and `PostFocus` add the triggers.

**Tech Stack:** Svelte 4, TypeScript 5, Vitest. No new dependencies.

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `ef4f044` (spec commit) or later.

---

## File structure

**Created:**
- `app/src/lib/bsky-permalink.ts` — `bskyPostUrl(save)` returns `https://bsky.app/profile/{handle}/post/{rkey}`.
- `app/src/lib/bsky-permalink.test.ts` — unit tests for `bskyPostUrl`.
- `app/src/lib/find-save-by-asset-url.ts` — `findSaveByAssetUrl(inventory, url)` returns the source `Save` or `null`.
- `app/src/lib/find-save-by-asset-url.test.ts` — unit tests.
- `app/src/components/BackupFailuresModal.svelte` — presentational modal component.

**Modified:**
- `app/src/reader/PostFocus.svelte` — switch local `bskyUrl` to `bskyPostUrl`; add the per-post failure trigger + modal mount.
- `app/src/components/BackupStatusRow.svelte` — wrap "(N failed)" in inline buttons + modal mounts.

---

## Task 1: `bskyPostUrl` helper + tests

**Files:**
- Create: `app/src/lib/bsky-permalink.ts`
- Create: `app/src/lib/bsky-permalink.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/bsky-permalink.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bskyPostUrl } from './bsky-permalink';

describe('bskyPostUrl', () => {
  it('builds the canonical permalink', () => {
    const url = bskyPostUrl({
      author: { handle: 'alice.bsky.social' },
      uri: 'at://did:plc:abc/app.bsky.feed.post/3kx9abc',
    });
    expect(url).toBe('https://bsky.app/profile/alice.bsky.social/post/3kx9abc');
  });

  it('URL-encodes the handle and rkey', () => {
    const url = bskyPostUrl({
      author: { handle: 'café.example' },
      uri: 'at://did:plc:abc/coll/rk e?y',
    });
    expect(url).toBe('https://bsky.app/profile/caf%C3%A9.example/post/rk%20e%3Fy');
  });

  it('falls back to empty rkey when uri has no slash', () => {
    const url = bskyPostUrl({
      author: { handle: 'h' },
      uri: 'no-slashes',
    });
    expect(url).toBe('https://bsky.app/profile/h/post/');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run app/src/lib/bsky-permalink.test.ts
```

Expected: import resolution failure (module does not exist).

- [ ] **Step 3: Create `app/src/lib/bsky-permalink.ts`**

```ts
/**
 * Build the canonical bsky.app permalink for a saved post.
 *
 * The save's `uri` is an at-URI like
 * `at://did:plc:abc/app.bsky.feed.post/3kx9abc`. We extract the trailing
 * record-key segment and combine it with the author handle to produce
 * `https://bsky.app/profile/{handle}/post/{rkey}`.
 */
export function bskyPostUrl(save: {
  author: { handle: string };
  uri: string;
}): string {
  const m = /\/([^/]+)$/.exec(save.uri);
  const rkey = m?.[1] ?? '';
  return `https://bsky.app/profile/${encodeURIComponent(save.author.handle)}/post/${encodeURIComponent(rkey)}`;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm check && pnpm vitest run app/src/lib/bsky-permalink.test.ts
```

Expected: 0 errors, 0 warnings; 3/3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/bsky-permalink.ts app/src/lib/bsky-permalink.test.ts
git commit -m "feat(bsky-permalink): extract bskyPostUrl helper"
```

DO NOT push.

---

## Task 2: `findSaveByAssetUrl` helper + tests

**Files:**
- Create: `app/src/lib/find-save-by-asset-url.ts`
- Create: `app/src/lib/find-save-by-asset-url.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/find-save-by-asset-url.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findSaveByAssetUrl } from './find-save-by-asset-url';

const A = { did: 'd1', handle: 'a.example' };
const REC = { text: 't', createdAt: '2026-05-05T00:00:00Z' };

function inv(saves: unknown[]): unknown {
  return { saves };
}

describe('findSaveByAssetUrl', () => {
  it('matches save.images[i].url', () => {
    const save = { uri: 'at://1', author: A, record: REC, images: [{ url: 'https://i/1' }] };
    expect(findSaveByAssetUrl(inv([save]), 'https://i/1')).toBe(save);
  });

  it('matches save.embed.images[i].url', () => {
    const save = {
      uri: 'at://2',
      author: A,
      record: REC,
      embed: { images: [{ url: 'https://i/2' }] },
    };
    expect(findSaveByAssetUrl(inv([save]), 'https://i/2')).toBe(save);
  });

  it('matches save.embed.url (article)', () => {
    const save = { uri: 'at://3', author: A, record: REC, embed: { url: 'https://a/3' } };
    expect(findSaveByAssetUrl(inv([save]), 'https://a/3')).toBe(save);
  });

  it('matches inside save.thread_replies[i].images[j].url', () => {
    const save = {
      uri: 'at://4',
      author: A,
      record: REC,
      thread_replies: [{ images: [{ url: 'https://i/4' }] }],
    };
    expect(findSaveByAssetUrl(inv([save]), 'https://i/4')).toBe(save);
  });

  it('matches inside save.quoted_post.images[i].url', () => {
    const save = {
      uri: 'at://5',
      author: A,
      record: REC,
      quoted_post: { images: [{ url: 'https://i/5' }] },
    };
    expect(findSaveByAssetUrl(inv([save]), 'https://i/5')).toBe(save);
  });

  it('matches inside save.quoted_post.thread_replies[i].images[j].url', () => {
    const save = {
      uri: 'at://6',
      author: A,
      record: REC,
      quoted_post: { thread_replies: [{ images: [{ url: 'https://i/6' }] }] },
    };
    expect(findSaveByAssetUrl(inv([save]), 'https://i/6')).toBe(save);
  });

  it('returns null when no save matches', () => {
    const save = { uri: 'at://7', author: A, record: REC, images: [{ url: 'https://i/7' }] };
    expect(findSaveByAssetUrl(inv([save]), 'https://nope/')).toBeNull();
  });

  it('returns null for null/undefined inventory', () => {
    expect(findSaveByAssetUrl(null, 'https://x/')).toBeNull();
    expect(findSaveByAssetUrl(undefined, 'https://x/')).toBeNull();
  });

  it('returns null when inventory has no saves array', () => {
    expect(findSaveByAssetUrl({}, 'https://x/')).toBeNull();
    expect(findSaveByAssetUrl({ saves: 'nope' }, 'https://x/')).toBeNull();
  });

  it('handles malformed save entries without throwing', () => {
    const inputs: unknown[] = [null, 'string', 42, {}, { embed: null }];
    expect(findSaveByAssetUrl(inv(inputs), 'https://x/')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run app/src/lib/find-save-by-asset-url.test.ts
```

Expected: import resolution failure.

- [ ] **Step 3: Create `app/src/lib/find-save-by-asset-url.ts`**

```ts
import type { Save } from '../reader/inventory-shape';

function imageArrayContains(arr: unknown, url: string): boolean {
  if (!Array.isArray(arr)) return false;
  for (const img of arr) {
    if (!img || typeof img !== 'object') continue;
    const u = (img as Record<string, unknown>).url;
    if (u === url) return true;
  }
  return false;
}

function repliesArrayContains(arr: unknown, url: string): boolean {
  if (!Array.isArray(arr)) return false;
  for (const reply of arr) {
    if (!reply || typeof reply !== 'object') continue;
    if (imageArrayContains((reply as Record<string, unknown>).images, url)) return true;
  }
  return false;
}

function saveContains(save: unknown, url: string): boolean {
  if (!save || typeof save !== 'object') return false;
  const s = save as Record<string, unknown>;

  if (imageArrayContains(s.images, url)) return true;
  if (repliesArrayContains(s.thread_replies, url)) return true;

  const embed = s.embed;
  if (embed && typeof embed === 'object') {
    const e = embed as Record<string, unknown>;
    if (e.url === url) return true;
    if (imageArrayContains(e.images, url)) return true;
  }

  const quoted = s.quoted_post;
  if (quoted && typeof quoted === 'object') {
    const q = quoted as Record<string, unknown>;
    if (imageArrayContains(q.images, url)) return true;
    if (repliesArrayContains(q.thread_replies, url)) return true;
  }

  return false;
}

/**
 * Walk an inventory's saves and return the first save whose asset URLs
 * include the given URL. Searches the same locations as
 * `extract-image-urls.ts` and `extract-article-urls.ts`.
 *
 * Returns null on no match, missing inventory, or malformed shapes.
 */
export function findSaveByAssetUrl(
  inventory: unknown,
  url: string,
): Save | null {
  if (!inventory || typeof inventory !== 'object') return null;
  const inv = inventory as { saves?: unknown };
  if (!Array.isArray(inv.saves)) return null;
  for (const save of inv.saves) {
    if (saveContains(save, url)) return save as Save;
  }
  return null;
}
```

- [ ] **Step 4: Run tests + check**

```bash
pnpm check && pnpm vitest run app/src/lib/find-save-by-asset-url.test.ts
```

Expected: 0 errors, 0 warnings; 10/10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/find-save-by-asset-url.ts app/src/lib/find-save-by-asset-url.test.ts
git commit -m "feat(find-save-by-asset-url): map asset URL back to source Save"
```

DO NOT push.

---

## Task 3: `BackupFailuresModal.svelte`

**Files:**
- Create: `app/src/components/BackupFailuresModal.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { findSaveByAssetUrl } from '$lib/find-save-by-asset-url';
  import { bskyPostUrl } from '$lib/bsky-permalink';

  type FailureRow = {
    readonly url: string;
    readonly reason: string;
    readonly type: 'image' | 'article';
  };

  export let open = false;
  export let failures: ReadonlyArray<FailureRow> = [];
  export let inventory: unknown = null;
  export let title = 'Backup failures';

  const dispatch = createEventDispatcher<{ close: void }>();

  function close() {
    dispatch('close');
  }

  function onBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) close();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (open && event.key === 'Escape') close();
  }

  function permalinkFor(url: string): string | null {
    const save = findSaveByAssetUrl(inventory, url);
    if (!save) return null;
    return bskyPostUrl(save);
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
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="failures-modal-title">
      <header class="modal__header">
        <h3 id="failures-modal-title" class="modal__title">
          {title} ({failures.length})
        </h3>
        <button type="button" class="modal__close" on:click={close} aria-label="Close">
          ✕
        </button>
      </header>

      {#if failures.length === 0}
        <p class="modal__empty">No failures.</p>
      {:else}
        <ul class="modal__list">
          {#each failures as f (f.url + ':' + f.type)}
            <li class="modal__row">
              <div class="modal__row-head">
                <span class="modal__type modal__type--{f.type}">{f.type === 'image' ? 'IMG' : 'ARTICLE'}</span>
                <span class="modal__reason">{f.reason}</span>
              </div>
              <div class="modal__url" title={f.url}>{f.url}</div>
              {#if permalinkFor(f.url)}
                <a
                  class="modal__permalink"
                  href={permalinkFor(f.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                >View source post</a>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      <footer class="modal__footer">
        <button type="button" on:click={close}>Close</button>
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
    max-width: 40rem;
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
    margin-bottom: 0.75rem;
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
  .modal__empty {
    margin: 0 0 0.5rem;
    opacity: 0.7;
    font-size: 0.9rem;
  }
  .modal__list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .modal__row {
    padding: 0.6rem 0;
    border-bottom: 1px solid color-mix(in oklab, CanvasText 10%, transparent);
  }
  .modal__row:last-child {
    border-bottom: 0;
  }
  .modal__row-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }
  .modal__type {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    background: color-mix(in oklab, CanvasText 12%, Canvas);
  }
  .modal__reason {
    color: color-mix(in oklab, red 70%, CanvasText);
    font-size: 0.9rem;
  }
  .modal__url {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.78rem;
    opacity: 0.75;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .modal__permalink {
    display: inline-block;
    margin-top: 0.25rem;
    font-size: 0.8rem;
    color: inherit;
    text-decoration: underline;
  }
  .modal__footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.75rem;
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
</style>
```

- [ ] **Step 2: Run check + build**

```bash
pnpm check && pnpm build
```

Expected: 0 errors, 0 warnings; both bundles build (the new component is unused but Svelte compiles it as part of the bundle).

- [ ] **Step 3: Commit**

```bash
git add app/src/components/BackupFailuresModal.svelte
git commit -m "feat(BackupFailuresModal): presentational details modal for failures"
```

DO NOT push.

---

## Task 4: `BackupStatusRow` triggers

**Files:**
- Modify: `app/src/components/BackupStatusRow.svelte`

- [ ] **Step 1: Update the script section**

Open `app/src/components/BackupStatusRow.svelte`. At the top of the existing `<script lang="ts">`, add:

```svelte
  import BackupFailuresModal from './BackupFailuresModal.svelte';
```

After the existing `let articleErrorMessage = '';` declaration, add:

```svelte
  let imageFailuresOpen = false;
  let articleFailuresOpen = false;

  $: imageFailuresRows = $imageHydration.failures.map((f) => ({
    ...f,
    type: 'image' as const,
  }));
  $: articleFailuresRows = $articleHydration.failures.map((f) => ({
    ...f,
    type: 'article' as const,
  }));
```

- [ ] **Step 2: Replace "(N failed)" text with buttons in the template**

Find every occurrence of:

```svelte
        {#if failed > 0}({failed} failed){/if}
```

(there are two — inside the running and cancelled image branches). Replace each with:

```svelte
        {#if failed > 0}
          (<button type="button" class="backup-status__failed-link" on:click={() => (imageFailuresOpen = true)}>{failed} failed</button>)
        {/if}
```

Find this block (inside the done branch with mismatch):

```svelte
        <p class="backup-status__line">
          {succeeded} of {total} images saved ({failed} failed)
        </p>
```

Replace with:

```svelte
        <p class="backup-status__line">
          {succeeded} of {total} images saved
          (<button type="button" class="backup-status__failed-link" on:click={() => (imageFailuresOpen = true)}>{failed} failed</button>)
        </p>
```

Do the analogous transformation for the article branches. Find every occurrence of:

```svelte
        {#if aFailed > 0}({aFailed} failed){/if}
```

Replace with:

```svelte
        {#if aFailed > 0}
          (<button type="button" class="backup-status__failed-link" on:click={() => (articleFailuresOpen = true)}>{aFailed} failed</button>)
        {/if}
```

And find:

```svelte
        <p class="backup-status__line">
          {aSucceeded} of {aTotal} articles saved ({aFailed} failed)
        </p>
```

Replace with:

```svelte
        <p class="backup-status__line">
          {aSucceeded} of {aTotal} articles saved
          (<button type="button" class="backup-status__failed-link" on:click={() => (articleFailuresOpen = true)}>{aFailed} failed</button>)
        </p>
```

- [ ] **Step 3: Mount the modals**

After the closing `</div>` of the `.backup-status` block (and before the `<style>` block, or after `{/if}`, as appropriate — i.e., outside the `{#if status !== 'idle' || aStatus !== 'idle'}` wrapper), add:

```svelte
<BackupFailuresModal
  open={imageFailuresOpen}
  failures={imageFailuresRows}
  {inventory}
  title="Image backup failures"
  on:close={() => (imageFailuresOpen = false)}
/>
<BackupFailuresModal
  open={articleFailuresOpen}
  failures={articleFailuresRows}
  {inventory}
  title="Article backup failures"
  on:close={() => (articleFailuresOpen = false)}
/>
```

Note: place these *outside* the `{#if status !== 'idle' || aStatus !== 'idle'}` block so the modal can stay open even after a hydration run finishes and the status row hides itself. Concretely, the `{/if}` of the status-row visibility wrapper should close before these `<BackupFailuresModal>` elements.

- [ ] **Step 4: Add CSS for the inline-button style**

Inside the existing `<style>` block, append:

```css
  .backup-status__failed-link {
    font: inherit;
    background: none;
    border: 0;
    padding: 0;
    color: color-mix(in oklab, red 70%, CanvasText);
    text-decoration: underline;
    cursor: pointer;
  }
  .backup-status__failed-link:hover {
    text-decoration: none;
  }
```

- [ ] **Step 5: Run check + tests + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 errors, 0 warnings; all tests pass; both bundles build.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/BackupStatusRow.svelte
git commit -m "feat(BackupStatusRow): clickable (N failed) opens failures modal"
```

DO NOT push.

---

## Task 5: `PostFocus` per-post trigger

**Files:**
- Modify: `app/src/reader/PostFocus.svelte`

- [ ] **Step 1: Update imports + adopt the shared `bskyPostUrl`**

In the existing `<script lang="ts">` block, add the new imports near the existing `$lib` imports:

```svelte
  import BackupFailuresModal from '../components/BackupFailuresModal.svelte';
  import { bskyPostUrl } from '$lib/bsky-permalink';
```

Replace the existing local `bskyUrl` reactive declaration:

```svelte
  $: bskyUrl = (() => {
    const m = /\/([^/]+)$/.exec(save.uri);
    const rkey = m?.[1] ?? '';
    return `https://bsky.app/profile/${encodeURIComponent(save.author.handle)}/post/${encodeURIComponent(rkey)}`;
  })();
```

with:

```svelte
  $: bskyUrl = bskyPostUrl(save);
```

- [ ] **Step 2: Add per-post failure state**

After the existing `$: status = getPostBackupStatus({...})` block, add:

```svelte
  let failuresOpen = false;

  $: postScopedFailures = [
    ...$imageHydration.failures
      .filter((f) => imageUrls.includes(f.url))
      .map((f) => ({ ...f, type: 'image' as const })),
    ...$articleHydration.failures
      .filter((f) => f.url === articleUrl)
      .map((f) => ({ ...f, type: 'article' as const })),
  ];
```

- [ ] **Step 3: Make the footer clickable when `anyFailed`**

Locate the footer block:

```svelte
  {#if status.hasAssets}
    <footer
      class="post-focus__backup"
      class:post-focus__backup--failed={status.anyFailed}
      aria-label="Backup status"
    >
      {status.summary}
    </footer>
  {/if}
```

Replace it with:

```svelte
  {#if status.hasAssets}
    <footer
      class="post-focus__backup"
      class:post-focus__backup--failed={status.anyFailed}
      aria-label="Backup status"
    >
      {#if status.anyFailed}
        <button
          type="button"
          class="post-focus__backup-button"
          on:click={() => (failuresOpen = true)}
        >
          {status.summary}
        </button>
      {:else}
        {status.summary}
      {/if}
    </footer>
  {/if}
```

- [ ] **Step 4: Mount the post-scoped modal**

Just before the closing `</article>`, add:

```svelte
  <BackupFailuresModal
    open={failuresOpen}
    failures={postScopedFailures}
    inventory={{ saves: [save] }}
    title="Backup failures for this post"
    on:close={() => (failuresOpen = false)}
  />
```

- [ ] **Step 5: Add CSS for the in-footer button**

Inside the existing `<style>` block, append:

```css
  .post-focus__backup-button {
    font: inherit;
    color: inherit;
    background: none;
    border: 0;
    padding: 0;
    text-align: left;
    cursor: pointer;
    text-decoration: underline;
  }
  .post-focus__backup-button:hover {
    text-decoration: none;
  }
```

- [ ] **Step 6: Run check + tests + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 errors, 0 warnings; all tests pass; both bundles build.

- [ ] **Step 7: Commit**

```bash
git add app/src/reader/PostFocus.svelte
git commit -m "feat(PostFocus): footer opens post-scoped failures modal"
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

- `bskyPostUrl` exported and used by both `PostFocus` and `BackupFailuresModal`.
- `findSaveByAssetUrl` walks the same locations as `extract-image-urls.ts` and returns null on malformed inputs.
- `BackupFailuresModal` renders type tag + reason + monospaced URL + "View source post" link (hidden when unresolvable).
- Modal closes on Esc, backdrop click, and the close button.
- `BackupStatusRow` has two type-specific failure-modal triggers; the modals live outside the visibility-gated wrapper so they can stay open after the row hides.
- `PostFocus` footer is a button only when `anyFailed`, opens the post-scoped modal with `inventory={{ saves: [save] }}`.
- Five commits in order: bsky-permalink → find-save-by-asset-url → modal component → BackupStatusRow trigger → PostFocus trigger.
- `pnpm check && pnpm test && pnpm build` clean throughout.

## What's next

Plan 19 closes the failure-visibility gap. Remaining backlog items will surface as user feedback dictates.

# Plan 5: `HydratedImage` component + integration into PostBody / QuotedPost / PostFocus

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** First visible payoff from the image-backup engine — when an image's blob is cached in `image-store`, the GUI renders it from the local blob URL. Otherwise it falls back to the remote `cdn.bsky.app` URL exactly like today. No new behavior is visible to users without hydration; once hydration runs, images load locally.

**Architecture:** Two-layer split:

1. `image-resolver.ts` — a small async helper that takes a remote URL and returns the URL to actually use (`blob:` URL if cached, the remote URL otherwise). All logic is here so it's unit-testable without Svelte test infrastructure.
2. `HydratedImage.svelte` — thin Svelte wrapper around the resolver. Renders an `<img>` whose `src` is reactive: starts as the remote URL, swaps to a blob URL once the resolver promise resolves. Revokes the blob URL on destroy.
3. Replace plain `<img>` tags in `PostBody.svelte`, `QuotedPost.svelte`, and `PostFocus.svelte` with `<HydratedImage>`. Adjust scoped CSS to use `:global(img)` since the `<img>` now lives inside the child component.

**Tech Stack:** Svelte 4, TypeScript 5, Vitest 2, idb-keyval (already wired). No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-05-04-hydration-and-backup-ux-design.md` "Background hydration" — render-time blob lookup is the bridge between "blob exists in IDB" and "user sees their own copy."

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `62bedd9` (Plan 4 final commit) or later.

---

## Task 1: `image-resolver.ts` — pure logic helper

`resolveImageSrc(remoteUrl): Promise<{ src, isBlob }>` — looks up the URL in `image-store`. If a blob exists, returns `{ src: URL.createObjectURL(blob), isBlob: true }`. Otherwise returns `{ src: remoteUrl, isBlob: false }`.

Caller is responsible for revoking the blob URL when no longer needed (the component does this on destroy).

**Files:**
- Create: `app/src/lib/image-resolver.ts`
- Create: `app/src/lib/image-resolver.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/image-resolver.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

beforeEach(async () => {
  const { clearImageBlobs } = await import('./image-store');
  await clearImageBlobs();
  vi.unstubAllGlobals();
});

describe('resolveImageSrc', () => {
  it('returns the remote URL when no blob is cached', async () => {
    const { resolveImageSrc } = await import('./image-resolver');
    const result = await resolveImageSrc('https://cdn.bsky.app/img/foo.jpg');
    expect(result).toEqual({
      src: 'https://cdn.bsky.app/img/foo.jpg',
      isBlob: false,
    });
  });

  it('returns a blob URL when the blob is cached', async () => {
    // Stub URL.createObjectURL since fake-indexeddb's blob support varies.
    const createObjectURL = vi.fn(() => 'blob:fake-url');
    vi.stubGlobal('URL', { ...URL, createObjectURL });

    const { saveImageBlob } = await import('./image-store');
    await saveImageBlob('https://cdn.bsky.app/img/foo.jpg', new Blob(['IMG'], { type: 'image/png' }));

    const { resolveImageSrc } = await import('./image-resolver');
    const result = await resolveImageSrc('https://cdn.bsky.app/img/foo.jpg');
    expect(result).toEqual({
      src: 'blob:fake-url',
      isBlob: true,
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('falls back to the remote URL when the IDB lookup throws', async () => {
    // Force loadImageBlob to throw by mocking the module.
    vi.doMock('./image-store', () => ({
      loadImageBlob: vi.fn(async () => {
        throw new Error('IDB unavailable');
      }),
    }));
    const { resolveImageSrc } = await import('./image-resolver');
    const result = await resolveImageSrc('https://cdn.bsky.app/img/foo.jpg');
    expect(result).toEqual({
      src: 'https://cdn.bsky.app/img/foo.jpg',
      isBlob: false,
    });
    vi.doUnmock('./image-store');
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

Run: `pnpm test image-resolver`

Expected: failures because the module doesn't exist yet.

- [ ] **Step 3: Implement the module**

Create `app/src/lib/image-resolver.ts`:

```ts
// Render-time lookup that bridges image-store (IDB blob cache) with the
// remote URL. Returns the URL the GUI should hand to <img src=...>.
//
// Caller owns the blob URL lifecycle: when isBlob is true, revoke the src
// via URL.revokeObjectURL when the consumer is destroyed.

import { loadImageBlob } from './image-store';

export interface ResolvedImage {
  readonly src: string;
  readonly isBlob: boolean;
}

export async function resolveImageSrc(remoteUrl: string): Promise<ResolvedImage> {
  try {
    const blob = await loadImageBlob(remoteUrl);
    if (blob) {
      return { src: URL.createObjectURL(blob), isBlob: true };
    }
  } catch {
    // IDB unavailable (private mode, quota, etc.) — fall through to remote.
  }
  return { src: remoteUrl, isBlob: false };
}
```

- [ ] **Step 4: Run tests — confirm all 3 pass**

Run: `pnpm test image-resolver`

Expected: 3/3 passing.

- [ ] **Step 5: Run full type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 errors. Total goes 115 → 118.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(image-resolver): blob-or-remote URL chooser for render-time lookup"
```

DO NOT push.

---

## Task 2: `HydratedImage.svelte` component

Wraps `resolveImageSrc` in a Svelte component. Props: `src` (remote URL) and `alt`. Reactively swaps `<img src>` to a blob URL once the resolver resolves. Revokes the blob URL on destroy.

The component renders **only** the `<img>` element (no wrapper div), so parent components' CSS still applies via `:global(img)` selectors (which we add in Task 3).

**Files:**
- Create: `app/src/components/HydratedImage.svelte`

- [ ] **Step 1: Implement the component**

Create `app/src/components/HydratedImage.svelte`:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { resolveImageSrc } from '$lib/image-resolver';

  export let src: string;
  export let alt = '';

  let resolved: string = src;
  let blobUrlToRevoke: string | null = null;

  async function resolve(remote: string): Promise<void> {
    if (blobUrlToRevoke !== null) {
      URL.revokeObjectURL(blobUrlToRevoke);
      blobUrlToRevoke = null;
    }
    try {
      const result = await resolveImageSrc(remote);
      resolved = result.src;
      if (result.isBlob) blobUrlToRevoke = result.src;
    } catch {
      resolved = remote;
    }
  }

  onMount(() => {
    void resolve(src);
  });

  // Re-resolve if the bound src changes (rare in this app, but cheap).
  $: void resolve(src);

  onDestroy(() => {
    if (blobUrlToRevoke !== null) URL.revokeObjectURL(blobUrlToRevoke);
  });
</script>

<!--
  Intentionally unstyled: parent components (PostBody, QuotedPost, PostFocus)
  carry the grid/sizing rules and target the inner <img> via :global(img).
-->
<img src={resolved} {alt} loading="lazy" />
```

- [ ] **Step 2: Verify type check**

Run: `pnpm check`

Expected: 0 errors. The component shouldn't introduce any new warnings.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(HydratedImage): Svelte component that swaps to blob URL when cached"
```

DO NOT push.

---

## Task 3: Integrate `HydratedImage` into reader components

Replace plain `<img>` tags in three reader components with `<HydratedImage>`. Each parent's scoped `<style>` rule that targets `img` must change to `:global(img)` because the `<img>` element is now rendered inside the `HydratedImage` child component, which has its own (empty) style scope.

**Files:**
- Modify: `app/src/reader/PostBody.svelte`
- Modify: `app/src/reader/QuotedPost.svelte`
- Modify: `app/src/reader/PostFocus.svelte`

- [ ] **Step 1: Update `PostBody.svelte`**

Open `app/src/reader/PostBody.svelte`.

(a) Add the import below the existing imports in `<script>`:

```ts
import HydratedImage from '../components/HydratedImage.svelte';
```

(b) In the template, replace BOTH `<img>` blocks (the localImages branch and the embedImages branch) with `<HydratedImage>`. The result should look like:

```svelte
  {#if localImages.length > 0}
    <div class="post-body__images">
      {#each localImages as img}
        <HydratedImage src={img.path} alt="" />
      {/each}
    </div>
  {:else if embedImages.length > 0}
    <div class="post-body__images">
      {#each embedImages as img}
        <HydratedImage src={img.fullsize ?? img.thumb ?? ''} alt={img.alt ?? ''} />
      {/each}
    </div>
  {/if}
```

(c) In the `<style>` block, change the rule that targets the post-body image:

From:
```css
  .post-body__images img {
    width: 100%;
    border-radius: 6px;
    object-fit: cover;
  }
```

To:
```css
  .post-body__images :global(img) {
    width: 100%;
    border-radius: 6px;
    object-fit: cover;
  }
```

- [ ] **Step 2: Update `QuotedPost.svelte`**

Open `app/src/reader/QuotedPost.svelte`.

(a) Add the import at the top of `<script>`:

```ts
import HydratedImage from '../components/HydratedImage.svelte';
```

(b) Replace the `<img>` tag in the images each-block with `<HydratedImage>`:

From:
```svelte
        {#each images as img}
          <img src={img.url} alt={img.alt} loading="lazy" />
        {/each}
```

To:
```svelte
        {#each images as img}
          <HydratedImage src={img.url} alt={img.alt} />
        {/each}
```

(c) In the `<style>` block, change:

```css
  .quoted-post__images img {
    width: 100%;
    border-radius: 4px;
    object-fit: cover;
  }
```

To:
```css
  .quoted-post__images :global(img) {
    width: 100%;
    border-radius: 4px;
    object-fit: cover;
  }
```

- [ ] **Step 3: Update `PostFocus.svelte`**

Open `app/src/reader/PostFocus.svelte`.

(a) Add the import:

```ts
import HydratedImage from '../components/HydratedImage.svelte';
```

(b) In the template, find the thread reply images each-block and replace `<img>` with `<HydratedImage>`:

From:
```svelte
              <div class="post-focus__thread-images">
                {#each entry.images as img}
                  <img src={img.url} alt={img.alt ?? ''} loading="lazy" />
                {/each}
              </div>
```

To:
```svelte
              <div class="post-focus__thread-images">
                {#each entry.images as img}
                  <HydratedImage src={img.url} alt={img.alt ?? ''} />
                {/each}
              </div>
```

(c) In the `<style>` block, change:

```css
  .post-focus__thread-images img {
    width: 100%;
    border-radius: 6px;
    object-fit: cover;
  }
```

To:
```css
  .post-focus__thread-images :global(img) {
    width: 100%;
    border-radius: 6px;
    object-fit: cover;
  }
```

- [ ] **Step 4: Run type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 errors. All 118 tests still pass.

- [ ] **Step 5: Run build to confirm Svelte compilation succeeds**

Run: `pnpm build`

Expected: both bundles build with no new warnings.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(reader): use HydratedImage in PostBody, QuotedPost, PostFocus"
```

DO NOT push.

---

## Final verification

- [ ] **Step 1: Run check + test + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 type errors (3 pre-existing CSS warnings tolerated). All ~118 tests pass. Both bundles build.

- [ ] **Step 2: Push**

```bash
git push origin main
```

---

## What's next

Plan 5 ships the render-time blob swap. Without hydration running, the user sees no change — same `cdn.bsky.app` URLs as before. Once hydration runs (currently only triggerable from a Vitest test or the future Plan 6 wiring), images render from the local blob cache.

Plan 6 will introduce:
- `BackupStatusRow.svelte` for the Library page (subscribed to `imageHydration`).
- The Backup section in Settings (wires up enable/disable and the trigger button to actually start hydration).
- A minimal "Save my own copy of images" button somewhere visible.

After Plan 6, image backup is end-to-end usable from the GUI (assuming a backend — helper or user-worker — is configured).

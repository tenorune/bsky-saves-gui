# Design: Backup failures Details modal (Plan 19)

## Goal

Let users dig into individual backup failures from two natural entry points: the global `BackupStatusRow` ("(3 failed)" link) and the per-post `PostFocus` footer. The modal lists each failure as `URL + reason + "View source post"` link.

## Scope

- **In scope.** A shared modal component, a helper that resolves an asset URL back to its source `Save`, and two new clickable triggers (one in `BackupStatusRow`, one in `PostFocus`).
- **Out of scope.** Per-row retry buttons (the existing bulk Retry in `BackupStatusRow` already covers this). Filter / search inside the modal. Post-text snippets per row. Persisting failures across sessions. Copy-URL button.

## Architecture

One shared modal component used by two triggers; differs only in which failures get passed in.

### `app/src/components/BackupFailuresModal.svelte` (new)

Props:

```ts
type FailureRow = {
  url: string;
  reason: string;
  type: 'image' | 'article';
};

export let open: boolean;
export let failures: ReadonlyArray<FailureRow>;
export let inventory: unknown;
export let title: string = 'Backup failures';
```

Behavior:

- Backdrop + click-outside-to-close + Esc-to-close. Mirrors the patterns in `CustomProxySetupModal.svelte` (event dispatcher with `close` event; parent toggles `open`).
- Header: `{title} ({failures.length})` and a close button.
- Empty list → render a single "No failures." line. Defensive: callers won't open with an empty list, but we render gracefully.
- For each failure row:
  - Type tag: `[img]` or `[article]` — small uppercase pill.
  - Reason — primary line, subtle red tint.
  - URL — secondary line in monospace, truncated with `text-overflow: ellipsis` + `title={url}` for the full value on hover.
  - "View source post" link — anchor with `target="_blank" rel="noopener noreferrer"` to the resolved bsky.app URL; hidden if no source resolves.

### `app/src/lib/find-save-by-asset-url.ts` (new helper)

```ts
import type { Save } from '../reader/inventory-shape';

export function findSaveByAssetUrl(
  inventory: unknown,
  url: string,
): Save | null;
```

Returns the first `Save` whose asset URL matches. Walks the same locations as the existing `extract-image-urls.ts` and `extract-article-urls.ts`:

- `save.images[i].url`
- `save.embed.images[i].url`
- `save.embed.url` (article)
- `save.thread_replies[i].images[j].url`
- `save.quoted_post.images[i].url`
- `save.quoted_post.thread_replies[i].images[j].url`

Pure function, no I/O. Returns `null` for missing/malformed inputs without throwing.

### `app/src/lib/bsky-permalink.ts` (new tiny helper, or co-located)

`PostFocus` already builds a `bskyUrl` from `save.author.handle` + `save.uri` rkey. Extract that into a reusable function:

```ts
export function bskyPostUrl(save: { author: { handle: string }; uri: string }): string;
```

`PostFocus` switches to use this; the modal also uses it.

### `BackupStatusRow.svelte`

The existing template lines:

```svelte
<p class="backup-status__line">
  Saving images: {succeeded} of {total}
  {#if failed > 0}({failed} failed){/if}
</p>
```

…become:

```svelte
<p class="backup-status__line">
  Saving images: {succeeded} of {total}
  {#if failed > 0}
    (<button type="button" class="backup-status__failed-link" on:click={openImageFailures}>{failed} failed</button>)
  {/if}
</p>
```

A small inline `.backup-status__failed-link` style: text-button (no border/background), red color, underline on hover.

Two state variables and two openers:

```svelte
let imageFailuresOpen = false;
let articleFailuresOpen = false;
function openImageFailures() { imageFailuresOpen = true; }
function openArticleFailures() { articleFailuresOpen = true; }
```

Two modal mounts, one for each domain:

```svelte
<BackupFailuresModal
  open={imageFailuresOpen}
  failures={$imageHydration.failures.map((f) => ({ ...f, type: 'image' }))}
  inventory={inventory}
  title="Image backup failures"
  on:close={() => (imageFailuresOpen = false)}
/>
<BackupFailuresModal
  open={articleFailuresOpen}
  failures={$articleHydration.failures.map((f) => ({ ...f, type: 'article' }))}
  inventory={inventory}
  title="Article backup failures"
  on:close={() => (articleFailuresOpen = false)}
/>
```

### `PostFocus.svelte`

Today's footer renders `{status.summary}` as plain text. When `status.anyFailed`, wrap the failure-bearing portion of the line in a clickable text button. Simplest: wrap the whole summary so the entire footer is a button when `anyFailed`:

```svelte
{#if status.hasAssets}
  <footer class="post-focus__backup" class:post-focus__backup--failed={status.anyFailed}>
    {#if status.anyFailed}
      <button type="button" class="post-focus__backup-button" on:click={() => (failuresOpen = true)}>
        {status.summary}
      </button>
    {:else}
      {status.summary}
    {/if}
  </footer>
{/if}

<BackupFailuresModal
  open={failuresOpen}
  failures={postScopedFailures}
  inventory={inventory /* parent passes this through, see below */}
  title="Backup failures for this post"
  on:close={() => (failuresOpen = false)}
/>
```

`postScopedFailures` is computed reactively:

```ts
$: postScopedFailures = [
  ...$imageHydration.failures
    .filter((f) => imageUrls.includes(f.url))
    .map((f) => ({ ...f, type: 'image' as const })),
  ...$articleHydration.failures
    .filter((f) => f.url === articleUrl)
    .map((f) => ({ ...f, type: 'article' as const })),
];
```

`PostFocus` doesn't currently receive the inventory as a prop — only a single `Save`. Two paths to give the modal access:

- **Option 1**: pass `inventory` down to PostFocus from its parent route.
- **Option 2**: in PostFocus's modal mount, just pass the focused save itself as a one-element pseudo-inventory: `{ saves: [save] }`. The lookup helper accepts the same shape; for a post-scoped modal the failure URLs all belong to this save anyway.

Option 2 is cleaner and avoids a prop drill. Use it.

## Testing

`app/src/lib/find-save-by-asset-url.test.ts` — unit tests:

- Matches `save.images[i].url`.
- Matches `save.embed.images[i].url`.
- Matches `save.embed.url` (article).
- Matches inside `save.thread_replies[i].images[j].url`.
- Matches inside `save.quoted_post.images[i].url`.
- Matches inside `save.quoted_post.thread_replies[i].images[j].url`.
- Returns `null` when no save matches.
- Returns `null` when inventory is `null`, `undefined`, or has no `saves` array.
- Returns `null` when a save has no URL fields.

`app/src/lib/bsky-permalink.test.ts` — unit test for the tiny URL builder:

- Returns the expected `https://bsky.app/profile/{handle}/post/{rkey}` URL.
- URL-encodes both segments.
- Returns a sensible value when `uri` has no slashes (use empty rkey).

No Svelte component-render tests for the modal (consistent with the project's current pattern). Manual smoke at `pnpm dev`:

1. Run an image backup with at least one URL guaranteed to fail (point worker at a bogus path). `BackupStatusRow` shows `(1 failed)` as a clickable red link. Click → modal opens with the failure listed, correct reason, and a "View source post" link that opens the right bsky.app URL in a new tab.
2. Same for article failures — separate trigger, separate modal.
3. Open a focused post that has a failed asset. Footer reads `2 of 3 images saved (1 failed)` in red. The whole footer line is clickable. Click → modal opens scoped to this post; only its failures appear; "View source post" still works.
4. Modal closes on Esc, on backdrop click, and on the close button.

## Risks and mitigations

- **`save.uri` parsing for permalinks.** Existing code in `PostFocus.svelte` does `/\/([^/]+)$/.exec(save.uri)` and falls back to `''`. Extracting that into `bskyPostUrl` preserves the same behavior; tests cover the empty-rkey case.
- **Failures store can change while modal is open.** If the user re-runs while the modal is open, `failures` resets and re-grows. The modal's `failures` prop is reactive, so it updates live. Acceptable — matches expectations.
- **Modal opened with zero failures.** Defensive empty state ("No failures.") covers this; callers shouldn't open with empty lists, but UI shouldn't break if they do.
- **Quoted-post / thread-reply walks.** The lookup helper has to mirror the URL-extraction logic precisely. Easiest way: factor a single `walkSaveUrls(save, visit)` traversal into a shared module if duplication becomes painful, but for one new file it's fine to inline.

## Definition of done

- `BackupFailuresModal` renders rows with reason + URL + "View source post" link.
- `findSaveByAssetUrl` returns the right save for any of the URL locations the inventory uses.
- `bskyPostUrl` is the single source for bsky.app permalinks (PostFocus uses it too).
- `BackupStatusRow` has two distinct "(N failed)" buttons, opening type-scoped modals.
- `PostFocus` footer becomes clickable when `anyFailed`, opening a post-scoped modal.
- Esc / click-outside / close button all dismiss the modal.
- Unit tests for the new helpers pass.
- `pnpm check && pnpm test && pnpm build` clean.

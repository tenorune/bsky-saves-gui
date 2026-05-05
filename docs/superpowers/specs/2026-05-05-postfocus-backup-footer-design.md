# Design: PostFocus per-post backup status footer (Plan 21)

## Goal

When viewing a single saved post in PostFocus, show a one-line summary of how its images and article fared in backup. Reassures the user that this specific post is archived — or surfaces that something failed.

## Scope

- **In scope.** A subdued footer below "View on bsky.app" and above the Thread section. A pure helper that summarizes per-post backup status from the inventory + hydration stores + the IDB image-blob index. Hides when the post has no images and no article URL.
- **Out of scope.** Plan 19's Details modal (this plan exposes failure reasons in the helper output for that plan to consume). Retry buttons in the footer. Inline per-asset icons. Status for images that appear only in `thread` entries — the footer reflects the focused post's `embed`/`images` only.

## Architecture

### `app/src/lib/post-backup-status.ts` (new pure helper)

Single exported function plus types. Pure: takes already-resolved data and returns a summary record. The component handles async data-loading separately and feeds resolved values in.

```ts
import type { Save } from '../reader/inventory-shape';
import type { HydrationProgress } from './hydration-state';

export type AssetState = 'saved' | 'failed' | 'pending';

export interface PostBackupStatus {
  /** False when the post has no images and no article URL — caller hides the footer. */
  hasAssets: boolean;
  images: {
    total: number;
    saved: number;
    failed: number;
    /** Reasons aligned with the failed images, in URL order. For Plan 19's Details modal. */
    failureReasons: string[];
  };
  article: null | { state: AssetState; reason?: string };
  /** True if either hydration store is in the 'running' state. */
  hydrating: boolean;
  /** Ready-to-render line. */
  summary: string;
  /** True if any image or the article failed; the component uses this to apply a red style. */
  anyFailed: boolean;
}

export function getPostBackupStatus(input: {
  save: Save;
  imageUrlsInPost: readonly string[];
  articleUrlInPost: string | null;
  savedImageUrls: ReadonlySet<string>;
  imageHydration: HydrationProgress;
  articleHydration: HydrationProgress;
}): PostBackupStatus;
```

Behavior:

| Inputs | `summary` |
| --- | --- |
| no images & no article | (irrelevant — `hasAssets: false`) |
| nothing attempted, neither store running | `"Not backed up yet."` |
| any store running with at least one pending asset | `"Backing up…"` |
| images only, all saved | `"3 of 3 images saved."` (or `"1 of 1 image saved."` for a single image) |
| article only, saved | `"Article saved."` |
| images only, partial | `"2 of 3 images saved (1 failed)."` (`anyFailed: true`) |
| article only, failed | `"Article failed."` (`anyFailed: true`) |
| images + article, all saved | `"3 of 3 images saved · article saved."` |
| images + article, mixed | `"2 of 3 images saved (1 failed) · article failed."` (`anyFailed: true`) |
| images saved, article still pending (helper found no result yet, no failure) | `"3 of 3 images saved · article not backed up yet."` |
| no images saved + article not attempted, hydration idle, store status was 'idle' (never run) | `"Not backed up yet."` |

### Per-asset state derivation (inside the helper)

For each image URL in the post:

- If the URL is in `savedImageUrls` → `'saved'`.
- Else if `imageHydration.failures` contains an entry with this URL → `'failed'` (with `reason`).
- Else → `'pending'`.

For the article URL:

- If `save.article_text` is a non-empty string → `'saved'`.
- Else if `articleHydration.failures` contains an entry with this URL → `'failed'` (with `reason`).
- Else → `'pending'`.

`hydrating = imageHydration.status === 'running' || articleHydration.status === 'running'`.

`anyFailed = images.failed > 0 || article?.state === 'failed'`.

### `app/src/lib/image-store.ts` — add a small helper

```ts
/**
 * Given a set of image URLs, return the subset that already have blobs in IDB.
 * Used by PostFocus to render per-post backup status.
 */
export async function getSavedImageUrls(urls: readonly string[]): Promise<Set<string>>;
```

Implementation reads each URL's blob with the existing `getImageBlob`-style accessor and includes it in the result set when the value is defined. (Match the file's existing pattern; if there's already a `hasImageBlob(url)` predicate, build on top of it.)

### `app/src/reader/PostFocus.svelte`

Add a footer below the existing `<p class="post-focus__link">…View on bsky.app…</p>` block and above the `{#if thread.length > 0}` thread section.

Component logic:

1. On mount + whenever the `save` prop changes, derive `imageUrlsInPost` (from `save.embed?.images?.[].url` and any other shape the inventory uses for the focused post), and `articleUrlInPost` (from `save.embed?.url` when it looks like an article URL — i.e., the same shape that the article hydrator targets).
2. Subscribe to `imageHydration` and `articleHydration` stores.
3. Reactive declaration: `savedImageUrls` is fetched via `getSavedImageUrls(imageUrlsInPost)`. Re-fetch whenever `$imageHydration.fetched` changes (so newly saved blobs get reflected).
4. Reactive declaration: pass everything into `getPostBackupStatus`. Get `{ hasAssets, summary, anyFailed }`.
5. Template: `{#if hasAssets} <footer class="post-focus__backup" class:post-focus__backup--failed={anyFailed}>{summary}</footer> {/if}`.

CSS:

```css
.post-focus__backup {
  margin-top: 0.5rem;
  font-size: 0.85rem;
  opacity: 0.7;
}
.post-focus__backup--failed {
  color: color-mix(in oklab, red 70%, CanvasText);
  opacity: 0.95;
}
```

## Testing

`app/src/lib/post-backup-status.test.ts` — unit tests for the summarizer covering:

- No assets → `hasAssets: false`.
- Images only, none saved, both stores idle → `"Not backed up yet."`.
- Article only, saved → `"Article saved."`.
- 3 images, 3 saved → `"3 of 3 images saved."`.
- 1 image, 1 saved → `"1 of 1 image saved."` (singular form).
- 3 images, 2 saved, 1 failed → `"2 of 3 images saved (1 failed)."`, `anyFailed: true`, `failureReasons` length 1.
- 3 images + article, all saved → `"3 of 3 images saved · article saved."`.
- 3 images + article, mixed → `"2 of 3 images saved (1 failed) · article failed."`, `anyFailed: true`.
- Hydration `running`, at least one pending → `"Backing up…"` regardless of partial state.

No Svelte component-render tests. Manual smoke at `pnpm dev`:

1. Open a saved post with neither images nor article URL — footer hidden.
2. Open a saved post with images, before any backup run — footer reads "Not backed up yet."
3. Run image backup. Open the same post mid-run — footer reads "Backing up…".
4. After the run completes — footer reads e.g. "3 of 3 images saved." Add an article and run article backup; footer transitions to "3 of 3 images saved · article saved."
5. Force a failure (point a worker at a URL it'll reject). Footer reads "2 of 3 images saved (1 failed)." in red.

## Risks and mitigations

- **IDB lookup cost on every store update.** A post has at most ~4 image URLs; `getSavedImageUrls` does that many `idb-keyval` `get`s. Cheap. We re-run only when `$imageHydration.fetched` changes (typically once per fetched URL during a run, then settles).
- **Article URL detection in PostFocus mirrors logic in `extract-article-urls.ts`.** Avoid duplication by re-using that module if possible. If its API doesn't expose a per-save query, keep it in sync by referring to the same `save.embed?.url` field.
- **Helper-only-running edge case.** Backing up succeeds → `save.article_text` is set → footer reads "Article saved." Even if the store was reset between sessions, the inventory persists, so the footer still shows "Article saved." after reload. Good.
- **Hydration cancelled mid-run.** Cancelled status leaves the store in `'cancelled'`. Treat as not running (no `"Backing up…"`); the per-asset states reflect actual saves and failures.

## Definition of done

- `app/src/lib/post-backup-status.ts` exports `getPostBackupStatus` and the types. Pure function.
- `app/src/lib/image-store.ts` has `getSavedImageUrls(urls)` (or equivalent, matching existing patterns).
- `app/src/reader/PostFocus.svelte` renders the footer when `hasAssets`, with red styling on failures.
- Unit tests for the summarizer pass.
- `pnpm check && pnpm test && pnpm build` clean.
- Manual smoke confirms the five scenarios.

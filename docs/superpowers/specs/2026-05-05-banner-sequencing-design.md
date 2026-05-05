# Design: image banner gates the article banner (Plan 20)

## Goal

When both the image-backup and article-backup discovery banners are eligible to render in the Library view, show only the image one until it's dismissed or its conditions stop holding. Hide the article banner during that window so the user makes one decision at a time.

## Scope

- **In scope.** Library view banner stacking. The article banner gates on the image banner's visibility — visual sequencing only.
- **Out of scope.** Runtime sequencing of image vs. article hydration runs (deferred). Settings → Backup section UI. The `BackupStatusRow` progress display. Adding the project's first Svelte component-render tests.

## Architecture

A tiny shared store coordinates the two banners.

### New module: `app/src/lib/backup-banner-state.ts`

```ts
import { writable, type Writable } from 'svelte/store';

/**
 * Tracks whether the image-backup discovery banner is currently visible.
 * Used by ArticleBackupBanner to suppress itself while the image banner is
 * showing, so the user makes one decision at a time.
 */
export const imageBannerVisible: Writable<boolean> = writable(false);
```

### `BackupBanner.svelte` (image)

Add the import and one reactive write so the store mirrors the local `visible`:

```svelte
import { imageBannerVisible } from '$lib/backup-banner-state';
...
$: imageBannerVisible.set(visible);
```

Plus an `onDestroy` that resets to `false`, so the article banner is no longer gated if `Library.svelte` unmounts the image banner (e.g., the user navigates away while it's still visible):

```svelte
import { onDestroy } from 'svelte';
...
onDestroy(() => imageBannerVisible.set(false));
```

### `ArticleBackupBanner.svelte`

Add the import and one term to the existing visibility conjunction:

```svelte
import { imageBannerVisible } from '$lib/backup-banner-state';
...
$: visible = !$imageBannerVisible && prefsAllow && articleCount > 0 && status === 'idle';
```

## Behaviour

| Image banner state | Article banner |
| --- | --- |
| Eligible & rendering | Hidden |
| Snoozed (Remind me later) | Eligible (subject to its own conditions) |
| Dismissed (Don't ask me again) | Eligible |
| User clicked Save (image hydration started) | Eligible |
| Image hydration finished | Eligible |
| No images in inventory | Eligible |
| Image prefs forbid (don't-ask already set, snooze active) | Eligible |
| Library route unmounted | Eligible (store reset) |

The article banner becomes eligible the moment the image banner stops being visible, regardless of *why* it stopped.

## Testing

`app/src/lib/backup-banner-state.test.ts` — a minimal unit test confirming the store defaults to `false` and round-trips on `set()`. The behavior under the hood is just `svelte/store` so this is mostly a smoke test of the import and the default value.

No Svelte component-render tests are added — that would require introducing the project's first banner-rendering test scaffold for a one-line gating change. Manual verification at `pnpm dev`:

1. With both image and article URLs in inventory and both banners eligible: only the image banner renders.
2. Click "Don't ask me again" on the image banner → the article banner appears immediately.
3. Click "Save my own copy" on the image banner → image banner disappears (hydration started) → the article banner appears.

## Risks and mitigations

- **Store value persists between Library mounts.** If a different page sets `imageBannerVisible` to `true` and never resets, the article banner could stay hidden. Mitigation: only `BackupBanner` writes the store, and its `onDestroy` resets to `false`. No other writers.
- **Race during component initialization.** `BackupBanner` writes `visible` on every reactive update, including its initial `false → true` transition after `onMount` resolves. ArticleBackupBanner derives from `$imageBannerVisible` reactively, so it picks up changes within the same tick. No issue expected.

## Definition of done

- New store module exists and is exported.
- `BackupBanner` updates the store on every reactive `visible` change and resets it on destroy.
- `ArticleBackupBanner` includes `!$imageBannerVisible` in its visibility expression.
- The store's unit test passes.
- `pnpm check && pnpm test && pnpm build` clean.
- Manual smoke check confirms the three scenarios above.

# Design: align article-backup CTAs + fix worker launcher (Plan 18)

## Goal

Make the article-backup buttons say what they actually do, and make them actually work for users whose only backend is a custom Cloudflare Worker.

Two related strands shipped together:

1. **Launcher fix.** `startArticleBackup` rejects when the local helper isn't reachable, even if the user's worker supports article extraction. This is a Plan 22 oversight: the article hydrator was updated to fall back to the worker, but the gatekeeper before the hydrator was not.
2. **CTA alignment.** The banner / Settings buttons today read "Set up backup →" / "Set up article backup", which sounds like they open a wizard. They actually start the backup run immediately. Rename to match the image banner's verb ("Save my own copy") and drop the trailing arrow everywhere.

## Scope

- **In scope.** `app/src/lib/start-article-backup.ts` precheck logic and tests, button + body copy in `BackupBanner.svelte` (image), `ArticleBackupBanner.svelte` (article), and `Settings.svelte` (article row). One commit cluster.
- **Out of scope.** Confirm modals or count-preview UIs (user picked direct-action). Sub-text wording in either banner ("Will use…" already names the backend). The `[Disable]` button copy. Image-backup launcher changes (already supports all three backends).

## Architecture

### Launcher fix

`app/src/lib/start-article-backup.ts` currently:

```ts
const helper = await probeConfiguredHelper();
if (helper.status !== 'available') {
  return { started: false, reason: 'Article backup needs the local bsky-saves helper. ...' };
}
if (!helper.features.includes('extract-article')) { ... }
// ...spawn hydrator...
```

After Plan 18:

```ts
const helper = await probeConfiguredHelper();
const helperOk = helper.status === 'available' && helper.features.includes('extract-article');
if (!helperOk) {
  const proxy = await loadProxyConfig();
  if (!(proxy && proxy.supportsArticles)) {
    return {
      started: false,
      reason: 'no article backend available — start the local helper or set up a custom worker that supports article extraction',
    };
  }
}
// ...spawn hydrator (it picks the backend itself via makeDefaultFetcher)...
```

Notes:

- We no longer need to surface the older "Local helper does not advertise article extraction. Update bsky-saves." message as a distinct branch — that branch falls through to the worker check; if the worker is also unavailable, the unified error covers both.
- The hydrator already does its own backend selection via `makeDefaultFetcher`, so the launcher only needs to validate that *some* backend is reachable. It doesn't decide which.

### CTA alignment

Standardize on the image banner's verb pattern. All three buttons + the two banner body copies use "Save my own copy" / "Save your own copy" with no trailing arrow.

| Location | Before | After |
| --- | --- | --- |
| `BackupBanner.svelte` body | "…Save your own copy →" | "…Save your own copy." |
| `BackupBanner.svelte` button | "Save my own copy →" | "Save my own copy" |
| `ArticleBackupBanner.svelte` body | "…Set up backup →" | "…Save your own copy." |
| `ArticleBackupBanner.svelte` button | "Set up backup →" | "Save my own copy" |
| `Settings.svelte` Articles row button | "Set up article backup" | "Save my own copy" |

The banners' existing sub-text ("Will use the local helper" / "Will use your custom Cloudflare Worker") still tells the user which backend will be used, so no extra disambiguation is needed in the button label.

## Testing

- `app/src/lib/start-article-backup.test.ts` — add three cases:
  - Helper available + has `extract-article` feature → `started: true`. (Existing test; keep.)
  - Helper unavailable + proxy config with `supportsArticles: true` saved → `started: true`.
  - Helper unavailable + no proxy config (or `supportsArticles: false`) → `started: false`, `reason` matches the new unified string.
- Existing tests covering "helper missing extract-article feature" should be updated to assert the new fallback behaviour (worker takes over if available, else the unified error).
- No new tests for the copy change; render tests aren't currently the project's pattern.

## Risks and mitigations

- **The unified error message is less specific than the old "needs the local helper" message.** Acceptable — the banner sub-text already names what the user has and what they could set up, so the button-error duplication isn't valuable. The unified error matches what the hydrator already throws when it hits the no-backend branch (Plan 22).
- **Image banner copy is changing slightly.** Removing the arrow is a tiny visual diff; the verb stays the same, so muscle memory still works.

## Definition of done

- `startArticleBackup` accepts either the helper (with `extract-article` feature) OR a proxy config with `supportsArticles: true`.
- Article banner button + Settings article row button both read "Save my own copy" with no trailing arrow.
- Image banner body + button drop the trailing arrow.
- Article banner body ends with "Save your own copy." (matches image banner pattern).
- New launcher tests pass; existing tests updated for the new fallback behaviour.
- `pnpm check && pnpm test && pnpm build` clean.

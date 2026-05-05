# Design: Settings → Backup UX redesign + banner / footer copy alignment

## Goal

Replace the confusing `enabled / disabled / not yet enabled / don't ask me / setup` vocabulary with a verb-first model centered on `Save my own copy` + `Hide reminder`. Make Settings → Backup show progress in place when the user clicks Save, so they no longer have to navigate to Library to confirm anything is happening. Eliminate dead-end "no backend" messages by linking the user straight to the Setup Guide.

## Scope

- **In scope.** Settings → Backup section (two symmetric rows). Banner copy in `BackupBanner` and `ArticleBackupBanner` (rename `Don't ask me again` → `Hide reminder`). Article banner sub-text gets a setup link when no backend. PostFocus footer wording aligns with Settings. A new pure helper for the status-line string.
- **Out of scope.** Auto-running backup as new saves arrive. Re-imagining the `Remind me later` (snooze) banner action. Surfacing failure details inline in Settings (Plan 19's modal already does that). Persistent backup state across sessions beyond what the existing image-store + inventory already provide.

## Architecture

### Settings → Backup section

Two symmetric rows. Same shape per domain:

```
{Domain title}
  {status line — reactive on hydration store}
  [ Save my own copy ]   ← while running: [ Stop ]
  ☐ Hide reminder
```

Wiring:

- **Save / Stop button.** Click → `startImageBackup(inventory)` or `startArticleBackup(inventory)`. While `imageHydration.status === 'running'` (or article equivalent), the button label becomes `Stop` and `on:click` calls `cancelImageBackup` or `cancelArticleBackup`.
- **Hide reminder checkbox.** Bound to `backupPrefs.{domain}.dontAsk`. Same underlying preference as today's "Don't ask me again" banner action.
- **Status line.** Reactive string derived from hydration store + `describeAvailableImageBackend` / `describeArticleBackend` results. See helper below.

The button being clickable does not depend on backend availability; if no backend is available, the click surfaces the existing inline error (`articleSetupError` for articles, similar for images). Status-line text guides the user toward setup before they click.

### `app/src/lib/backup-status-line.ts` (new pure helper)

Single function that derives the status line string and any link target from the inputs.

```ts
import type { HydrationProgress } from './hydration-state';

export interface BackupStatusLineInput {
  domain: 'images' | 'articles';
  hydration: HydrationProgress;
  backendDescription: string | null;  // null when no backend is available
}

export interface BackupStatusLine {
  text: string;
  /** When set, the trailing word/phrase of `text` is a link.  */
  link: null | { kind: 'setup'; phrase: string } | { kind: 'library'; phrase: string };
}

export function buildBackupStatusLine(input: BackupStatusLineInput): BackupStatusLine;
```

Output cases:

| Inputs | text | link |
| --- | --- | --- |
| status `idle`, backend available | `Not yet saved · would use {description}` | `null` |
| status `idle`, no backend | `Not yet saved · no backend available — Set up a backend` | `{ kind: 'setup', phrase: 'Set up a backend' }` |
| status `running` | `Saving {fetched + skipped} of {total} {noun}…` | `null` |
| status `done`, total > 0, no failures | `{fetched + skipped} of {total} {noun} saved` | `null` |
| status `done`, total > 0, failures > 0 | `{succeeded} of {total} {noun} saved ({failed} failed)` | `null` (the failed count is a separate clickable element handled by `BackupStatusRow`'s existing failures-modal trigger; not part of the status-line string) |
| status `cancelled` | `Stopped at {succeeded} of {total} {noun}` | `null` |

`{noun}` is `image`/`images` or `article`/`articles` based on `domain` and `total`.

The "(N failed)" clickable failures-modal trigger already exists in `BackupStatusRow` (Plan 19). The new Settings rows render it inline alongside the status-line text. `BackupStatusRow` is the existing component used in Library; in Settings we want the same shape but inline within the Backup section. Two reasonable implementations:

- **Option A**: extract a reusable `<BackupRow domain="images" inventory={...} />` component containing status-line + button + failures-modal mounts, and use it in both Library (replacing parts of `BackupStatusRow`) and Settings.
- **Option B**: keep `BackupStatusRow` Library-only; build a parallel inline render in `Settings.svelte` that uses the same helper but is rendered/styled independently.

Pick **Option A** — DRY, single source of truth for status copy and behavior. `BackupStatusRow` becomes a thin wrapper over `<BackupRow images …> <BackupRow articles …>` (or simply renders both rows side-by-side as today), and Settings imports `BackupRow` directly.

### `app/src/components/BackupRow.svelte` (new)

Props:

```ts
export let domain: 'images' | 'articles';
export let inventory: unknown;
```

Internally subscribes to the appropriate hydration store + describe-backend helper, builds the status line via `buildBackupStatusLine`, renders status text + Save/Stop button + the existing failures-modal trigger if `failures > 0`. Dispatches no events; emits no progress upward.

The existing `BackupStatusRow.svelte` is rewritten as a thin parent that mounts `<BackupRow domain="images" />` then `<BackupRow domain="articles" />` (or both — only renders rows that have non-empty hydration state if we want to preserve "hidden when idle" behavior on Library; see below).

### Visibility semantics

- **In Library (current `BackupStatusRow` behavior):** the row is hidden when both stores are idle (today's `{#if status !== 'idle' || aStatus !== 'idle'}`). Keep this on Library — the row is purely a progress indicator there, not a launcher.
- **In Settings:** rows are always visible (the Save button is the launcher). Status line just reads `Not yet saved · …` when idle.

The simplest way to express both: `<BackupRow>` accepts a `mode: 'library' | 'settings'` prop. In `'library'` mode it hides itself when idle. In `'settings'` mode it always renders and includes the Save/Stop button + Hide reminder checkbox; in `'library'` mode it hides those (Library has banners as the launchers, the row only shows progress).

```ts
export let domain: 'images' | 'articles';
export let inventory: unknown;
export let mode: 'library' | 'settings';
```

### Settings.svelte changes

The current Backup section's per-domain rendering is replaced with:

```svelte
<section class="settings-section">
  <h3>Backup</h3>
  <p class="help">…short framing copy …</p>

  <BackupRow domain="images" {inventory} mode="settings" />
  <BackupRow domain="articles" {inventory} mode="settings" />

  <details ...>Advanced backup options ... [unchanged] </details>
</section>
```

The current Settings logic for `imagesBackendLabel`, `articlesBackendLabel`, `handleSetUpArticles`, `handleDisableImages`, `handleDisableArticles`, `handleToggleDontAsk`, `handleToggleArticlesDontAsk`, etc. is removed — `BackupRow` owns all of that internally. The `backupSectionVisible` reactive declaration is replaced by always rendering the section when an inventory is loaded (the section is informational either way).

### Banner copy alignment

In `BackupBanner.svelte` and `ArticleBackupBanner.svelte`:

- Rename the third action button from `Don't ask me again` to `Hide reminder` (no behavior change; same `setBackupDontAsk(domain, true)` call).
- Snooze button label `Remind me later` stays.

In `ArticleBackupBanner.svelte`, replace the sub-text when `articleBackendStatus.available === false`:

```svelte
{:else}
  Article backup needs the local bsky-saves helper or a custom Cloudflare
  Worker with article extraction.
  <button type="button" class="article-banner__inline-link" on:click={openSetupModal}>
    Set up a backend
  </button>
{/if}
```

Where `openSetupModal` dispatches a `setup` event or directly opens a `<CustomProxySetupModal>` mounted from this component. Simpler: emit an event the parent (Library) can wire to its existing setup-modal-open state — but Library doesn't currently render the setup modal, so the banner mounts its own:

```svelte
<CustomProxySetupModal
  open={setupOpen}
  on:close={() => (setupOpen = false)}
  on:change={() => /* re-derive backend status */}
/>
```

Alternatively, the banner navigates to `#/settings` so the user sees the existing setup affordance there. Pick **mount-its-own-modal** so the user doesn't have to context-switch.

The image banner already gates on backend availability via `backendDesc !== null`; its existing sub-text already references "set up the local helper or a custom Cloudflare Worker first (Settings → Backup → Advanced)". For consistency, make the "(Settings → Backup → Advanced)" phrase a button that opens the setup modal in place.

### PostFocus footer wording

In `app/src/lib/post-backup-status.ts` (the `summary` field) and the `PostFocus.svelte` template, replace `"Not backed up yet."` with:

- Backend available (image OR article available): `Not yet saved — go to Library to save.` (trailing phrase is a link; navigates to `#/library`)
- No backend at all: `Not yet saved — set up a backend.` (trailing phrase opens the Setup Guide modal in place, same approach as the article banner)

The summarizer's helper signature gains a `setupAvailable: boolean` input (true if any backend is available across both domains), and returns an additional `link: 'library' | 'setup' | null` field so the component can render the trailing phrase as the right kind of link.

## Testing

`app/src/lib/backup-status-line.test.ts` — pure helper tests covering the seven cases in the table above (`idle`-with/without-backend, `running`, `done` with/without failures, `cancelled`, plus singular-vs-plural noun for total === 1).

`app/src/lib/post-backup-status.test.ts` — extend existing tests to assert the new `link` field returns `'library'` when at least one backend is available and `'setup'` when none, in the `Not yet saved` case.

No new Svelte component-render tests (consistent with project pattern). Manual smoke at `pnpm dev`:

1. Open Settings → Backup. Confirm both rows visible with `Not yet saved · would use …` status. Click Save my own copy on Images. Status line transitions through `Saving…` to `12 of 47 images saved` without leaving Settings. The Save button becomes Stop while running.
2. Tick the Hide reminder checkbox. Reload, navigate to Library. The image banner is gone.
3. Tick Hide reminder, then untick it. Banner reappears.
4. Disconnect the helper (or stop bsky-saves serve) and clear the proxy config. Article row's status line becomes `Not yet saved · no backend available — Set up a backend`. Click the link; Setup Guide modal opens.
5. Open a focused post with no backend available; footer reads `Not yet saved — set up a backend`; click the link — same modal opens.
6. With a backend available, footer reads `Not yet saved — go to Library to save`; click — navigates to Library.

## Risks and mitigations

- **Removing per-domain Settings handlers (`handleSetUpArticles`, `handleDisableImages`, etc.) is a real refactor.** All their behavior moves into `BackupRow`. The risk is a behavior regression for edge cases (e.g., the `articleSetupError` inline message). Mitigation: `BackupRow` reproduces all current behaviors (start, stop, error display, dontAsk toggle) and the manual smoke test exercises each.
- **`BackupRow` mode switching adds a prop with two values.** If we ever need a third mode, the prop expands. Acceptable for now — both call sites are well-defined.
- **PostFocus's setup-modal mount duplicates the modal already mounted by the article banner.** Both can be open in different routes, but Svelte handles multiple instances fine. They share no state.
- **Inline link styling consistency.** The "Set up a backend" / "go to Library" trailing phrases need a single shared inline-link style so they look the same wherever they appear. A small `.inline-link` utility class (or scoped per component with the same rule) keeps it consistent.

## Definition of done

- New `BackupRow.svelte` component exists with the documented props and replaces the per-domain logic in both Library and Settings.
- New `buildBackupStatusLine` helper covers the documented cases and is tested.
- `post-backup-status.ts` returns a `link` field driving the new `Not yet saved` phrasing.
- Banner CTA renames in both banners.
- Article banner sub-text and PostFocus footer route the user to setup or library appropriately.
- All existing tests pass; new tests for the helper.
- `pnpm check && pnpm test && pnpm build` clean.

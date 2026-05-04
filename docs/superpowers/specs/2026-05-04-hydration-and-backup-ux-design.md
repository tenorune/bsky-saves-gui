# Hydration & Backup UX

**Date:** 2026-05-04
**Status:** Design — pending review and implementation plan
**Project:** bsky-saves-gui

## Summary

Redesign the user experience around hydration (images and articles) so that:

- A non-technical user gets a working library in seconds without configuring anything.
- The concept of "save my own copy" is introduced *after* the user has a library to point at, not as upfront setup friction.
- Image and article backup are independent decisions, each with its own trigger, setup flow, and status.
- Backup runs in the background while the user reads, with live status indicators.
- Settings reflects the user's actual state, not every possible configuration knob.
- The local helper, the bsky-saves CLI, and the operator-hosted proxy form a layered fallback strategy so users at every skill level have a viable path — but no path is forced.

This design depends on `bsky-saves serve` (a new CLI subcommand specced separately in `docs/bsky-saves-serve-requirements.md`).

## Audience

| Tier | Description | Design priority |
|---|---|---|
| **A** | Non-technical Bluesky user. Doesn't know what a CDN is, won't deploy a worker, won't install Python from the command line. | Primary — happy path must serve them. |
| **B** | Semi-technical, comfortable with `pip install` and copying terminal commands when walked through them. | Secondary — secondary "install the helper" path. |
| **C** | Technical user who already runs `bsky-saves` CLI or knows `wrangler deploy`. | Catered to via opt-in advanced options; never forced into beginner UX. |

## Conceptual model

The core framing is **backup**, not "offline." Without hydration, the library still works — the user can read post text, dates, threads, and click through to bsky.app. What hydration adds is a copy *the user owns*: images won't break if Bluesky removes the post or rotates the CDN, articles stay readable if the original goes paywalled or vanishes. It's about durability, not connectivity.

Two separate backup decisions: **images** and **articles**. They have different cost profiles, different trust profiles, and different setup options, so they get independent banners, independent setup wizards, and independent status.

## Layered backend strategy

For each backup feature, the app probes a priority-ordered list of backends and uses the first that responds:

| Priority | Backend | Available for | Privacy from operator | User setup |
|---|---|---|---|---|
| 1 | Local helper at `127.0.0.1:47826` (`bsky-saves serve`) | images, articles | Total | `pip install bsky-saves` + run command |
| 2 | User-configured Cloudflare Worker (URL+secret in Settings) | images, articles | Total | `wrangler deploy` + paste URL into Settings |
| 3 | Operator-hosted Cloudflare Worker (URL configured at build time) | images only | Bytes flow through operator | None for the user; operator must deploy |

The operator proxy is **optional infrastructure**, surfaced only when the deploy has it configured (via `VITE_OPERATOR_IMAGE_PROXY_URL` env var or similar). When unset, the app simply omits that option from the wizard and user must install a helper or deploy a worker.

The operator proxy is intentionally **never** offered for articles. Article extraction is a generic open-web fetch+parse, which is the wrong abuse profile for a centrally-hosted service.

## First-fetch flow (sign-in)

The current Sign In screen exposes Advanced toggles for enrich/threads/images/etc. Two of those go away.

**Defaults for first fetch:**

| Step | Default | UI |
|---|---|---|
| Pull in saved posts | on | (the whole point — not exposed) |
| Add precise dates (enrich) | **on, no toggle** | hidden; always runs |
| Save same-author thread replies | **on, toggle stays** | one checkbox in Advanced; user can opt out |
| Save own copy of images | not in first fetch | (handled later via banner) |
| Save own copy of articles | not in first fetch | (handled later via banner) |

Rationale for dropping the enrich toggle: there is no plausible user who wants the save date instead of the post date. The toggle exists because bsky-saves' fetch step alone produces save dates; enrich annotates with post dates. Always-on, no choice.

Rationale for keeping the threads toggle (default on): it's a real cost (extra API calls per anchor save), and a user might reasonably want a faster fetch. Default-on respects the most common preference; toggle respects the dissenting one.

Net result: first-run UI shows zero or one toggle (depending on whether the user opens Advanced). Sign in → click Get my saves → library appears.

## Backup discovery: just-in-time banners

After the first fetch (or any subsequent fetch that newly satisfies a condition), the Library page may show one banner at a time, in order:

### Banner ordering

- Image banner shows first if applicable.
- Article banner is suppressed while the image banner is visible.
- After the image banner is dismissed (any way) or its feature is enabled, the article banner appears next time the page renders, if applicable.

### Image-backup banner

- **Where:** top of Library page, below header, above feed.
- **When:** rendered iff (image-backup is not enabled) AND (the library contains ≥1 save with images) AND (user has not permanently dismissed) AND (user has not snoozed within the last 7 days).
- **Copy:** *"12 of your saves include images. They'll work as long as Bluesky keeps them online. Save your own copy →"* (count is dynamic)
- **Actions:** primary button opens setup wizard (see below). Secondary link "Remind me later" snoozes for 7 days. Tertiary link "Don't ask me again" sets a permanent dismissal.

### Article-backup banner

- Same shape, swapping "images" → "articles" and counting saves with linked articles.
- Adds a footnote: *"Article backup needs the local helper or your own worker."* This sets honest expectation that this isn't a one-click thing for A-tier users.

### Permanent dismissals

Both "Don't ask me again" actions surface in Settings as toggleable preferences (so the user can change their mind later). See Settings section.

## Setup wizard

Triggered by clicking the primary button in either banner, or by Settings → "Set up [image|article] backup."

### Happy path (a backend is already detected or configured)

The wizard probes silently on open. If something works, it shows a one-screen confirmation:

```
Save your own copy of images
Using your local bsky-saves helper. ✓
[ Save now ]   [ Cancel ]

Use a different method ▸
```

Click "Save now" → wizard closes, banner is replaced by the live status row, hydration starts in the background.

### First-time path (nothing is configured)

Single recommended option, with alternatives tucked under a disclosure. The recommendation is computed from what's available:

| Feature | Operator proxy configured? | Recommendation |
|---|---|---|
| Images | Yes | "Use the operator's proxy — one click" |
| Images | No | "Install the local helper" |
| Articles | n/a | "Install the local helper" |

Helper-recommendation copy:

```
To save your own copy of images, you need a way to download them.
The easiest is to install bsky-saves on your computer.

  1.  pip install bsky-saves
  2.  bsky-saves serve
  3.  [ Check for helper ]

Other ways to set this up ▸
```

The disclosure expands to show:

- **Operator proxy** (if configured): one-click "Use it" with a small "what is this?" link to a Privacy doc section.
- **Custom Cloudflare Worker:** URL + secret fields + a "Deploy your own" link to docs.

After configuration succeeds, the wizard closes and behaves like the happy path.

### Cancel

Returns to Library with banners intact (not dismissed). User can come back any time.

## Background hydration

Image and article hydration runs in the **main thread** as an async loop. The fetch loop is just `await` over a list of URLs; each iteration writes a Blob to IndexedDB and updates a Svelte store with progress.

### Why main thread is fine

- Helper-mediated fetches are HTTP requests to `127.0.0.1` — millisecond latency, browser handles them concurrently up to its default cap.
- Each `await` yields to the event loop, so Library scrolling and rendering continue smoothly.
- No service worker, no dedicated web worker. The Pyodide worker stays solely for Python work.

### State

A singleton store, `hydrationState`, exposes:

```ts
{
  feature: 'images' | 'articles',
  status: 'idle' | 'running' | 'paused' | 'done' | 'cancelled',
  total: number,        // total URLs to fetch this run
  fetched: number,      // successful in this run
  skipped: number,      // already cached, skipped this run
  failed: number,       // failed in this run, with reasons retained
  failures: { url, reason }[]
}
```

Two stores in practice — one per feature — since they can run independently.

### Idempotency and resumability

Each fetched blob is keyed by URL in IndexedDB. The hydration loop checks the cache before fetching; cached items count as "skipped." This means:

- Closing the tab mid-run is safe; reopening and re-enabling backup picks up where it left off.
- Re-running backup after new saves are added is cheap — only the new URLs are fetched.
- A failed fetch is retried on the next run automatically (it isn't cached, so it shows up in the next "to fetch" list).

### Cancellation and disable

Two related but distinct actions:

- **Stop** (in the Library status row, only while a run is in progress): cancels the current background run. The feature stays enabled. The next time the user adds new saves and runs Update, hydration resumes for the new items. Cached blobs stay cached.
- **Disable** (in Settings → Backup): cancels any in-progress run AND turns the feature off. No future runs trigger automatically. Cached blobs stay cached (re-enabling restores them); the user can clear them via Reset → "Clear all local data."

Re-enabling a feature that was Disabled re-runs hydration for any items not already cached.

## Library page changes

Below the route header, above the feed:

```
Library

  [ ⚠ Image-backup banner ]            ← if applicable
  [ ⚠ Article-backup banner ]           ← if applicable; mutually exclusive with image banner
  [ ✓ Backup status row ]               ← if any backup feature is enabled

  ── feed ──
```

Banner and status row never coexist for the same feature — once the user enables image backup, the image banner is replaced by the image portion of the status row.

### Backup status row

Shown if either feature is enabled. Hidden if both are off.

```
Backup status
  Images: 142 of 156 saved   Articles: 8 of 12 saved   [ Show details ]
```

States per feature, in display order:

| State | Display |
|---|---|
| Backup not enabled, or no items of this type | omit this part of the row |
| Enabled, all saved | "Images: all 156 saved" |
| Enabled, partial (no run in progress) | "Images: 142 of 156 saved" |
| Enabled, currently running | "Images: 47 of 156 saved (in progress) [ Stop ]" |
| Enabled, run cancelled | "Images: 47 of 156 saved (paused) [ Resume ]" |
| Enabled, all failed | "Images: 0 of 156 saved [ See failures ]" |

If both features are off, the row hides.

### Show details modal

A modal overlay that lists failures grouped by feature. For each failure: post permalink, image/article URL, reason if known. Closes via Esc or backdrop click.

## PostFocus changes

Below the post body, above the link to bsky.app, a small footer appears only if there's something to say:

```
─────────────────────
Backup status
  Images: 3 saved ✓     Article: not saved (404)
```

Per-feature display states:

| State | Display |
|---|---|
| Backup not enabled (regardless of post content) | omit this line |
| Backup enabled, post has none of this type | omit this line |
| Backup enabled, all saved on this post | "Images: 3 saved ✓" or "Article: saved ✓" |
| Backup enabled, partial | "Images: 2 of 3 saved (1 failed)" |
| Backup enabled, all failed | "Images: not saved (3 failed)" |

If both lines are omitted, the footer block does not render.

The footer subscribes to the same hydration stores; when an image arrives mid-view, the footer updates and the broken `<img>` swaps to the local blob without page reload.

## Settings page

Sections are **conditional** on user state. A non-technical user who never touched backup sees a small page; a power user with everything configured sees a complete one.

```
Settings

Account
  Signed in as @handle.bsky.social
  [ Sign out ]

Library
  156 saves, last updated 2026-05-03
  [ Export inventory file ]   [ Import inventory file ]

Backup                           ← shown after user has interacted with backup
  Images: enabled (using local helper, bsky-saves 0.2.4)
          [ Disable ]
  Articles: not set up
          [ Set up article backup ]

  [ ] Don't ask me about image backup
  [ ] Don't ask me about article backup

  Advanced backup options ▸       ← collapsed disclosure
    Custom worker URL: __________
    Shared secret:     __________
    [ Save ]   [ Test connection ]
    Operator proxy: <url> (status: reachable)

Reset
  [ Clear all local data ]
```

### When the Backup section shows

Visible from the moment the user does any of:
- Clicks a backup banner (any action — including dismissals).
- Opens the setup wizard from any path.
- Imports a JSON inventory that contains `local_images` data (signal that backup is meaningful to them).

Once visible, stays visible — never auto-hides.

### Backup section when fully opted out

If the user ticks both "Don't ask me again" boxes (or sets them via the banners), the Backup section remains visible as a status row:

```
Backup
  You've asked us not to prompt about backup.   [ Change my mind ]
```

"Change my mind" un-ticks both Don't-ask boxes and re-enables banner triggers on the next eligible Library load.

### Advanced backup options

A collapsed disclosure inside the Backup section. Contents:

- **Custom worker URL** + **Shared secret** + **Save** + **Test connection** — replaces the current top-level proxy fields.
- **Operator proxy info** (read-only, shown only if configured): URL and reachability status. Transparency without obtrusiveness.

A-tier users never expand this. C-tier users find it where they expect it.

### Account section

New. Replaces the implicit "delete inventory to sign out" model. Shows handle and a real Sign out button that clears the session token without touching the inventory.

### Reset

Stays a separate, last section because it's destructive.

## CLI and JSON import

Two CLI workflows are first-class:

### `bsky-saves serve` (helper mode)

The web app probes for the helper at startup, on Settings open, and at first backup attempt. When detected, it's used as the highest-priority backend for image and article hydration. C-tier users running `bsky-saves serve` get full GUI functionality with full privacy.

This subcommand is specified in `docs/bsky-saves-serve-requirements.md`.

### `bsky-saves fetch` + Import

Users who run `bsky-saves fetch` from the terminal can import the resulting `saves_inventory.json` via Settings → Import. After import, they can:

- Use the GUI as a reader for the imported inventory.
- Click "Save my own copy of images" to hydrate via helper/proxy (re-fetches from CDN; bytes the user already has on disk are not imported).

The web app **does not import pre-hydrated image bytes from disk**. CLI users who want zero re-download should run `bsky-saves serve` instead — the helper makes the on-disk bytes available indirectly via re-fetch from CDN, which is fast and idempotent.

This is intentional; supporting directory or zip import would add CLI subcommands and brittle browser APIs (`webkitdirectory`) for an edge-case audience.

## Privacy considerations

The privacy doc (`docs/privacy.md`) needs updates to describe each backend honestly:

- **Local helper:** bytes never leave the user's machine; CDN sees the user's IP exactly as a normal browser would.
- **User-deployed worker:** bytes flow through the user's own Cloudflare account; the operator never sees them.
- **Operator-hosted image proxy** (if configured for the deployment): image bytes flow through the operator's Cloudflare Worker; the operator does not log URLs or content; URLs are restricted to `cdn.bsky.app`. Articles never go through the operator.
- The privacy doc must describe **which backend is in use** for the user's current configuration, not just what's possible.

This is an honest model: privacy is layered, and the doc reflects the user's chosen layer.

## Phase 2: helper as primary engine

Tracked as a follow-up after Phase 1 ships.

When `bsky-saves serve` is detected, the GUI should be able to use it for **all** operations — fetch, enrich, hydrate-threads, hydrate-images, hydrate-articles — not just the hydration steps. This eliminates Pyodide entirely for helper users:

- **Today:** Pyodide is unconditionally loaded for fetch/enrich/threads (~6 MB download, slow startup, custom httpx shim, sync-XHR workarounds for some PDSes).
- **Phase 2:** GUI detects helper at startup. If present, all engine operations run via helper HTTP calls. Pyodide is loaded lazily only when no helper is detected — most B/C-tier users never pay the cost.

Required helper extension: a single `POST /run` endpoint that accepts the same flags as `bsky-saves fetch ...` (handle, app password, pds, fetch/enrich/threads/images/articles toggles) and returns the resulting inventory + any hydrated asset bytes in one response. Auth lives entirely on the helper side; the GUI hands credentials over and the helper does its own `createSession`. No browser-side AT-Proto session needed when helper is in use.

GUI changes for Phase 2:
- `engine.ts` becomes a router that picks helper vs. Pyodide.
- The Pyodide worker is loaded lazily (`new Worker(...)` only on the no-helper path).
- The "Use a different method" disclosure in the setup wizard becomes more meaningful — switching backends is a real architectural choice, not just a hydration choice.
- The current preauth-session monkey-patch (the workaround for eurosky.social hangs) is no longer needed for helper users; remains relevant only for the Pyodide path.

This is a Phase 2 follow-up because:
- It's a meaningfully larger architectural change than the Phase 1 UX redesign.
- It depends on `bsky-saves serve` shipping first and proving stable in its smaller form.
- It's purely an under-the-hood improvement — no new UX surfaces — so it can land independently after the user-visible work is done.

The Phase 2 work is referenced in `docs/bsky-saves-serve-requirements.md` so the bsky-saves project is aware of the planned API expansion when designing v1.

## Out of scope

Explicitly deferred:

- **Service Worker / persist-when-tab-closed.** Hydration runs while the tab is open; closing the tab pauses progress. Resumable via "Resume" affordance. A future redesign could add a Service Worker for tab-closed continuation; non-trivial because of GitHub Pages caching interactions.
- **Migrating Pyodide work to background.** Fetch/enrich/threads still happen on the foreground Run page. Migrating these to a background-during-Library-browsing model is desirable but a separate, larger project.
- **Importing pre-hydrated assets from disk.** See CLI section.
- **Auto-launching the helper on system boot, system-tray UI, daemon supervision.** Out of scope for both the helper and the GUI. The user runs the helper when they want it.
- **Per-feature granularity in fetch flow.** All-or-nothing per feature on the first run; no per-save filtering, no "back up only the last 30 days," no tag-based subsetting.
- **Bandwidth quota / cost estimation.** No "this will download 200 MB" warning before backup starts. Could be added later if user reports indicate need.

## Open questions

Recorded for the implementation plan to address before coding:

1. **Helper port discovery:** is `47826` always the only port we probe, or do we try a small list (e.g., 47826, 47827, 47828) so multiple bsky-saves installs on one machine don't collide? Current spec says single port; revisit if collision becomes real.
2. **Operator proxy reachability check:** how often does the Settings page re-probe the operator proxy URL? Once on render? On every page focus? Doesn't matter much, but pick one.
3. **Failure list pagination in the Show Details modal:** for users with thousands of saves, the failure list could be long. Cap at first N with "show more" link, or paginate?
4. **Migration:** existing inventories may have `local_images` from earlier (now-removed) hydration code. The new design doesn't break — those entries are valid. But the Backup section should probably show as visible on first load for these users so they don't get re-prompted from scratch. Implementation plan should detail the heuristic.

## Implementation order (suggested)

For the writing-plans phase to refine:

1. Drop the enrich toggle (always on); rename routes copy.
2. Add `Account` section and Sign out to Settings; restructure into the conditional sections.
3. Implement the `hydrationState` stores (without UI).
4. Implement the layered backend probe and configuration model.
5. Build the setup wizard component with happy-path and first-time-path branches.
6. Build the banners with snooze / permanent-dismiss state in IndexedDB.
7. Build the Library status row and PostFocus footer; wire to stores.
8. Build the Show Details modal.
9. Update privacy doc.
10. End-to-end manual test pass against a real bsky-saves helper (requires bsky-saves serve to ship first).

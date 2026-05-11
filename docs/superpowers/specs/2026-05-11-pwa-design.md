# PWA support for bsky-saves-gui — design

> **Status:** approved 2026-05-11. Implementation pending.
> **Branch target:** `claude/bsky-saves-gui-v0.6-efALX`.
> **Companion workstream:** local-served distribution (helper-bundled, served from `localhost`). This spec is the foundation; the CLI / installer work is separate.

---

## 1. Summary

Turn the GUI into an installable Progressive Web App: web app manifest, a service worker that precaches the app shell and fingerprinted assets, and `navigator.storage.persist()` requests so a user's Library is protected from eviction. The same `dist/` artifact runs on `saves.lightseed.net` and on a future local-served origin without modification — a per-build flag toggles whether Pyodide is precached from the same origin or runtime-cached from CDN.

## 2. Goals and non-goals

### Goals

- Offline app shell + asset caching on every origin where the bundle is served. Repeat opens are fast and shell-offline-capable.
- Storage durability: when in persist mode, call `navigator.storage.persist()` so IndexedDB Library data isn't evicted under storage pressure.
- Foundation for local-served distribution: a single `dist/` artifact installs and runs correctly when the helper CLI serves it from `http://localhost:<port>`, including offline Pyodide.

### Non-goals

- Install-prompt UX (custom "Install me" banners, `beforeinstallprompt` capture). Rely on the browser-default install affordance.
- Push notifications, background sync, periodic sync.
- The local-served CLI / launcher / installer itself. This spec only makes the bundle compatible.
- A user-facing "Storage status" indicator in Settings. Deferred.

## 3. User-visible changes

- **Installable.** Browsers expose the default "Install app" affordance (omnibox icon on desktop, "Add to Home Screen" on mobile). No in-app UI prompts.
- **Faster repeat loads.** Shell + JS/CSS served from cache.
- **Offline shell.** With no network, the app loads to the sign-in screen / Library and renders whatever is in IDB. Operations that require the network still fail (expected).
- **No new banners, toggles, or modals.** Storage persistence is invisible. Updates apply silently on next cold load.

## 4. Architecture

### 4.1 Tooling

`vite-plugin-pwa` (workbox under the hood). Generates `manifest.webmanifest` and the service worker from config; auto-integrates with Vite's content-hashed asset output, so a new deploy produces a new SW precache manifest and old hashed files fall out of cache naturally.

### 4.2 Single artifact, two origins

The bundle is identical on hosted and local-served. The manifest uses **relative** `start_url` and `scope` so the SW scopes to whatever origin loaded it. No hardcoded `saves.lightseed.net` anywhere in the SW or manifest.

### 4.3 Build flag: `VITE_LOCAL_PYODIDE`

A boolean env var read at build time. Two consumers:

1. **Vite config** — when set, tells `vite-plugin-pwa` to also precache `/pyodide/*` (the helper-bundled Pyodide payload). When unset (default / hosted), Pyodide is runtime-cached from CDN with a size cap.
2. **Runtime** — exposed to the app via `import.meta.env.VITE_LOCAL_PYODIDE`. `capability-snapshot` resolves a `pyodideSource: 'cdn' | 'local'` field from this plus a runtime probe of `/pyodide/pyodide.js`. The Pyodide worker reads `pyodideSource` to choose its `indexURL`.

Hosted ships with the flag unset. The local-served build (separate workstream) ships with `VITE_LOCAL_PYODIDE=1`.

### 4.4 Update flow

Silent. New SW calls `skipWaiting()` automatically and takes control on the next navigation/reload. No banner UI. No user prompt.

**Bricking safety net:** `index.html` is **network-first** with cache fallback. A fresh HTML always pulls fresh fingerprinted JS, so a bad cached state can never permanently brick a user — the next online load corrects it. Combined with content-hashed asset names, this gives us silent updates without a stuck-cache failure mode.

## 5. Caching strategy

Allowlist, not denylist. Only URLs matching explicit static-asset patterns are cached. Anything else (Bluesky API, helper endpoints, cf-worker) passes through to network.

| Asset class | Strategy | Notes |
|---|---|---|
| `index.html` | Network-first, cache fallback | Bricking safety net |
| Hashed JS / CSS / fonts (same-origin) | Precache (workbox manifest) | Vite hash → automatic cache bust |
| `manifest.webmanifest`, icons, favicon | Precache | Small, stable |
| `/pyodide/*` (when `VITE_LOCAL_PYODIDE=1`) | Precache | Adds ~10–20 MB to SW install on this build only |
| `cdn.jsdelivr.net/pyodide/*` (default build) | Stale-while-revalidate, capped (~30 entries / 30 MB) | Opportunistic; first export after install still hits CDN once |
| `bsky.social/*`, helper `/ping`/`/fetch-image`/`/extract-article`, cf-worker | Network-only, never cached | User data — privacy + correctness |

### What the SW must NEVER cache

- Bluesky API responses (PDS reads, app passwords, JWTs).
- Helper-routed responses (`/ping`, `/fetch-image`, `/extract-article`, `/hydrate-threads`, etc.).
- cf-worker article-extraction responses.
- Any URL with user-derived path or query data.

The allowlist guarantees this by construction. There is no "exclude this URL" logic — only "include these patterns."

## 6. Storage durability

Wire `navigator.storage.persist()` into the existing persist-mode flow.

- `app/src/lib/storage-persist.ts` (new) subscribes to the existing `persistenceMode` store from `app/src/lib/persistence-mode.ts`.
- On the first resolution of `'persist'` per page load, call `navigator.storage.persist()` exactly once. Idempotent guard so subsequent mode-flips during the same page don't re-call.
- In `'session-only'` mode, do not call `.persist()` — we don't want IDB protected when the user explicitly opted out.
- Result (granted / denied / unsupported) is logged to console only. No UI surface in this spec.

The existing persist toggle in `SignIn.svelte` is "on by default" and feeds the `persistenceMode` store, so for the common case `.persist()` fires at app boot.

## 7. Components & files

### New files

- `app/public/icons/icon-192.png`, `icon-512.png`, `icon-512-maskable.png` — provisional artwork generated from the existing favicon / a simple brand placeholder; replace with finalized art later.
- `app/src/lib/sw-register.ts` — registers the SW, auto-applies updates on next cold load.
- `app/src/lib/storage-persist.ts` — `initStoragePersist()` subscribes to `persistenceMode` and calls `navigator.storage.persist()` once per page when mode is `'persist'`.
- `app/src/lib/pyodide-source.ts` — resolves `pyodideSource: 'cdn' | 'local'` from `import.meta.env.VITE_LOCAL_PYODIDE` plus a runtime probe of `/pyodide/pyodide.js`.

### Files changed

- `vite.config.ts` — register `vite-plugin-pwa` with the caching strategies above; read `VITE_LOCAL_PYODIDE` to gate `/pyodide/*` precaching.
- `app/src/main.ts` — call `registerSW()` and `initStoragePersist()` at app entry.
- `app/src/lib/capability-snapshot.ts` — surface `pyodideSource` so the worker can choose its `indexURL`.
- `app/src/worker/pyodide-worker.ts` (or equivalent loader) — use `pyodideSource` to pick CDN vs `/pyodide/` for `indexURL`.
- `index.html` — `<meta name="theme-color">` matching the topnav color.

### Files NOT changed

- Storage layer: `inventory-store.ts`, `image-store.ts`, `account-store.ts`, `last-session.ts`. The SW does not touch user data.
- `persistence-mode.ts` — `storage-persist.ts` is a passive subscriber; never writes the mode.
- Sign-in flow. The existing persist toggle remains the only user-facing control.

## 8. Manifest

Generated by `vite-plugin-pwa` from this configuration (shape, not literal syntax):

- `name`: "Bluesky Saves Explorer" (or current product name)
- `short_name`: "Bsky Saves"
- `start_url`: `.` (relative)
- `scope`: `.` (relative)
- `display`: `standalone`
- `theme_color`: matching topnav
- `background_color`: matching app background
- `icons`: 192, 512, 512-maskable from `app/public/icons/`

Relative `start_url` / `scope` is what makes the same artifact installable on both hosted and local-served origins.

## 9. Testing strategy

### Unit-testable (Vitest)

- `storage-persist.ts` — mock `navigator.storage.persist` and the `persistenceMode` store; assert call-once-per-page, idempotence, and that `'session-only'` does not trigger `.persist()`.
- `pyodide-source.ts` — assert CDN vs local resolution given combinations of env var + probe outcome.
- `sw-register.ts` — assert update-handling logic given mocked `ServiceWorkerRegistration` events. Do not register a real SW in the test harness.

### Not unit-testable (manual)

- SW caching strategy correctness, manifest validity, install flow, true offline shell. Verified via `pnpm build && pnpm preview`, browser install, kill network, reload — confirm shell loads and known fingerprinted assets serve from cache.

### Future (out of scope)

A Playwright e2e job that exercises install + offline. Worth doing eventually; not required for this spec.

## 10. Privacy and security

- No user data passes through the SW cache. The allowlist is the enforcement mechanism.
- `'session-only'` mode users get the same shell caching as everyone else (shell is not user data) but no `.persist()` call. IDB writes remain gated by the existing `shouldPersistLibraryData()` checks.
- The SW does not bypass CORS for any origin. Cross-origin Pyodide caching (CDN path) only stores opaque responses; runtime cache size cap prevents pathological growth.

## 11. Open questions / follow-ups

- **Icons.** Provisional icons (option `a` from the design review) ship with this work; replace with finalized brand artwork in a follow-up.
- **Local-served build target.** A `pnpm build:local` script (or equivalent) that sets `VITE_LOCAL_PYODIDE=1` belongs in the local-served distribution workstream, not here. This spec defines the flag and ensures the runtime honors it.
- **Storage-status UI.** Surfacing "Storage: persistent / best-effort" in Settings is deferred. Easy to add later by exposing the `.persist()` result from `storage-persist.ts`.
- **Playwright e2e.** Deferred.

# BlueSky Saves Exporter — Design

**Date:** 2026-05-01
**Status:** Draft for review
**Repo (technical name):** `bsky-saves-gui`
**Product name (working title):** *BlueSky Saves Exporter* — a final brand
name has not been chosen. All user-visible name strings live in build-time
configuration so the rename is a single env-var change.
**Default deployment:** `saves.lightseed.net` (operated by `tenorune`),
but the app is deploy-agnostic — see Configuration.
**Upstream:** [`bsky-saves`](https://github.com/tenorune/bsky-saves) ([PyPI](https://pypi.org/project/bsky-saves/))
**Reference consumer:** [`tenorune.github.io`](https://github.com/tenorune/tenorune.github.io)

## Purpose

Provide a web-based GUI for `bsky-saves` that lets a Bluesky user export their
Saved Posts as JSON, a flat Markdown file, or a self-contained HTML/CSS
archive. Output reflects either a simple `bsky-saves fetch`, or a hydrated
inventory (threads, articles, images). `enrich` is on by default.

## Hard requirements

1. **User credentials are inaccessible to the developer or any third party
   other than the user's own browser and Bluesky's PDS.**
2. **User data (saved posts and any hydrated content) is inaccessible to the
   developer or any third party other than the user's own browser.**
3. The app must wrap the existing `bsky-saves` Python package — no parallel
   reimplementation of its logic.
4. The app must be web-based (no install required for the default path).

## Configuration (deploy-agnostic)

No deployer-specific value (operator name, Bluesky handle, custom domain,
beacon-post URI, app name, helper port) is hard-coded in source. Everything
that varies between deployments lives in env-driven build-time configuration.
The reference deployment uses one set of values; a fork or rehost can change
all of them by editing env files.

### App build (Vite `import.meta.env`)

| Variable | Purpose | Reference value |
|---|---|---|
| `VITE_APP_NAME` | User-visible product name in titles, headings, exports | `BlueSky Saves Exporter` |
| `VITE_APP_DOMAIN` | Canonical hostname; used in CORS allow-lists, archive footer link, `CNAME` | `saves.lightseed.net` |
| `VITE_OPERATOR_HANDLE` | Bluesky handle of the deployer for the beacon button label and privacy text | `tenorune.lightseed.net` |
| `VITE_BEACON_AT_URI` | AT URI of the pinned beacon post the "tell …" button likes | (created at deploy time) |
| `VITE_DEFAULT_PDS` | PDS endpoint pre-filled into sign-in | `https://bsky.social` |
| `VITE_HELPER_ORIGIN` | Loopback origin the helper-detector probes | `http://127.0.0.1:7878` |
| `VITE_REPO_URL` | Issue tracker link in footer / privacy policy | (the repo) |
| `VITE_PYODIDE_VERSION` | Pinned Pyodide release | (chosen at impl time) |

A `.env.example` ships in the repo with the reference values. The deploy
workflow reads from a real `.env` (or repo secrets) and bakes the values into
the static build. None of these are runtime secrets — they're public once
deployed; the env mechanism exists for separation of code and deployment, not
for confidentiality.

### Helper (`bsky-saves-gui-helper` working name)

Configurable via CLI flags and env vars:

| Flag / env | Purpose | Default |
|---|---|---|
| `--port` / `HELPER_PORT` | Loopback port to bind | `7878` |
| `--allow-origin` / `HELPER_ALLOW_ORIGIN` (repeatable) | CORS allow-list | the reference app's `VITE_APP_DOMAIN` plus `http://localhost:5173` |
| `--allow-host` / `HELPER_ALLOW_HOST` | Optional outbound allow-list (defaults to none = allow all article hosts) | (none) |

A user who self-hosts the app at a different domain points the helper at
their domain via `--allow-origin`.

### Worker template

The Cloudflare Worker reads from `wrangler` env vars at deploy time:

| Var | Purpose |
|---|---|
| `ALLOWED_ORIGIN` | The origin allowed to call the proxy (e.g., the deployer's `VITE_APP_DOMAIN`) |
| `SHARED_SECRET` | Required `X-Proxy-Secret` value |

The app generates a fresh `SHARED_SECRET` for the user during proxy setup
and shows the values to paste into the Worker's environment.

### Naming caveat

The strings `BlueSky Saves Exporter`, `bsky-saves-gui`, and
`bsky-saves-gui-helper` are working titles. The repo and Python package
identifiers can be renamed alongside the product when the final name is
chosen; nothing in the design depends on the current strings.

## Architecture

A static web app deployed to GitHub Pages from this repo. The reference
deployment lives at `saves.lightseed.net`; any fork can deploy to its own
domain by changing `VITE_APP_DOMAIN` and the `CNAME` file. The app runs the
existing `bsky-saves` Python package
in the browser via [Pyodide](https://pyodide.org). There is no backend, by
design — that is what makes requirements 1 and 2 structurally true rather
than policy-enforced.

Three deliverables ship from this repo:

1. **`bsky-saves-gui` (the app).** Svelte + Vite static build. Sign-in panel,
   run controls, reader, exporters. Talks to Pyodide and IndexedDB. Shares
   a `reader/` component package with deliverable 2.
2. **`bsky-saves-archive` (the archive template).** The same reader
   components, no engine, no sign-in, designed to read its data from an
   inlined `<script type="application/json" id="inventory">` blob. CI builds
   it as a static bundle and ships it alongside the app on GitHub Pages. At
   export time, the app's HTML exporter fetches that bundle, injects the
   user's inventory, optionally inlines images as `data:` URIs, and emits
   the result as a single `.html` or a `.zip`. This is what "HTML output"
   means: a self-contained, navigable mini-app the user can open offline.
3. **`bsky-saves-gui-helper` (local CORS helper).** Separate small Python
   package, `pipx install`-able, runs on `127.0.0.1:${HELPER_PORT}` (default
   `7878`). Single job: accept a URL, fetch it, return bytes. Origin-locked
   via `--allow-origin` flags (the reference app's `VITE_APP_DOMAIN` and
   `http://localhost:5173` for dev by default).

Plus a **proxy template** (`templates/cf-worker/`, single `worker.js`) the
user deploys to their own Cloudflare Workers account in two minutes for
proxy-mode article hydration without installing Python.

### Article-hydration strategy

`bsky-saves`' article hydration scrapes arbitrary third-party URLs. Browsers
block such cross-origin fetches via CORS. Resolution at runtime, in priority
order:

1. **Local helper** detected on `127.0.0.1:7878` — recommended default for
   power users. Browser → user's loopback → article site.
2. **User-deployed Cloudflare Worker** — URL configured in settings. Worker
   runs on the user's own account; the developer never sees traffic. Hardened
   with a shared secret and an `Origin` allow-list locked to the deployer's
   `VITE_APP_DOMAIN`.
3. **Skip with notice** — articles toggle disabled, the rest of the export
   completes normally.

Fetch, enrich, hydrate threads, and hydrate images all run purely in-browser
because Bluesky's XRPC endpoints and `cdn.bsky.app` are CORS-friendly. Only
article hydration needs an escape hatch.

### Tech stack

- **Frontend:** Svelte 4 + Vite, TypeScript. Static output (no SSR, no
  runtime server).
- **Engine:** Pyodide (pinned version, SRI-hashed) loading the published
  `bsky-saves` package via micropip.
- **Storage:** IndexedDB (via `idb-keyval` or hand-rolled wrapper) for the
  inventory, hydrated assets, and (opt-in, encrypted) saved app password.
- **Crypto:** Native WebCrypto. PBKDF2-SHA256 (≥600,000 iterations) +
  AES-GCM for the saved-credential path.
- **Helper:** Python 3.10+, stdlib `http.server` + `urllib` (no extra deps),
  packaged for `pipx`.
- **Proxy template:** Single-file Cloudflare Worker, no build step.
- **Usage signal:** No analytics. A footer button labeled "Tell
  @${VITE_OPERATOR_HANDLE} you used this" likes the pinned beacon post at
  `${VITE_BEACON_AT_URI}` using the user's existing authenticated session.
  Explicit, single-click, no background pings.

## Components

### `app/src/engine/`

- `pyodide-runner.ts` — loads Pyodide, installs `bsky-saves` via
  `micropip.install`, exposes typed wrappers for `fetch`, `enrich`,
  `hydrate threads`, `hydrate articles`, `hydrate images`.
- `at-proto-login.ts` — handle + app password → session token via the
  user's PDS. Pure browser fetch.
- `inventory-store.ts` — IndexedDB CRUD for `saves_inventory.json`,
  hydrated articles, image blobs.
- `helper-detector.ts` — probes `127.0.0.1:7878/health` on startup, surfaces
  presence to the UI.
- `proxy-client.ts` — sends URL fetch requests through a configured
  Cloudflare Worker URL with the shared-secret header.
- `beacon.ts` — exposes `likeBeacon()`, which calls
  `app.bsky.feed.like.create` against the user's PDS targeting
  `import.meta.env.VITE_BEACON_AT_URI`. Idempotent (no-op if already liked).
  Persists "already liked" state in IndexedDB. If `VITE_BEACON_AT_URI` is
  unset (deployer hasn't created a beacon post), the footer button is hidden.

### `app/src/crypto/`

- `passphrase-cipher.ts` — `encrypt(plaintext, passphrase)` and
  `decrypt(ciphertext, passphrase)` using PBKDF2 → AES-GCM. No fallback,
  no escape hatch — wrong passphrase = no decrypt.

### `app/src/reader/`

Shared between the live app and the archive build:

- `LibraryView.svelte` — feed, search box, date-range filter.
- `PostFocus.svelte` — single-post full-screen view. Renders body, embeds,
  hydrated article text, thread descendants, image gallery, link to original.
- `SlideStack.svelte` — generic stack-based router using URL hash routes
  (`#/library`, `#/post/<rkey>`, `#/settings`, `#/privacy`). Slide-from-right
  CSS transitions; honors `prefers-reduced-motion`.
- `HelpBubble.svelte` — inline `?` affordance with expandable explainer
  text, used wherever the user makes a privacy-relevant choice.

### `app/src/exporters/`

- `json-exporter.ts` — emits `saves_inventory.json` plus an `images/`
  directory when present. Bundles as `.zip` (jszip) when images or articles
  are present.
- `markdown-exporter.ts` — flat reverse-chronological Markdown per the
  output-format section below.
- `html-exporter.ts` — clones the archive template, inlines the inventory
  as `<script type="application/json" id="inventory">`, copies images to
  `images/` (or inlines as `data:` URIs in self-contained mode), zips.

### `app/src/routes/`

- `SignIn.svelte` — handle, app password, optional PDS override, optional
  "Save app password on this device (encrypted)" with passphrase field.
- `Run.svelte` — toggles for `enrich` (default on), `hydrate threads`,
  `hydrate articles` (with helper/proxy badge), `hydrate images`.
  Progress log.
- `LibraryView.svelte`, `PostFocus.svelte` — from `reader/`, mounted on
  the routes `#/library` and `#/post/<rkey>`.
- `Settings.svelte` — clear local data, import/export inventory file,
  configure proxy URL, link to `#/privacy`.
- `Privacy.svelte` — renders `docs/privacy.md` at build time.

### `helper/`

`bsky-saves-gui-helper` Python package:

- `serve.py` — `http.server`-based loopback server on port 7878 (configurable
  via `--port`). Single endpoint: `POST /fetch` with JSON body
  `{"url": "..."}`, returns the upstream response body and status. CORS
  preflight allowed only for origins listed via `--allow-origin` (defaults to
  the reference app's `VITE_APP_DOMAIN` and `http://localhost:5173`).
  `GET /health` returns `{"ok": true, "version": ...}`.
- `pyproject.toml` — `[project.scripts] bsky-saves-gui-helper = "...:main"`.
- Distributed via PyPI as its own release cadence.

### `templates/cf-worker/`

- `worker.js` — single file. Handles `OPTIONS` preflight (origin allow-list)
  and `POST /fetch`. Requires `X-Proxy-Secret` header to match a deploy-time
  env var. Returns upstream bytes + status. Refuses non-allowed origins.
- `wrangler.toml.template` — minimal config the user customizes.
- `README.md` — copy/paste deploy instructions, including how the app
  generates a secret for them.

## User flow

### First visit

1. Page loads (~50 KB HTML/CSS/JS). Pyodide download (~6 MB) deferred until
   sign-in is submitted; cached in browser after.
2. Sign-in panel: handle, app password, "Save app password on this device
   (encrypted)" checkbox (default off) with passphrase field, "Save inventory
   on this device" checkbox (default on), optional PDS override. Inline help
   text on every field explains where data flows.
3. On submit, Pyodide loads, `bsky-saves` is installed via micropip, and
   `at-proto-login` runs against the PDS. Failure surfaces inline; success
   collapses the panel.
4. Run panel appears: `enrich` (default on), `hydrate threads`, `hydrate
   articles` (with status badge — local helper / proxy / unavailable),
   `hydrate images`. Each toggle has an inline help bubble.
5. "Run" streams progress into a log area. Cancel button.
6. On completion, the slide-stack pushes `#/library` — reader slides in from
   the right. Search and date-range filter at the top of the feed.
7. Tapping a post pushes `#/post/<rkey>` — full-screen post view slides in
   from the right on top. Back chevron in header pops the stack; browser
   back does the same.
8. Header has an Export menu: JSON / Markdown / HTML. Each export shows a
   toggle for "Bundle as zip" vs. "Self-contained" where applicable, with
   sensible defaults (zip for large image-heavy accounts, self-contained for
   small or HTML preview).
9. Footer carries a "Tell @${VITE_OPERATOR_HANDLE} you used this" button.
   Clicking it likes the pinned beacon post at `${VITE_BEACON_AT_URI}` using
   the user's existing authenticated session, with a brief inline explainer
   of exactly what happens. After click, the button shows "Thanks 💌" and
   disables. State is remembered in IndexedDB so the button doesn't reappear
   next visit.

### Return visit

1. App loads. If IndexedDB has an inventory, slide directly into `#/library`
   without sign-in. Reader is fully usable offline.
2. "Sync" button in the header slides in a slim sign-in (or unlocks saved
   credentials via passphrase if remembered) and runs an incremental
   `bsky-saves` re-run.
3. Settings (`#/settings`) offers: Clear local data, Export inventory file,
   Import inventory file, Configure proxy URL, Link to privacy policy.

### Inventory portability (BYO file)

Settings exposes "Export inventory file" (downloads `saves_inventory.json`
plus `images.zip` if applicable) and "Import inventory file" (file input,
parsed and stored in IndexedDB). This is how a user moves between machines
without persisting credentials.

## Data flow

```
sign-in:  browser ──(handle, app pwd)──> user's PDS ──(session)──> browser
                                                                    │
                                                                    ▼
fetch:    browser ──(XRPC)──> PDS ────────────(saves)──> Pyodide → IndexedDB
enrich:   browser ←─(timestamps decoded locally by bsky-saves in Pyodide)
threads:  browser ──(XRPC)──> PDS ────(thread data)──> Pyodide → IndexedDB
images:   browser ──(GET)──> cdn.bsky.app ──(blob)──> IndexedDB
articles: browser ──> 127.0.0.1:7878 (helper) ──> article site
              or ──> user's CF Worker ──> article site
              or skipped
read:     IndexedDB → Svelte reader components
export:   IndexedDB → exporter → browser download
```

No path leads to the developer's infrastructure or to any third party other
than the ones listed above.

## Privacy & security model

### Guarantees

- **No server the deployer operates exists.** The deployed app (the
  reference instance is `saves.lightseed.net`) is static files on GitHub
  Pages. There is no API endpoint the deployer controls to receive user data.
- **Credentials never leave the device** except as one HTTPS request to the
  user's chosen PDS. Optional encrypted persistence is local IndexedDB only,
  encrypted with a key derived from a user-chosen passphrase.
- **Inventory never leaves the device.** Export = JS-generated file +
  browser download. Import = file input. No upload path exists.
- **Article hydration paths are user-controlled.** Local helper runs on the
  user's machine; proxy template runs on the user's Cloudflare account.
  Either way the developer never sees traffic.

### Disclosed data flows

These are surfaced in the privacy policy and in inline help where relevant:

- **The user's chosen Bluesky PDS** sees all AT Protocol traffic — this is
  inherent to using Bluesky.
- **`cdn.bsky.app`** sees image fetches when image hydration is on.
- **GitHub Pages edge** logs request metadata (IP, path, UA) for any visit,
  per GitHub's privacy policy. Repo owners do not get access to these logs.
- **Article hosts** see fetches when article hydration runs (via helper or
  proxy).
- **The configured operator account `@${VITE_OPERATOR_HANDLE}`** sees a
  like on the pinned beacon post if and only if the user explicitly clicks
  the "Tell @${VITE_OPERATOR_HANDLE} you used this" button. This is an
  ordinary AT Protocol like, public on the user's account, identical to any
  other Bluesky like — no special data attached. The button is the only way
  this happens; nothing fires automatically.

There is **no analytics service**. No third-party telemetry, no pageview
counters, no error reporting endpoint. The only usage signal the developer
ever receives is the explicit beacon-post like described above.

### Out of scope (acknowledged in privacy text)

- A compromised browser extension can read anything the page can read.
- A compromised user device is out of scope.
- Supply chain attacks on the GitHub Pages deploy. Mitigated by:
  Subresource-Integrity-pinned Pyodide, CI publishing only from tagged
  commits, version-pinned dependencies.

## Output formats

### JSON

The unmodified `saves_inventory.json` from `bsky-saves`, plus a sibling
`images/` directory when image hydration ran. Bundled as `.zip` when images
present; raw `.json` otherwise.

### Markdown

Single flat file, reverse-chronological. Document-level frontmatter:

```yaml
---
exported_at: 2026-05-01T15:32:00Z
account: handle.bsky.social
count: 423
hydrated:
  enrich: true
  threads: true
  articles: false
  images: true
---
```

Each save:

```markdown
## 2026-04-29 · @author.bsky.social

> Post text here, preserving line breaks.

[Original post](https://bsky.app/profile/.../post/...)

![](images/cid.jpg)

> > Reply in thread (if hydrated)
> > More replies …
```

Article text (when hydrated) appears inline beneath the post text under a
"Linked article" subhead. Image references use relative `images/cid.jpg`
paths or `data:` URIs in self-contained mode. No per-post frontmatter — JSON
covers machine-parseable use cases.

### HTML (archive build)

Self-contained mini-app. The same Svelte reader components used in the live
app, with the inventory inlined as
`<script type="application/json" id="inventory">…</script>`. Slide-stack
navigation, search, date-range filter, full-screen post focus, light/dark via
`prefers-color-scheme`.

Two output modes:

- **Bundled** (`.zip`): `index.html` + `style.css` + `script.js` + `images/`.
- **Self-contained** (single `.html`): JS and CSS inlined, images as `data:`
  URIs.

Bundled is the default for image-heavy accounts; self-contained is the
default for small accounts and preview cases.

## Repository layout

```
bsky-saves-gui/
├── app/                          # Svelte + Vite source for the live app
│   ├── src/
│   │   ├── reader/               # shared components
│   │   ├── engine/               # Pyodide loader, bsky-saves runner, IndexedDB
│   │   ├── crypto/               # WebCrypto wrapper
│   │   ├── exporters/            # JSON, Markdown, HTML archive builders
│   │   └── routes/               # sign-in, library, post focus, settings, privacy
│   ├── public/
│   ├── package.json
│   └── vite.config.ts
├── archive-template/             # static reader-only build, consumed by HTML exporter
├── helper/                       # bsky-saves-gui-helper Python package
│   ├── src/bsky_saves_gui_helper/
│   ├── tests/
│   └── pyproject.toml
├── templates/cf-worker/          # Cloudflare Worker proxy template
│   ├── worker.js
│   ├── wrangler.toml.template
│   └── README.md
├── docs/
│   ├── superpowers/specs/        # this document
│   └── privacy.md                # the privacy policy, also surfaced in-app
├── .github/workflows/
│   ├── deploy-app.yml            # build app + archive-template, publish to gh-pages with CNAME
│   └── publish-helper.yml        # tag-driven PyPI release for the helper
├── CNAME                         # generated from $VITE_APP_DOMAIN (reference: saves.lightseed.net)
├── .env.example                  # reference values for all VITE_* config
└── README.md
```

The helper releases on its own cadence to PyPI. The app and archive template
are built and published together to GitHub Pages.

## Testing

- **App:** Vitest for unit logic — exporters, crypto wrapper, IndexedDB
  store, slide-stack router. Playwright for one end-to-end happy path
  (mocked Pyodide and AT Proto via fixtures) and one slide-stack navigation
  test. No real Bluesky calls in CI.
- **Helper:** pytest for the URL-fetch endpoint, CORS allow-list (positive
  and negative cases), error paths, port-in-use behavior.
- **Worker template:** `wrangler dev` smoke test verifying origin-locking
  and shared-secret check both fire on missing/wrong inputs.
- **Manual release verification:** real fetch against a test Bluesky
  account; open each export format in a fresh browser profile to confirm
  standalone behavior.

## README

A `README.md` at the repo root, generated as part of the implementation
plan. Audience is split: a casual user landing here from a search, a
prospective fork-and-self-host operator, and a contributor. Sections, in
order:

1. **One-line description** using `${VITE_APP_NAME}` (working title shown
   with a note that the final name is TBD).
2. **What it does** — three bullets: export Bluesky saves as JSON,
   Markdown, or self-contained HTML; runs entirely in the user's browser;
   no server holds credentials or content.
3. **Try it** — link to the reference deployment (`saves.lightseed.net`)
   for users who just want to use it.
4. **How it works** — short paragraph: static site + Pyodide running
   `bsky-saves`; link to the design spec under `docs/superpowers/specs/`.
5. **Privacy** — short summary, link to `docs/privacy.md`.
6. **Self-host / fork** — quick path for someone who wants their own
   instance: clone, copy `.env.example` to `.env`, fill in the `VITE_*`
   values for their deployment, push to GitHub Pages with the appropriate
   `CNAME`. Link to the Configuration section of the design spec for the
   full table.
7. **The helper** — what `bsky-saves-gui-helper` does, `pipx install`
   command, when to use it (article hydration), link to its own README in
   `helper/`.
8. **The proxy template** — what it's for, link to `templates/cf-worker/`
   README.
9. **Development** — `pnpm install`, `pnpm dev`, `pnpm test`, `pnpm build`
   (or whatever the chosen package manager is); how to run the helper and
   worker locally for end-to-end testing.
10. **Repo layout** — abbreviated tree pointing to `app/`, `helper/`,
    `templates/`, `docs/`.
11. **License** — name and link to `LICENSE`.
12. **Status** — that the product name is a working title and the project
    is pre-1.0.

Two supplementary READMEs ship in subdirectories:

- `helper/README.md` — install, run, flags, supported endpoints, security
  notes (loopback-only, CORS allow-list).
- `templates/cf-worker/README.md` — deploy steps with screenshots/commands,
  required env vars, how the app generates and shows the shared secret.

All three READMEs reference parameters by their env-var names rather than
hardcoding the reference deployment values, so a fork doesn't have to
rewrite docs.

## Privacy policy

A `docs/privacy.md` file in the repo, rendered at build time into the app's
`#/privacy` route (reachable from settings and a footer link), and embedded
into archive HTML exports. Sections:

1. Architecture summary (no server, static files only).
2. What stays local.
3. What leaves the browser, why, and to whom (PDS, image CDN, helper or
   proxy if configured, article hosts during article hydration, GitHub Pages
   edge).
4. GitHub Pages edge-logging disclosure with link to GitHub's policy.
5. The beacon button — what it does (likes the single pinned post at
   `${VITE_BEACON_AT_URI}` on `@${VITE_OPERATOR_HANDLE}`), when it fires
   (only on click), and that nothing else reports usage.
6. Statement that no analytics service is used.
7. How to revoke a Bluesky app password.
8. Threats out of scope (extensions, compromised device).
9. Contact / issue tracker for questions.

## Open items / deferred

- Specific Pyodide version pin and SRI hash — chosen at implementation time.
- AT URI of the pinned beacon post — created at deploy time, populated into
  `VITE_BEACON_AT_URI`. The reference deployment will create one on
  `@tenorune.lightseed.net`.
- Final product name — to replace the working title `BlueSky Saves Exporter`.
  Lives entirely in `VITE_APP_NAME`; the rename is a single config change.
- Visual styling and theming — to be developed alongside implementation;
  taste signal from `tenorune.github.io` is minimal HTML/CSS.
- I18n is not in scope for v1.
- A native mobile wrapper is not in scope. The slide-stack pattern is
  touch-friendly so a future PWA install is plausible without rework.

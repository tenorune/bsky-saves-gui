# `bsky-saves` MVP requirements: vendoring the GUI + serving it locally

> **Audience.** Maintainers of [`bsky-saves`](https://github.com/tenorune/bsky-saves) (the Python daemon and PyPI wheel).
>
> **Purpose.** Define the smallest change set in `bsky-saves` that lets the project consume the [`bsky-saves-gui`](https://github.com/tenorune/bsky-saves-gui) release artifact and serve it from `bsky-saves serve --gui` on a user's localhost.
>
> **Source.** Section 4 of `bsky-saves-gui/docs/bsky-saves-gui-dist-workstream.md`, restated standalone with security context inlined. This document supersedes any informal asks; the workstream doc itself remains the GUI-side cross-team source of truth.

---

## 1. Context

`bsky-saves-gui` is a Svelte/Vite PWA. It compiles to a static `dist/` tree that runs identically in three contexts:

- Hosted on `saves.lightseed.net` (production deploy).
- Served locally from a Python daemon (this spec).
- Frozen into a standalone binary or OS installer (later, out of MVP scope).

The same JS bundle handles all three. At runtime, the GUI probes for a local helper at `127.0.0.1`; if present and capability-compatible, it upgrades to "local mode" (Bluesky API calls and image fetches run through the helper instead of cross-origin worker proxies). If absent, it falls back gracefully.

What this spec asks of `bsky-saves`:

1. Consume the GUI's release tarball as a build-time input to the wheel.
2. Serve that tarball on a localhost-bound HTTP server with appropriate security headers and an authenticated API.
3. Expose a small, versioned API the GUI can probe and call.

This is **not** about changing the GUI; the GUI side is already shipping. This is about the wheel side catching up so the local-mode experience works end-to-end.

---

## 2. The boundary artifact

Each `bsky-saves-gui` release (tag matching `v*`) attaches the following files to its GitHub release:

| File | What it is |
|---|---|
| `dist.tar.gz` | Production `dist/` tree, sourcemaps stripped, no test files, no `.env`, no `tsconfig`. ~270 KB today. |
| `dist.tar.gz.sha256` | SHA-256 checksum of the tarball, one line: `<hex>  dist.tar.gz`. |
| `dist-with-maps.tar.gz` | Same tree plus sourcemaps. **Not consumed by the wheel**; debug artifact for the GUI team only. Do not bundle. |
| `SBOM.cdx.json` | CycloneDX 1.x SBOM of the JS production dependency tree. Useful for security review; not strictly required at build time. |

**Download URL pattern:**

```
https://github.com/tenorune/bsky-saves-gui/releases/download/v{GUI_VERSION}/dist.tar.gz
https://github.com/tenorune/bsky-saves-gui/releases/download/v{GUI_VERSION}/dist.tar.gz.sha256
```

**Contents of `dist.tar.gz` at top level:**

```
index.html              # Vite-built; relative asset refs; manifest link; CSP meta tag
assets/                 # Hashed JS/CSS chunks (immutable)
sw.js                   # Service worker (Workbox-built, injectManifest mode)
manifest.webmanifest    # PWA manifest
favicon.ico
icons/                  # PWA icons (PNG + SVG)
CNAME                   # GitHub Pages CNAME — wheel should ignore/discard
```

The bundle is fully static; no server-side rendering. SPA hash routing — all routes are `index.html` with a `#/path` fragment.

---

## 3. Build-pipeline requirements

### 3.1 Pin `GUI_VERSION` and its checksum in source control

- Add a `GUI_VERSION` value to `pyproject.toml` (e.g. under `[tool.bsky-saves]`) or a sibling `gui-version.txt`. Either is fine; choose one.
- Commit `gui-dist.sha256` alongside it. This is the expected SHA-256 of `dist.tar.gz` for the pinned version, copied byte-for-byte from the GUI release's `dist.tar.gz.sha256` file.
- Both files are reviewed-on-change. Bumping `GUI_VERSION` without updating the checksum is a CI failure (see 3.3).

### 3.2 Build hook to fetch + verify + extract

Add a build step (`scripts/fetch_gui.py`, Hatch custom build hook, or setuptools `cmdclass` — implementer's call) that:

1. Reads `GUI_VERSION` and the pinned SHA-256.
2. Downloads `https://github.com/tenorune/bsky-saves-gui/releases/download/v{GUI_VERSION}/dist.tar.gz` over HTTPS. **No redirects to non-GitHub hosts** (validate the response chain).
3. Verifies the SHA-256 against the pinned value. **Aborts the build on mismatch**, with an error message that mentions both expected and actual hashes.
4. Extracts the tarball to `src/bsky_saves/_gui/`. Strip the `CNAME` file at this step (GitHub-Pages-specific).
5. Idempotent: if `_gui/` is already populated with the right version (e.g. tracked via a `_gui/.gui-version` marker file), skip the download.

### 3.3 Package data + gitignore

- Mark `_gui/` as package data so it's included when `python -m build` runs (in `pyproject.toml` under `[tool.setuptools.package-data]` or equivalent).
- Add `src/bsky_saves/_gui/` to `.gitignore`. The directory is build-time-populated, not source-tracked.

### 3.4 CI must run the build hook on every PR

- Every PR to `bsky-saves` runs the fetch hook before any test. A tarball-fetch failure (404, network error, mismatched checksum) fails CI.
- This catches three classes of regression at PR time, not at release time: a deleted GUI release, a corrupted tarball, a bad SHA-256 pin.

### 3.5 Security rationale

The pinned SHA-256 mitigates the risk of tarball tampering between GUI release and wheel build (compromised GitHub Action, CDN cache, MITM). Without the pin, any wheel built after a compromise would ship the malicious payload. With the pin, the wheel build aborts unless the bytes match what a reviewer signed off on.

---

## 4. Daemon behaviour requirements

These apply to `bsky-saves serve` (or `bsky-saves serve --gui` if you prefer gating GUI-serving behind a flag — both are acceptable; default-on is friendlier).

### 4.1 Static file serving

- Mount `_gui/` at `/`.
- Apply SPA fallback: any path that does not resolve to a real file in `_gui/` returns `index.html` (the GUI handles routing client-side).
- Asset files under `/assets/*` are Vite-hashed (immutable). Send `Cache-Control: public, max-age=31536000, immutable`.
- `index.html` is **not** hashed and must be revalidated. Send `Cache-Control: no-store`.

### 4.2 Bind localhost-only by default

- Default bind address: `127.0.0.1` (IPv4 loopback). Not `0.0.0.0`, not `::`.
- Require an explicit `--host` flag for any other bind address.
- `--host 0.0.0.0` is permitted but prints a security warning to stderr explaining the user is exposing the helper to their LAN.
- Default port: pick one and document it (e.g. `47826` — what the GUI's `VITE_HELPER_ORIGIN` currently probes). Allow `--port` override.

### 4.3 Host header validation

- Every request validates the `Host` header.
- Acceptable values: `127.0.0.1:<port>`, `localhost:<port>`. Anything else (including a different IP or another hostname pointing at 127.0.0.1 via `/etc/hosts`) is rejected with **`421 Misdirected Request`**.

### 4.4 Origin allowlist on the API

- Every `/api/*` route validates the `Origin` header.
- Default allowlist:
  - `http://127.0.0.1:<port>`
  - `http://localhost:<port>`
  - `https://saves.lightseed.net`
- Configurable via `--allowed-origin <origin>` (repeatable) for users running their own hosted GUI deploy.
- Non-allowlisted origins receive **`403 Forbidden`**. Missing `Origin` header on a CORS-relevant request is also rejected.
- CORS preflight (`OPTIONS`) returns the matched origin in `Access-Control-Allow-Origin`; never `*`.

### 4.5 Session token authentication

- On daemon startup, generate a random session token: 256 bits, base64-encoded, regenerated on every restart.
- Embed the token in the served `index.html` via a `<meta name="bsky-saves-token" content="...">` tag injected at serve time. The GUI reads this on boot.
- Every `/api/*` request must present `Authorization: Bearer <token>` matching the current session token.
- Missing or mismatched token returns **`401 Unauthorized`**.
- Static asset routes (`/`, `/assets/*`, `/manifest.webmanifest`, etc.) do **not** require the token. Only `/api/*` does.

### 4.6 Security headers on the served GUI

Send the following headers on every response (HTML and assets):

```
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https: http://127.0.0.1:* http://localhost:*; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
Cross-Origin-Opener-Policy: same-origin
```

Notes:
- The CSP matches what the GUI sets via `<meta>` already, with `frame-ancestors 'none'` added — that directive can only be set via header, not meta, and is the one gap when the GUI is hosted on GitHub Pages. Closing that gap is one of the wins of the daemon-served path.
- `'wasm-unsafe-eval'` is required because Pyodide compiles WASM. Don't tighten this — it'll break image backup.
- `connect-src https:` is required so the GUI can reach arbitrary Bluesky PDS hosts (federated). `connect-src 'self'` is too tight.

### 4.7 Security rationale

These rules mitigate three concrete attacks:

- **DNS rebinding** (R3 in the workstream doc). A user visits `evil.com`. The page's JS waits; DNS for `evil.com` re-resolves to `127.0.0.1`; same-origin policy now lets `evil.com` script the daemon. Defences: localhost-only bind (the attacker can't reach the helper from another host), Host-header validation (rebound request has `Host: evil.com`, gets `421`), Origin-allowlist (rebound request has `Origin: https://evil.com`, gets `403`), session token (the attacker doesn't have it).
- **Compromised hosted PWA driving every helper** (R2). If `saves.lightseed.net` is XSS'd, the attacker has scripted access to the GUI's origin. The Origin allowlist *does* admit that origin (by design — that's the legitimate hosted GUI), so the defence here is: helper must not blindly trust the GUI for destructive operations. See §5.3.
- **Clickjacking of the local-mode GUI**. `X-Frame-Options: DENY` plus `frame-ancestors 'none'` prevents any other origin from embedding the local GUI in an iframe.

---

## 5. API endpoint contract

The GUI talks to the daemon at the bound origin (e.g. `http://127.0.0.1:47826`). All endpoints listed below; only the version + health endpoints skip auth.

### 5.1 `GET /api/version`

No auth required. Returns 200 with:

```json
{
  "helper": "0.4.3",
  "protocol": "1",
  "gui_bundled": "0.5.0"
}
```

- `helper`: the `bsky-saves` package version (semver string).
- `protocol`: the API protocol version. Increment when adding endpoints or changing existing shapes. The GUI's `MIN_HELPER_VERSION` constant uses this to decide whether to proceed or render `OutdatedHelperBanner`.
- `gui_bundled`: the `GUI_VERSION` value the wheel was built against.

### 5.2 `GET /api/health`

No auth required. Returns `200 OK` with empty body. Used by `probeHelper()` for liveness.

### 5.3 All other endpoints

- Require the session token (§4.5) and the Origin allowlist check (§4.4).
- Destructive operations (bulk delete, export-to-disk, credential rotation if added later) **must require an additional confirmation that the user took an explicit local action** — not just a POST from the GUI. This blunts the R2 attack: even if `saves.lightseed.net` is compromised, a POST to `/api/saves/delete-all` shouldn't be enough; the user has to click "yes" in a daemon-issued confirmation (terminal prompt, system tray, or similar).
- Versioned endpoint paths (`/api/v1/...`). Endpoints introduced in a newer protocol version return `426 Upgrade Required` when called against an older daemon that doesn't implement them.

The GUI's actual endpoint usage (the set you must implement to make the existing GUI work) is enumerated in the `bsky-saves-serve-distribution-requirements.md` doc. This spec only covers the contract-level shape; the per-endpoint specs live there.

---

## 6. Release-process requirements

### 6.1 Changelog

- Each wheel release's changelog notes the bundled `GUI_VERSION`. A bump to `GUI_VERSION` without a corresponding wheel release is fine; the next wheel release picks it up automatically.

### 6.2 PyPI publishing

- Use PyPI Trusted Publishers (OIDC), not long-lived API tokens.

### 6.3 Pre-release smoke test in CI

Run before publishing. Steps:

1. Build the wheel (which runs the fetch hook from §3.2).
2. Install the wheel in a fresh venv.
3. Start `bsky-saves serve --gui` on a non-default port (avoid colliding with anyone's local daemon).
4. `curl http://127.0.0.1:<port>/` returns the bundled `index.html` (`grep -q '<meta name="bsky-saves-token"'`).
5. `curl http://127.0.0.1:<port>/api/version` returns valid JSON with the expected three fields.
6. `curl http://127.0.0.1:<port>/api/health` returns 200.
7. Shut down the daemon.

Failure of any step blocks the release.

---

## 7. Non-goals for MVP

- **Auto-update.** The wheel does not self-update. Users `pipx upgrade bsky-saves`.
- **Mutual TLS or hardware-attested pairing** between hosted PWA and helper. Session token over HTTP-on-localhost is sufficient for MVP; pairing UX can iterate later.
- **Tier 2/3 installers** (frozen binaries, OS-native installers). Once the wheel reliably ships with a vendored GUI, that's a separate workstream in `bsky-saves-installers`.
- **Sigstore/cosign signing of the GUI tarball.** Stretch goal once basic SHA-256 pinning is in place.
- **Anything not listed above.** Keep MVP small.

---

## 8. Acceptance criteria

The GUI team considers this work done when all of the following hold against the next published wheel:

1. `pip install bsky-saves` followed by `bsky-saves serve --gui` mounts the GUI at `http://127.0.0.1:<port>/`.
2. The page renders, the manifest validates, and `GET /api/version` returns the expected shape.
3. The GUI's `probeHelper()` resolves on the served origin (i.e. the helper appears in `detectBackends()`).
4. `OutdatedHelperBanner` does **not** render against the current wheel — i.e. the wheel's `protocol` value is `>= MIN_HELPER_VERSION` in the GUI.
5. A cross-origin request from `evil.com` to `http://127.0.0.1:<port>/api/version` is blocked (Origin check or CORS preflight rejection).
6. A request with `Host: evil.com` (DNS rebinding sim) returns `421`.
7. A request to `/api/...` without the session token returns `401`.
8. Build-hook CI failure on a deliberately corrupted `dist.tar.gz.sha256` pin.

When these eight pass, the GUI team can drop the placeholder S5/S7/S8 jobs in the GUI's release workflow and wire them up against the real wheel.

---

## 9. Glossary

- **GUI bundle / `dist.tar.gz`** — the static Svelte build attached to each `bsky-saves-gui` release. ~270 KB.
- **Helper / daemon** — `bsky-saves serve`. Long-running localhost process.
- **`saves.lightseed.net`** — the operator's hosted PWA deploy. Same bundle as the wheel ships.
- **Session token** — random 256-bit value, regenerated per daemon start, embedded in `index.html`, required on all `/api/*` calls.
- **Protocol version** — coarse-grained integer carried in `/api/version`. Increment on contract-breaking changes.
- **`GUI_VERSION`** — the tag of `bsky-saves-gui` the current wheel is built against. Pinned in `bsky-saves`'s source.
- **`MIN_HELPER_VERSION`** — the minimum protocol the GUI requires to enter local mode. Defined in `bsky-saves-gui/app/src/lib/min-helper-version.ts`.
- **Capability resolution** — runtime probing; the same JS bundle behaves correctly with or without a helper present.

---

## 10. Cross-references

If you want more context than this doc provides, the following exist in `bsky-saves-gui`:

- `docs/bsky-saves-gui-dist-workstream.md` — full multi-repo workstream including the GUI-side release gate (S1–S9) and security risk matrix (R1–R7). This spec is Section 4 of that doc, restated.
- `docs/bsky-saves-serve-distribution-requirements.md` — the broader vision for `bsky-saves serve` (capability probes, error responses, installer story). Source-of-truth for per-endpoint API shapes when you get to them.
- `app/src/lib/helper-client.ts` — the GUI's helper-probing code. Read this to see what the GUI actually expects from `/api/version` and `/api/health`.
- `app/src/lib/min-helper-version.ts` — the current minimum protocol version the GUI accepts.

If anything in this spec contradicts those source files, the source files are authoritative — file a GUI-side issue and the workstream doc gets updated.

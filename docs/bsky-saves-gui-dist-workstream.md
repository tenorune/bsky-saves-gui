# GUI ↔ wheel ↔ installer workstreams

> Companion to `bsky-saves-serve-distribution-requirements.md`. That doc defines the artifacts users receive. This doc defines how the repos that produce those artifacts coordinate without forcing every GUI commit through a wheel release.

## Goal

Let `bsky-saves-gui` iterate continuously while keeping `bsky-saves` (the Python daemon) and the downstream installer pipeline stable, releasable, and security-reviewable. The hosted PWA at `saves.lightseed.net` should always reflect the latest GUI tag; wheel and installer users should receive the GUI on a deliberate, slower cadence chosen by their respective maintainers.

## 1. Fleet plan

### User segments and the artifacts that serve them

| Segment | Artifact | Source repo | Refresh model |
|---|---|---|---|
| Mobile / desktop visitor, no install | Hosted PWA at `saves.lightseed.net` | `bsky-saves-gui` | Per merge to main (Pages), tag drives wheel/installer artifacts |
| CLI user with Python | `pipx install bsky-saves` | `bsky-saves` | Per wheel release (PyPI) |
| CLI user without Python | Standalone single binary | `bsky-saves-installers` | Per installer release (GH releases) |
| Non-technical desktop user | OS-native installer (`.dmg` / `.msi` / `.AppImage`) | `bsky-saves-installers` | Per installer release |

Two distinct pipelines run from this repo, gated separately: `ci.yml` runs on every PR and on push to `main`, and the same push triggers `pages.yml` which deploys `dist/` to `saves.lightseed.net` — so `ci.yml` is what gates what reaches the hosted PWA. `release.yml` runs only on `vX.Y.Z` tag pushes and applies the S1–S9 gates documented in § 5; its output (`dist.tar.gz` + `.sha256` + `SBOM.cdx.json`) is what wheel and installer pipelines consume. Hosted-PWA users therefore get every green main, while wheel/installer users receive what the downstream maintainers pinned from the tagged release.

### Three artifact tiers from a single upstream

1. **Wheel** (`pip install bsky-saves`) — Python source plus a vendored snapshot of `dist/`. The `serve --gui` flag mounts the bundle on localhost so wheel users get the local-GUI experience without any extra step.
2. **Standalone binary** — PyInstaller / Briefcase / Nuitka frozen from the wheel. ~30 MB on disk. For CLI users without Python.
3. **Installer + launcher** — wraps the binary with a tray icon, autostart, and a "Open local GUI" button. For non-technical users.

Each tier is a strict superset of the previous. There is no fork in any codebase; tier 2 is the wheel frozen, tier 3 is the binary wrapped.

### Capability resolution is runtime, not build-time

The GUI already routes between worker-proxy and local-helper paths at runtime via `lib/helper-client.ts::probeHelper`, `lib/operator-proxy-probe.ts`, and the `min-helper-version` check. The same JS bundle therefore behaves correctly whether it is served from `saves.lightseed.net` or from the wheel-bundled `dist/`. No build-time fork is needed to "strip worker UI for the wheel." A visitor to `saves.lightseed.net` who happens to have a helper running auto-upgrades to local mode — a strict benefit of the single-bundle model.

## 2. Workstreams

### Repos and cadences

```
┌─────────────────────────┐    ┌─────────────────────────┐    ┌─────────────────────────┐
│ bsky-saves-gui          │    │ bsky-saves              │    │ bsky-saves-installers   │
│ Svelte / Vite / PWA     │    │ Python daemon + wheel   │    │ Frozen binaries +       │
│                         │    │                         │    │ OS-native installers    │
│ Cadence: hourly-daily   │    │ Cadence: weekly-monthly │    │ Cadence: monthly+       │
└───────────┬─────────────┘    └───────────┬─────────────┘    └───────────┬─────────────┘
            │                              │                              │
            │ produces:                    │ produces:                    │ produces:
            │  • saves.lightseed.net       │  • bsky-saves-X.Y.Z.whl      │  • bsky-saves-X.Y.Z.dmg
            │    deploy (per tag)          │    on PyPI                   │  • bsky-saves-X.Y.Z.msi
            │  • dist.tar.gz attached      │                              │  • bsky-saves-X.Y.Z.AppImage
            │    to GitHub release         │                              │
            │  • dist.tar.gz.sha256        │                              │
            │                              │                              │
            │ consumed by:                 │ consumed by:                 │
            └────────────► GUI_VERSION pin │                              │
                           in pyproject ◄──┴────► WHEEL_VERSION pin ──────┘
                                                  in installer build
```

### Boundary artifact

A single tarball per GUI tag, attached to the GitHub release:

- `dist.tar.gz` — production build, no sourcemaps, no `.test.` files, no `.env` artifacts.
- `dist.tar.gz.sha256` — checksum file, also attached to the release.
- `SBOM.cdx.json` — CycloneDX software bill of materials for the JS dependency tree.

The wheel build script in `bsky-saves` downloads the tarball from the release URL pinned by `GUI_VERSION`, verifies the SHA-256, and extracts it into `src/bsky_saves/_gui/` before running `python -m build`. No npm publish, no separate CDN, no live network call at `pip install` time.

### Pin-bump flow

- **Manual at first.** A maintainer in `bsky-saves` opens a PR that bumps `GUI_VERSION` in `pyproject.toml` and refreshes `dist.tar.gz.sha256`. CI fetches the new tarball, runs the wheel tests, and the maintainer merges when satisfied.
- **Automated PR later.** A GitHub Action in `bsky-saves-gui` opens a "bump GUI to vX.Y.Z" PR in `bsky-saves` on each tag. Same review gate, less typing.
- **Never auto-merge.** The pin bump is a code change with security implications; it must pass human review.

### API-version contract

The runtime safety net that lets the GUI run ahead of any given wheel:

- GUI declares `MIN_HELPER_VERSION` (already in `lib/min-helper-version.ts`).
- Helper exposes `/api/version` returning `{ helper, protocol, gui_bundled }`.
- On boot the GUI calls `probeHelper()`, compares versions, and either proceeds or shows `OutdatedHelperBanner` (already in `components/library-status/OutdatedHelperBanner.svelte`).
- New helper endpoints land behind a `protocol` version bump; the GUI feature-detects per-capability rather than version-gating wholesale.

## 3. Security risks and mitigations

### R1 — Tarball tampering between GUI release and wheel build

**Risk.** A compromised GitHub Action, CDN cache, or MITM could substitute a malicious `dist.tar.gz`. Every wheel built afterwards would ship the payload.

**Mitigation.**
- Pin the tarball SHA-256 in `bsky-saves` repo (`dist.tar.gz.sha256` committed alongside `GUI_VERSION`). Wheel build aborts on mismatch.
- Restrict who can push tags to `bsky-saves-gui` (GitHub tag protection rules).
- Use OIDC-based publishing (no long-lived deploy tokens).
- (Stretch) sign releases with sigstore or cosign; verify signature in the wheel build.

### R2 — Compromised `saves.lightseed.net` attacks every running helper

**Risk.** XSS, dependency takeover, or a CDN compromise on `saves.lightseed.net` would give an attacker a privileged frontend that can drive every user's local helper.

**Mitigation.**
- Strict CSP on the hosted PWA: `default-src 'self'; script-src 'self' 'strict-dynamic'; object-src 'none'; frame-ancestors 'none'`.
- Subresource integrity on any externally hosted asset.
- Helper must not blindly trust the GUI. Destructive operations (bulk delete, export-to-disk, credential rotation) require a daemon-issued confirmation that the user took an explicit local action — not just a POST from the GUI.
- Helper exposes a minimal, scoped API; no general-purpose "run arbitrary atproto call" endpoint.

### R3 — DNS rebinding against the local helper

**Risk.** A user visits `evil.com`. The page's JS waits, DNS for `evil.com` re-resolves to `127.0.0.1`, and same-origin policy now lets `evil.com` script the helper.

**Mitigation.**
- Helper binds to `127.0.0.1` only by default; never `0.0.0.0`.
- Helper validates the `Host` header against `{127.0.0.1, localhost}:<port>` and rejects anything else with `421 Misdirected Request`.
- Helper validates the `Origin` header against an allowlist: `http://127.0.0.1:<port>`, `http://localhost:<port>`, `https://saves.lightseed.net`. All other origins receive `403`.
- Helper requires a session token (random per-start) for every request. The token is embedded in the locally-served `index.html` and, for the hosted PWA, surfaced via an explicit pairing step (display token in the terminal / system tray; user pastes once).

### R4 — GUI/helper version skew exposes destructive endpoints

**Risk.** A newer GUI calls a destructive endpoint on an older helper that does not enforce the latest scope checks, or vice versa.

**Mitigation.**
- `MIN_HELPER_VERSION` gate already in place; GUI refuses to call helpers below the minimum.
- Helper rejects requests for endpoints introduced in newer protocol versions with `426 Upgrade Required`.
- Destructive endpoints are versioned in their path (`/api/v1/saves/delete`) and are not silently re-routed across versions.

### R5 — Supply chain compromise in the JS toolchain

**Risk.** A malicious npm package transitively pulled by `vite-plugin-pwa`, `workbox-*`, or any other dependency injects code into `dist/`.

**Mitigation.**
- `pnpm-lock.yaml` committed (already in place); CI runs `pnpm install --frozen-lockfile`.
- `pnpm audit` gate in CI, allowlisted advisories tracked in repo.
- Dependabot or Renovate weekly PR cadence.
- SBOM (CycloneDX) generated and attached to each release; downstream consumers can diff between versions.
- Build runs in a clean GitHub-hosted runner — no self-hosted runner shared with other workloads.

### R6 — Credential exposure in the GUI build

**Risk.** A `.env` value accidentally inlined by Vite ships to every browser and every wheel.

**Mitigation.**
- Vite only exposes variables prefixed `VITE_`; project convention restricts those to non-sensitive values.
- Pre-release scan (see § 5, smoke test S6) greps `dist/` for known sensitive prefixes and patterns.

### R7 — Installer auto-update path (future)

**Risk.** Once installers support auto-update, the update channel is a remote-code-execution vector for every installed user.

**Mitigation.**
- Out of scope for MVP — no auto-update in tier 2/3 yet. When added, require code signing (Authenticode on Windows, codesign + notarization on macOS), update channel pinned to a single GitHub releases URL over HTTPS, and a kill-switch the user can disable.

## 4. Requirements to the bsky-saves team for MVP

The smallest change set in `bsky-saves` that lets this workstream run end-to-end. These are the contracts the GUI repo will rely on.

### Build pipeline

1. Add `GUI_VERSION` to `pyproject.toml` (or a sibling `gui-version.txt`).
2. Commit `gui-dist.sha256` alongside `GUI_VERSION`.
3. Add a build hook (`scripts/fetch_gui.py`, or a Hatch/setuptools custom build step) that:
   - Reads `GUI_VERSION` and the pinned SHA-256.
   - Downloads `https://github.com/tenorune/bsky-saves-gui/releases/download/v{GUI_VERSION}/dist.tar.gz` over HTTPS, no redirects to non-GitHub hosts.
   - Verifies the SHA-256. Aborts the build on mismatch.
   - Extracts to `src/bsky_saves/_gui/`.
4. Mark `_gui/` as package data so it ships in the wheel; mark it gitignored so it never lands in source control.
5. CI for `bsky-saves` runs the build hook on every PR; a tarball-fetch failure or checksum mismatch fails CI.

### Daemon behavior

6. Add a `bsky-saves serve --gui` flag (or make GUI-serving the default; behind a flag is fine for MVP).
7. Mount `_gui/` as static files at `/`. Apply SPA fallback: unknown paths return `index.html`.
8. Bind to `127.0.0.1` only by default; require an explicit `--host` flag for any other bind address. `--host 0.0.0.0` prints a security warning to stderr.
9. Validate `Host` header. Reject anything not in `{127.0.0.1, localhost}:<port>` with `421`.
10. Apply `Origin` allowlist on every API route. Default allowlist: `http://127.0.0.1:<port>`, `http://localhost:<port>`, `https://saves.lightseed.net`. Configurable via `--allowed-origin` for advanced users.
11. Generate a random session token on daemon startup. Embed it in the served `index.html` (a `<meta name="bsky-saves-token">` tag is sufficient). Require it in `Authorization: Bearer <token>` on every API request.
12. Emit security headers on the served GUI:
    - `X-Frame-Options: DENY`
    - `Referrer-Policy: no-referrer`
    - `Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'`
    - `Cache-Control: no-store` on `index.html`, long-lived immutable on `/assets/*` (Vite-hashed).

### API endpoints required for the contract

13. `GET /api/version` → `{ "helper": "0.4.3", "protocol": "1", "gui_bundled": "0.5.0" }`. Returns 200 without authentication so the GUI can probe before the user is signed in.
14. `GET /api/health` → `200` with empty body. Used by `probeHelper()` for liveness.
15. All other endpoints require the session token and the origin allowlist check.

### Release process

16. Wheel changelog notes the bundled `GUI_VERSION` for each release.
17. Wheel published via PyPI Trusted Publishers (OIDC), not long-lived tokens.
18. Pre-release smoke test in `bsky-saves` CI: start `bsky-saves serve --gui` against a freshly built wheel, `curl /` returns the bundled `index.html`, `curl /api/version` returns the expected shape.

### Non-goals for MVP

- Auto-update of the wheel.
- Mutual TLS or hardware-attested pairing between hosted PWA and helper. (Session token over HTTP-on-localhost is sufficient; pairing UX can iterate later.)
- Tier 2/3 installers. Once the wheel reliably ships with a vendored GUI, the installer repo can freeze it; that work is separable.

## 5. GUI-side smoke tests before passing a dist build over

Run as a release-gate workflow in `bsky-saves-gui`. Each test is a hard gate; failure prevents `dist.tar.gz` from being attached to the release.

### S1 — Build cleanliness

- `pnpm install --frozen-lockfile` exits 0.
- `pnpm check` (svelte-check) exits 0 with no errors.
- `pnpm test` exits 0; coverage delta within acceptable bounds.
- `pnpm build` exits 0.

### S2 — Bundle integrity

- `dist/index.html` exists, parses as valid HTML, references hashed asset filenames that all exist on disk.
- `dist/sw.js` and `dist/manifest.webmanifest` exist (PWA contract).
- Every `<script>` / `<link>` href in `index.html` resolves to a real file under `dist/`.

### S3 — Bundle hygiene

- No `.map` files in the production tarball (sourcemaps stripped; kept as a separate artifact for debugging).
- No `node_modules/`, no `.test.` / `.spec.` files, no `.env*`, no `tsconfig*` in `dist/`.
- No absolute filesystem paths from the build host: `grep -rE '/home/|/Users/|C:\\\\Users\\\\' dist/` returns empty.
- Bundle size budget: shipped `dist/` (no maps) under 1.5 MB total, no single chunk over 400 KB (excluding the deliberately-large `CustomProxySetupModal`).

### S4 — PWA / service-worker sanity

- Precache manifest in `sw.js` lists only files that exist in `dist/`.
- Precache count and total size within budget (currently ~42 entries / 710 KB; alert if it doubles).
- Service worker version string updated since previous release.

### S5 — Runtime smoke test against a real helper

Spin up a known-good `bsky-saves serve --gui` (the latest published wheel) in CI, point a Playwright run at it, and verify:

- `GET /` returns the new `index.html` and the page mounts without console errors.
- `probeHelper()` resolves; the GUI does not render `InstallHelperHint`.
- The version banner in Settings renders the wheel's `helper` and `protocol` strings.
- `OutdatedHelperBanner` does NOT render against the currently-pinned wheel.
- Sign-in route renders.
- Library route renders and lists at least one stub post from a recorded fixture.
- Backup-trigger flow reaches the helper (recorded fixture; no real network to Bluesky).

### S6 — Security scans

- `grep -rE 'BLUESKY_|CLOUDFLARE_|API_KEY|SECRET|TOKEN' dist/` returns empty (or returns only known-safe matches against a documented allowlist).
- `pnpm audit --prod` returns no high/critical advisories, or all advisories are in `audit-allowlist.json` with documented justifications.
- CycloneDX SBOM (`SBOM.cdx.json`) generated; diff vs. previous release reviewed if any new dependencies appear.

### S7 — Cross-context behaviour

The same tarball is used by `saves.lightseed.net` AND by the wheel, so both contexts must work:

- Boot the bundle from a static `python -m http.server` on `localhost:8000` with no helper running. GUI should fall back to worker / operator-proxy paths cleanly; no uncaught errors.
- Boot the bundle from the wheel's `serve --gui`. GUI should detect the helper and hide worker-setup prompts.
- Boot the bundle from `saves.lightseed.net` (staging deploy). Helper-detection probe to a stubbed helper at `127.0.0.1:<port>` succeeds and the GUI upgrades to local mode.

### S8 — API-contract compatibility

- `MIN_HELPER_VERSION` in `lib/min-helper-version.ts` is ≤ the version of the wheel currently pinned in `bsky-saves`'s `GUI_VERSION` bump target. If the GUI raises the minimum, the release notes flag it as a coordinated change and the corresponding `bsky-saves` release must land first (or simultaneously).

### S9 — Release artifact production

Only after S1–S8 pass:

- Produce `dist.tar.gz` (production files only) and `dist.tar.gz.sha256`.
- Produce `dist-with-maps.tar.gz` as a separate debug artifact (not consumed downstream).
- Produce `SBOM.cdx.json`.
- Attach all three plus the checksum to the GitHub release.
- Tag the deploy to `saves.lightseed.net` with the same version string.

Any later, manual step (the maintainer of `bsky-saves` bumping `GUI_VERSION`) consumes these artifacts. The smoke-test gate is therefore the only assertion-of-fitness between the two repos; everything downstream relies on it.

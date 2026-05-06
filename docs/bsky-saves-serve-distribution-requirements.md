# `bsky-saves serve` — distribution requirements (serve-for-all)

> Companion to `bsky-saves-serve-requirements.md` (the v1 API spec). That spec defines what `serve` *is*. This doc defines what it must *become* to be usable by every saves.lightseed.net visitor.

## Goal

Make `bsky-saves serve` functionally available to every user of the saves.lightseed.net web app — including users without Python, without a Cloudflare account, and without comfort in a terminal. Today's "install Python, install pipx, install bsky-saves, run `bsky-saves serve` in a terminal" path is the single biggest friction in the GUI's onboarding flow, and it leaves several user segments unable to back up images or articles at all.

## Background

The GUI offers three CORS-bypassing backup backends, in fallback order:

1. **Local helper** — `bsky-saves serve` running on the user's machine. Full feature set (image proxy + article extraction). Requires Python + terminal.
2. **User-deployed Cloudflare Worker** — the in-app Setup Guide walks a user through deploying a Worker with image proxy + (optional) article extraction. Requires a Cloudflare account and a ~10-minute setup.
3. **Operator's Cloudflare Worker** — image proxy only (no article extraction). Zero setup, but operator-controlled and limited.

Users who can't or won't do (1) or (2) fall back to (3) and lose article backup entirely. We want to raise the floor so (1) is reachable by anyone.

## Underserved user segments

- "I don't have Python installed and don't want to install it."
- "I'm not comfortable in a terminal."
- "I'm on a Chromebook / iPad / phone and can't run servers."
- "I don't want a Cloudflare account."
- "I tried `pipx install bsky-saves` and got an error my search engine couldn't decode."

Each of these falls back to the operator proxy and loses articles.

## Requirements

### 1. Cross-platform installers, no Python prerequisite

- **macOS**: notarized `.pkg` or `.dmg`. Universal binary (Apple Silicon + Intel).
- **Windows**: signed `.exe` / `.msi` installer (Authenticode-signed to avoid SmartScreen warnings).
- **Linux**: at minimum a static `.AppImage`. Optional `.deb` / `.rpm` / Flatpak / Snap.

The bundle must include its own Python runtime (PyOxidizer, PyInstaller, or BeeWare's Briefcase). Users must not need to install Python separately, must not need pipx, and must not need to use `pip`.

### 2. GUI launcher

When the user opens the installed app:

- A small status window or system-tray / menu-bar icon appears.
- The window shows: current listening port (default `47826`), bsky-saves version, a tail of recent log lines, an "Open saves.lightseed.net" button, and a "Quit" button.
- Platform integration: macOS menu-bar icon; Windows system tray; Linux AppIndicator with a window fallback.
- The launcher is a thin wrapper around `bsky-saves serve` — it spawns the existing daemon and surfaces the UI. The CLI `bsky-saves serve` continues to work for power users; the launcher is optional sugar.

### 3. Auto-start on login (opt-in)

A toggle in the launcher's settings: "Start bsky-saves at login." Implementation per OS:

- macOS: LaunchAgent plist.
- Windows: `Run` registry key or scheduled task.
- Linux: `~/.config/autostart/bsky-saves.desktop`.

Off by default; enabled with one click.

### 4. Single-binary fallback for power users

A downloadable single binary (no installer) for users who want curl-pipe-bash or want to ship via configuration management. Targets at least:

- `linux/amd64`, `linux/arm64`
- `darwin/amd64`, `darwin/arm64`
- `windows/amd64`

### 5. Capability probe for the in-browser GUI

Already covered by the existing `/ping` endpoint, which returns `{name, version, features[]}`. The GUI uses `features[]` to feature-detect (e.g., a daemon compiled without Trafilatura would advertise `["fetch-image"]` and omit `"extract-article"`).

The cf-worker template uses a separate `/capabilities` endpoint because it doesn't have a `/ping`-like surface. The local helper already does, so a `/capabilities` endpoint here would be redundant. **Out of scope** — keep `/ping` as the single capability advertisement.

### 6. Stable + documented API contract

The v1 spec already locks the shape of `/ping`, `/fetch-image`, `/extract-article`. Publish an OpenAPI schema alongside each release so external tooling (and the GUI's TypeScript types) can be regenerated programmatically.

### 7. Versioning + upgrade signal

- `/ping`'s `version` field is the public compatibility marker (already exists).
- The GUI's `app/src/lib/min-helper-version.ts` defines a minimum (`MIN_HELPER_VERSION`) and surfaces an inline "outdated, upgrade to X+" warning whenever the running daemon is older. Today that minimum is `0.3.1` because of the thread-fix in 0.3.1.
- Bump major on API-breaking changes, minor on additive changes (new endpoint, new feature flag), patch on bug fixes.
- The launcher (req. 2) should periodically check the `bsky-saves` GitHub Releases feed and surface an "Update available" badge. Opt-out-able.

### 8. Localhost-only by default

`serve` binds to `127.0.0.1` only (already required by v1 spec). Document but don't expose a `--bind` flag in the launcher UI — power users can still pass it via the CLI.

### 9. Helpful error responses

When the daemon refuses a request, return a JSON body with a human-readable `error` and (when relevant) an actionable next step. Example:

```json
{
  "error": "Origin not allowed",
  "hint": "Pass --allow-origin https://your-deployment.example to permit it."
}
```

This makes the in-browser status messages (already keyed off the JSON `error` field) actionable.

### 10. No telemetry

`bsky-saves serve` makes no outbound requests beyond what the GUI explicitly asks it to proxy. The launcher's "Update check" (req. 7) is the one exception, and that should be opt-out-able.

## Distribution channels

In rough priority order:

1. **GitHub Releases** with one-click downloads per OS (req. 1). This is the canonical source.
2. **Homebrew tap**: `brew install tenorune/tap/bsky-saves`.
3. **winget / Scoop** for Windows.
4. **Flathub / Snapcraft** for Linux.
5. **pipx** (current) — keep as the power-user path; not removed.

Each channel pins to the same release artifacts so the version reported by `/ping` matches what's in the GitHub release.

## Acceptance criteria for the "0.4" (or "1.0") release that closes serve-for-all

- A non-technical user on macOS, Windows, and Linux can:
  1. Visit a single landing page.
  2. Download the right installer for their OS (auto-detected).
  3. Run it (one double-click; no terminal).
  4. Open the installed app and see a green "running" indicator within 60 seconds.
  5. Refresh saves.lightseed.net and see "the local helper (bsky-saves X.Y.Z)" detected in Settings → Backup.
- The same user can quit the app and restart it without re-doing setup.
- The same user can upgrade to the next patch by downloading a new installer; existing settings (port, auto-start, allow-origins) survive.
- `/ping`, `/fetch-image`, `/extract-article` (and any added in the fetch/enrich/threads doc) are documented in an OpenAPI schema published alongside the release.
- The CLI path (`pipx install bsky-saves && bsky-saves serve`) keeps working for power users who don't want the GUI launcher.
- Total disk install size ≤ 80 MB compressed (for an embedded Python runtime + Trafilatura + httpx).

## Out of scope for this round

- **iOS / Android native apps.** Different threat model, separate effort. (Mobile users are essentially stuck with the operator proxy until then; that's accepted.)
- **Hosted SaaS version of `serve`.** Running `serve` for users on a remote box undermines the locality guarantees and exposes a generic web-fetcher to abuse. The Cloudflare Worker template fills this niche better.
- **Bundling `serve` into the cf-worker.** `serve`'s value over the worker is local execution (no rate limits, no CPU caps, no operator). The worker is a separate, complementary path.
- **In-browser via WebAssembly / Pyodide.** Pyodide can run `bsky-saves` for inventory fetching but cannot bind a port; it can't replace the loopback `serve` daemon. Browsers don't expose listening sockets to JavaScript.
- **Auto-update / silent installs.** Surface a notification, but let the user trigger the install. Avoid "background updater" surface area.
- **Phase-2 `POST /run`** — the GUI's longer-term goal of routing inventory fetch through the helper as well. Tracked separately in the v1 spec; not part of serve-for-all.

## Notes for the GUI side (already in place)

- Probes `/ping` at startup; surfaces helper version + features in Settings → Backup.
- Min-version warning (`min-helper-version.ts`) — currently set to 0.3.1.
- Setup Guide modal can grow per-OS download links once the installers exist.
- Capability detection via `/ping`'s `features` array is already wired; new daemon features (`fetch`, `enrich`, `hydrate-threads`, etc.) appear in that array and the GUI feature-detects per-feature.
- No GUI-side blockers — the GUI is ready for the installers when they ship.

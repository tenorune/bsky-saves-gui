# Requirements: `bsky-saves serve` (local helper mode)

## Context

`bsky-saves` is a Python package (PyPI) that ingests Bluesky bookmarks. It's the engine behind:

- **CLI use** — users run `bsky-saves fetch` and friends from a terminal.
- **In-browser use via Pyodide** — a static web app, `bsky-saves-gui`, runs `bsky-saves` in a Web Worker so non-technical users can do everything without installing anything.

The web app can't fetch image bytes or external article URLs from the browser because of CORS: `cdn.bsky.app` and most article hosts don't send CORS headers, so any in-browser fetch (JS or Pyodide-via-XHR) is blocked from reading the response body.

This spec adds a new subcommand, `bsky-saves serve`, that turns an installed `bsky-saves` into a tiny localhost HTTP daemon. The web app probes for it on a known port; if it's running, the web app uses it to fetch images and extract articles, with the user's machine doing the actual outbound HTTP. No bytes ever touch the operator.

`serve` does **not** replace any existing CLI subcommand. It adds a new one. The CLI keeps working as before.

## Audience and goals

- **Primary user**: someone using `bsky-saves-gui` who clicks "save my own copy of images" or "save my own copy of articles." They installed `bsky-saves` once with `pip install bsky-saves` and ran `bsky-saves serve`. Beyond that, the web app handles everything.
- **Goal**: a single Python install gives them both the CLI they already had AND a working backup backend for the web app.
- **Non-goal**: serving anything other than the bsky-saves-gui static site. This is not a general-purpose proxy.

## Command shape

```
bsky-saves serve [--port PORT] [--allow-origin ORIGIN]... [--verbose]
```

| Flag | Default | Purpose |
|---|---|---|
| `--port` | `47826` | TCP port to bind. Fixed default so the web app can probe a known address. |
| `--allow-origin` | `https://saves.lightseed.net` (repeatable) | Origins permitted to call this daemon. Self-hosted GUI deployments at other domains pass `--allow-origin https://my-site.example` (one or more times). |
| `--verbose` | off | Log each request to stderr. Default is silent. |

Binds to `127.0.0.1` only. Never `0.0.0.0`. This is a hard requirement; the helper must not be reachable from any other machine on the network.

On startup, prints a single line to stderr:

```
bsky-saves serve listening on http://127.0.0.1:47826 (origins: https://saves.lightseed.net)
```

Ctrl-C exits cleanly.

## HTTP API

All endpoints respond with appropriate CORS headers. The exact CORS rules are described below the endpoint list.

### `GET /ping`

Health check and capability advertisement. The web app calls this on startup to detect a running helper.

**Response** (200 OK, `application/json`):

```json
{
  "name": "bsky-saves",
  "version": "0.2.4",
  "features": ["fetch-image", "extract-article"]
}
```

`features` lists the operations this daemon supports. Future versions may add or remove entries; the web app must tolerate unknown features and degrade gracefully when an expected feature is absent.

`version` matches `bsky_saves.__version__`.

### `POST /fetch-image`

Fetches a single image URL on behalf of the web app and streams the bytes back.

**Request body** (`application/json`):

```json
{ "url": "https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:.../bafkrei...." }
```

**Allowed URLs**: only `https://cdn.bsky.app/...` and `https://*.bsky.app/...`. Any other URL must return `400 Bad Request` with body `{"error":"url not allowed"}`. This URL allowlist is hard-coded; it is not configurable. Rationale: the helper is reachable by any local web page in the browser; the allowlist is the only thing stopping a malicious site from using it as an open image proxy.

**Response** (200 OK, `image/*`): the image bytes, with `Content-Type` copied from the upstream response. `Content-Length` set if known.

**On upstream failure**: status code from upstream, body `{"error":"upstream <code>"}`. Network errors are 502.

**Timeout**: 30 seconds per image, hard cap. Configurable in a later version, not now.

### `POST /extract-article`

Fetches an article URL and runs `trafilatura`-based extraction on it. Returns extracted text and metadata as JSON.

**Request body** (`application/json`):

```json
{ "url": "https://example.com/some-article" }
```

**Allowed URLs**: any `http://` or `https://` URL. Articles are user-saved Bluesky posts' linked URLs; the URL space is the open web by definition. The protection here is the **origin allowlist** (only the configured GUI origin can call this endpoint), not the URL allowlist.

**Response** (200 OK, `application/json`):

```json
{
  "url": "https://example.com/some-article",
  "title": "Article title",
  "text": "Extracted body text…",
  "fetched_at": "2026-05-03T12:34:56Z"
}
```

If extraction succeeds but no body text could be found (paywall, JS-rendered, login wall): 200 OK with `text: ""` and a `note: "no extractable body"` field. The caller treats this as "fetched but empty," not as an error.

If the upstream fetch fails: status code from upstream (or 502 on network error), body `{"error":"<message>"}`.

**Timeout**: 60 seconds. Articles can be slow.

### CORS

For every endpoint:

- `Access-Control-Allow-Origin` echoes the request's `Origin` header **if and only if** that origin is in the configured allowlist. Otherwise the header is omitted, which causes the browser to fail-closed.
- `Access-Control-Allow-Methods: GET, POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`
- Preflight `OPTIONS` requests return 204 with the same headers and no body.
- `Access-Control-Max-Age: 600` (cache preflights for 10 minutes).

Requests with no `Origin` header (e.g. `curl`) are allowed. CORS is a browser-side mechanism; non-browser clients would just ignore the headers anyway.

### Reserved paths

- Any unknown path returns 404 with body `{"error":"not found"}`.
- The daemon must not serve files from disk or expose any debugging surface.

## Privacy and safety constraints

These are hard requirements, not nice-to-haves:

- **Bind to 127.0.0.1 only.** Not 0.0.0.0, not a hostname, not configurable. The helper exists *because* localhost is a secure context; binding broader undoes the entire safety story.
- **No logging of URLs by default.** With `--verbose`, log to stderr only. Never to disk. Never to any external service.
- **No persistence.** The helper does not write to disk. It reads no config files. It has no database. Bytes flow through and are forgotten.
- **No authentication required.** The origin allowlist + 127.0.0.1 binding is the auth layer. Don't add a shared-secret system; the user has nowhere to copy a secret to.
- **No credentials.** The helper does not need or accept Bluesky credentials. It's a dumb passthrough.

## Discovery contract with the web app

The web app probes `GET http://127.0.0.1:47826/ping` on:

- Initial library load.
- When the user opens the Settings page.
- When the user clicks a "Save my own copy" affordance and no other backup method is configured.

If `/ping` returns a JSON body with `name === "bsky-saves"`, the helper is considered detected. The web app shows status (e.g. "Local helper detected: bsky-saves 0.2.4 — images, articles") in Settings.

If detection fails, the web app does not retry on a timer. The user re-triggers detection by reloading or by clicking a "Check for helper" button in Settings.

## Out of scope (for this version)

- Authenticated endpoints (sessions, JWT, etc.). Helper is anonymous within its origin allowlist.
- Streaming responses (e.g. progress for slow article extracts). Single response body, single 200/4xx/5xx.
- Concurrent connection limits, rate limits. The user is in control of their own machine; abuse vectors are limited to whatever pages they have open.
- Configurable URL allowlist for `/fetch-image`. Hardcoded to bsky.app domains; a future version can broaden if needed.
- Auto-launch on boot, system-tray UI, daemon supervision. The user runs `bsky-saves serve` when they want it.
- Windows service / macOS LaunchAgent integration. CLI command only.

## Implementation suggestions (non-binding)

- Stdlib `http.server.ThreadingHTTPServer` is sufficient. Avoid pulling in Flask / FastAPI for a daemon this small.
- Reuse the existing `httpx` client setup that `bsky_saves.images.download_to` already uses.
- For article extraction, reuse whatever path `bsky-saves` already has in `articles.py`.
- Tests: a thin integration test that boots the server on an ephemeral port, hits each endpoint with the standard library `urllib`, and verifies status/headers/body shape. CORS tests by setting Origin headers.

## Versioning

- The `/ping` `version` field is the public compatibility marker. Web app may eventually warn if `version` is below a known floor.
- New features (additional endpoints) get added to the `features` array. Web app feature-detects via `features`.
- Removing or renaming endpoints is a breaking change and should bump the bsky-saves major version.

# `bsky-saves` MVP requirements: vendoring the GUI + serving it locally

> **Audience.** Maintainers of [`bsky-saves`](https://github.com/tenorune/bsky-saves) (the Python daemon and PyPI wheel).
>
> **Purpose.** Define the smallest change set in `bsky-saves` that lets the project consume the [`bsky-saves-gui`](https://github.com/tenorune/bsky-saves-gui) release artifact and serve it from `bsky-saves serve --gui` on a user's localhost.
>
> **Sources reconciled.** This spec consolidates:
> - Section 4 of `bsky-saves-gui/docs/bsky-saves-gui-dist-workstream.md` (GUI-vendoring and `--gui`-serving requirements; security rationale).
> - `bsky-saves-gui/docs/bsky-saves-serve-requirements.md` (v1 `serve` API: `/ping`, `/fetch-image`, `/extract-article`; CORS; bind/origin rules).
> - `bsky-saves-gui/docs/bsky-saves-serve-fetch-enrich-threads-requirements.md` (v0.4 API expansion: `/fetch`, `/enrich`, `/hydrate-threads`; JWT-pair credentials).
>
> Where the workstream doc and the `serve` requirements docs disagreed, this spec follows the `serve` requirements (which describe the design already shipping). Each such reconciliation is called out inline so reviewers can override.

---

## 1. Context

`bsky-saves-gui` is a Svelte/Vite PWA. It compiles to a static `dist/` tree that runs identically in three contexts:

- Hosted on `saves.lightseed.net` (production deploy).
- Served locally from `bsky-saves serve --gui` on the user's machine (this spec).
- Frozen into a standalone binary or OS installer (later, out of MVP scope).

The same JS bundle handles all three. At runtime the GUI probes for a local helper at `http://127.0.0.1:47826`; if present and capability-compatible, it upgrades to "local mode" (Bluesky API calls, image fetches, article extraction, and thread hydration all run through the helper instead of cross-origin proxies or in-browser Pyodide). If absent, it falls back gracefully.

What this spec asks of `bsky-saves`:

1. Consume the GUI's release tarball as a build-time input to the wheel.
2. Add a `--gui` flag to `bsky-saves serve` that mounts the bundled GUI on the same loopback port the API listens on.
3. Continue exposing the documented HTTP API (`/ping`, `/fetch-image`, `/extract-article`, `/fetch`, `/enrich`, `/hydrate-threads`) — already specified in the `serve` requirements docs, summarised here for the GUI team's contract reference.

This is **not** a rewrite of `serve`. It is the MVP path that lets a `pipx install bsky-saves` user open the GUI without ever touching a browser tab.

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
5. Idempotent: skip the download/extract only if `_gui/.gui-version` exists AND both lines match the pinned values:

   ```
   version=v0.5.2
   sha256=<hex>
   ```

   The hook treats any mismatch — including "version matches but SHA doesn't" — as "re-fetch." Writing the marker is the last step of a successful fetch.

### 3.3 Package data + gitignore

- Mark `_gui/` as package data so it's included when `python -m build` runs (in `pyproject.toml` under `[tool.setuptools.package-data]` or equivalent).
- Add `src/bsky_saves/_gui/` to `.gitignore`. The directory is build-time-populated, not source-tracked.

### 3.4 CI must run the build hook on every PR

- Every PR to `bsky-saves` runs the fetch hook before any test. A tarball-fetch failure (404, network error, mismatched checksum) fails CI.
- This catches three classes of regression at PR time, not at release time: a deleted GUI release, a corrupted tarball, a bad SHA-256 pin.

### 3.5 Security rationale

The pinned SHA-256 mitigates the risk of tarball tampering between GUI release and wheel build (compromised GitHub Action, CDN cache, MITM). Without the pin, any wheel built after a compromise would ship the malicious payload. With the pin, the wheel build aborts unless the bytes match what a reviewer signed off on.

### 3.6 Dev and test workflow

The build hook only fires under `python -m build` (or equivalent). Two scenarios fall outside that path and need explicit handling:

- **Editable installs** (`pip install -e .`): the hook is not invoked by editable installs in most build backends. Contributors must run `python scripts/fetch_gui.py` manually after clone, and re-run it after pulling a `GUI_VERSION` bump. The script is idempotent (§3.2.5) — repeated runs are cheap no-ops when the marker matches.
- **Tests**: pytest must not depend on a real network fetch. `--gui` tests use a temporary directory containing a minimal `index.html` (and whatever assets the test under-test requires) and monkeypatch the daemon's `_gui/` path resolution to point at the tempdir. Recommended fixture shape: a `pytest` fixture that builds the tempdir lazily and yields the path; `--gui` tests parameterise on it.

The real `_gui/` tree is touched only by the build hook. Tests, editable installs, and ad-hoc development environments never depend on its contents.

---

## 4. Daemon behaviour requirements

These apply to `bsky-saves serve --gui`. The `--gui` flag is required to enable GUI-serving — `bsky-saves serve` without it must continue to behave as it does today (API endpoints only, no static-file mount), so users who only want the API surface aren't forced to consume the bundled GUI.

### 4.1 Static file serving (only under `--gui`)

- Mount `_gui/` at `/`.
- Apply SPA fallback: any path that does not resolve to a real file in `_gui/` and is not a documented API path (see §5) returns `index.html` (the GUI handles routing client-side via the URL hash).
- **Reject dotfile-component paths**: any request path whose components begin with `.` (e.g. `/.gui-version`, `/.env`, `/foo/.bar`) returns `404`, not `index.html` and not the file. Bypasses the SPA fallback. Defends against DevTools-driven inspection of daemon-internal markers (`.gui-version` lives at the root of `_gui/`) and any inadvertent shipping of dotfile artifacts in `_gui/`.
- Asset files under `/assets/*` are Vite-hashed (immutable). Send `Cache-Control: public, max-age=31536000, immutable`.
- `index.html` and the SPA fallback are **not** hashed and must be revalidated. Send `Cache-Control: no-store`.
- Everything else under `_gui/` (icons, manifest, favicon, sw.js) gets `Cache-Control: no-cache` — revalidate on each load but cache OK after a 304.
- The API endpoint paths in §5 are reserved — they must take precedence over the SPA fallback.
- **If `--gui` is passed but `_gui/` is missing or doesn't contain `index.html`, refuse to start.** Print to stderr: `Error: GUI bundle not found at <path>; install from a wheel or run scripts/fetch_gui.py.` Exit `2` (distinct from `1` so wrappers can distinguish "GUI missing" from "generic startup error"). Silent degradation under explicit user intent is surprising and hides problems.

### 4.2 Bind localhost-only by default

- Default bind address: `127.0.0.1` (IPv4 loopback). Not `0.0.0.0`, not `::`. This is a hard requirement — see §4.7.
- Default port: `47826`. This is the port the GUI's `VITE_HELPER_ORIGIN` probes; changing it breaks discovery.
- `--port <n>` overrides the port.
- The `serve` command must not expose a `--host` flag in v1. Localhost-only is non-negotiable for the MVP threat model.

### 4.3 Host header validation

- Every request validates the `Host` header.
- Acceptable values: `127.0.0.1:<port>`, `localhost:<port>`. Anything else (including a different IP or another hostname pointing at 127.0.0.1 via `/etc/hosts`) is rejected with **`421 Misdirected Request`**.

### 4.4 Origin allowlist on the API

- Every API route validates the `Origin` header — including `/ping`. There is no per-route bypass.
- Default allowlist:
  - `http://127.0.0.1:<port>`
  - `http://localhost:<port>`
  - `https://saves.lightseed.net`
- `--allow-origin <origin>` (repeatable) **adds to** the default allowlist; it does not replace it. So `bsky-saves serve --gui --allow-origin https://example.com` permits all four origins (the three defaults plus `example.com`).

  > **Behaviour change for `bsky-saves`.** Today the flag *replaces* the defaults — passing `--allow-origin foo` silently drops `saves.lightseed.net` and the loopback origins, which is a footgun. The new contract is additive. The hosted GUI deploy at `saves.lightseed.net` keeps working unconditionally; advanced users add their own origins without re-declaring the defaults. If you ever need replace-semantics, propose `--allow-origin-only` as a separate flag — but no current use case requires it.
- Non-allowlisted origins receive **`403 Forbidden`** with body `{"error":"Origin not allowed"}`. Same enforcement on CORS preflight: `OPTIONS` from a disallowed origin also returns 403, not 204. Same allowlist check, same status code — one consistent rule across every method.
- Missing `Origin` header (e.g. from `curl` or a non-browser script) is allowed on every endpoint. CORS is a browser-side mechanism; non-browser callers don't have an `Origin` to check, and serving them is a deliberate accommodation for diagnostic tooling.
- For allowed origins, CORS preflight (`OPTIONS`) returns 204 with the matched origin echoed in `Access-Control-Allow-Origin`; never `*`. See §5.9 for full CORS rules.
- **Vite dev server origins are not pre-allowlisted.** Developers running both `vite dev` and `bsky-saves serve --gui` simultaneously (rare; only when iterating on the GUI itself) pass `--allow-origin http://localhost:5173` ad-hoc.

### 4.5 Authentication model: origin allowlist + 127.0.0.1 only

**No per-request authentication.** No session tokens, no `Authorization` headers, no shared secrets. The daemon trusts any browser-context request whose `Host` and `Origin` headers satisfy §4.3 and §4.4.

This is intentional. Rationale, from the `serve` requirements doc: *"The origin allowlist + 127.0.0.1 binding is the auth layer. Don't add a shared-secret system; the user has nowhere to copy a secret to."*

> **Reconciliation note.** The workstream doc (`bsky-saves-gui-dist-workstream.md` §4 item 11) proposed a session token embedded in `index.html` via `<meta name="bsky-saves-token">` and required on every request. The `serve` requirements doc rejects this design as user-hostile and unnecessary given the localhost-only bind. This spec follows the `serve` requirements. If the destructive-endpoint roadmap (§4.7) is brought forward, the auth question may need to be reopened — at that point, daemon-issued out-of-band confirmation (terminal prompt, system tray) is the favoured pattern over an in-browser token.

### 4.6 Security headers

Send the following headers on **every** response — both static-file responses (HTML, JS, CSS, manifest, icons under `--gui`) and JSON API responses (§5). Uniform application is the chosen behaviour as of `bsky-saves` 0.5.0; the headers are cheap on JSON responses and harmless duplication is preferable to a path-based selection that could miss a route.

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https: http://127.0.0.1:* http://localhost:*; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
Cross-Origin-Opener-Policy: same-origin
```

Notes:

- The CSP largely matches what the GUI sets via `<meta>` already (in `index.html`), with `frame-ancestors 'none'` added. That directive can only be set via header, not meta, and is one of the wins of the daemon-served path over the GitHub-Pages-hosted path.
- `'wasm-unsafe-eval'` is required because Pyodide compiles WebAssembly. Don't tighten this — it'll break image backup when the GUI falls back to Pyodide.
- `connect-src https:` is required so the GUI can reach arbitrary Bluesky PDS hosts (Bluesky is federated). `connect-src 'self'` is too tight.
- `X-Content-Type-Options: nosniff` on JSON responses prevents MIME-sniffing fallbacks; particularly important if any consumer ever feeds an API response into a context that respects the sniffed type.

### 4.7 Security rationale

These rules mitigate three concrete attacks:

- **DNS rebinding.** A user visits `evil.com`. The page's JS waits; DNS for `evil.com` re-resolves to `127.0.0.1`; same-origin policy now lets `evil.com` script the daemon. Defences: localhost-only bind (the attacker can't reach the daemon from another host), Host-header validation (rebound request has `Host: evil.com`, gets `421`), Origin allowlist (rebound request has `Origin: https://evil.com`, gets `403`).
- **Compromised hosted PWA driving every helper.** If `saves.lightseed.net` is XSS'd or its dependency tree is compromised, the attacker has scripted access to the GUI's origin. The Origin allowlist *does* admit that origin (by design — that's the legitimate hosted GUI), so the defence here is **the daemon's read-only API surface**. The current endpoints (`/ping`, `/fetch-image`, `/extract-article`, `/fetch`, `/enrich`, `/hydrate-threads`) are all read-only: they fetch data from upstream and return it. None mutate user state on the server side. A compromised hosted GUI calling `/fetch` against your daemon learns nothing it couldn't learn by asking you for your bookmarks directly. **If destructive endpoints (`/saves/delete`, `/run` with side effects, etc.) are added later, they MUST require an out-of-band user confirmation** (terminal prompt, system tray pop-up, or similar) — not just trust the GUI to ask. Until then, the read-only-surface property carries the load.
- **Clickjacking of the local-mode GUI.** `X-Frame-Options: DENY` plus `frame-ancestors 'none'` prevents any other origin from embedding the local GUI in an iframe and tricking the user into clicking through a transparent overlay.

---

## 5. HTTP API endpoint contract

The daemon exposes six endpoints. All paths are flat (no `/api/` prefix). All responses are JSON except where noted.

> **Reconciliation note.** The workstream doc proposed an `/api/` prefix, `/api/version`, `/api/health`, and a `/api/v1/...` versioning scheme. The shipping design (per the `serve` requirements docs) uses flat paths and folds health + version + capability into a single `/ping` endpoint. This spec follows the shipping design.

### 5.1 `GET /ping`

Health check, version reporting, and capability advertisement, combined. The GUI calls this on startup to detect a running helper and to feature-flag its routing.

**Origin enforcement applies** — same rule as every other endpoint (§4.4). A request from a non-allowlisted origin gets 403; a request with no `Origin` header (`curl`, scripts) is permitted. The GUI never probes `/ping` from a non-allowlisted origin in practice (the loopback origin and `saves.lightseed.net` are both default-allowlisted), so this isn't a behavioural regression — it just removes a special case from your routing table.

**Response** (200, `application/json`):

```json
{
  "name": "bsky-saves",
  "version": "0.5.1",
  "features": ["fetch-image", "extract-article", "fetch", "enrich", "hydrate-threads", "jwt-credentials"]
}
```

- `name` — exactly `"bsky-saves"`. The GUI's `probeHelper()` requires this exact string to consider the daemon detected.
- `version` — matches `bsky_saves.__version__` (semver).
- `features` — strings naming the operations the daemon supports. The GUI feature-detects per-endpoint:
  - `"fetch-image"` — `/fetch-image` works.
  - `"extract-article"` — `/extract-article` works.
  - `"fetch"` — `/fetch` works (added in `bsky-saves` 0.4.0).
  - `"enrich"` — `/enrich` works (added in 0.4.0).
  - `"hydrate-threads"` — `/hydrate-threads` works (added in 0.4.0).
  - `"jwt-credentials"` — `/fetch` and `/hydrate-threads` accept the JWT-pair credential shape (added in 0.4.1).
  - Unknown future features are silently tolerated by the GUI.

### 5.2 `POST /fetch-image`

Fetch a single image URL on behalf of the GUI and stream the bytes back.

**Request body** (`application/json`):

```json
{ "url": "https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:.../bafkrei..." }
```

**URL allowlist (hardcoded).** Only `https://cdn.bsky.app/...` and `https://*.bsky.app/...` are permitted. Any other URL returns `400 {"error":"url not allowed"}`. Not configurable. Rationale: the daemon is reachable from any local browser tab; the URL allowlist is the only thing stopping a malicious page from using it as an open image proxy for arbitrary destinations.

**Response** (200, `image/*`): the upstream image bytes. `Content-Type` echoes the upstream response (e.g. `image/jpeg`, `image/png`). `Content-Length` set if known.

**On upstream failure**: the upstream status code is propagated. Body: `{"error":"upstream <code>"}`. Network errors → 502.

**Timeout**: 30 seconds per image, hard cap.

### 5.3 `POST /extract-article`

Fetch an article URL and run `trafilatura`-based extraction. Returns extracted text + metadata.

**Request body** (`application/json`):

```json
{ "url": "https://example.com/some-article" }
```

**URL allowlist**: any `http://` or `https://` URL. Articles are user-saved Bluesky-linked URLs; the URL space is the open web by definition. The Origin allowlist (§4.4), not a URL allowlist, is the protective layer here.

**SSRF guard** (added in `bsky-saves` 0.4.4). Independent of the open-web URL allowlist, the daemon rejects URLs whose hostname is an IP literal in a private (RFC 1918), loopback (`127.0.0.0/8`, `::1`), link-local (`169.254.0.0/16`, `fe80::/10`), CGNAT (`100.64.0.0/10`), multicast, or otherwise reserved range. The guard also rejects:

- Hostnames that resolve via DNS to any address in those ranges.
- The cloud-metadata IP `169.254.169.254` (AWS / GCP / Azure / DigitalOcean instance metadata endpoint).
- `localhost` and `localhost.*` aliases.
- IPv4-mapped IPv6 forms (e.g. `::ffff:192.168.1.1`) of any of the above.

Rejected URLs return **`400 {"error":"url not allowed"}`** — same shape as `/fetch-image`'s URL allowlist failure. From the GUI's perspective, both rejections are interchangeable: the helper refused, surface the failure to the user.

**Response** (200, `application/json`):

```json
{
  "url": "https://example.com/some-article",
  "title": "Article title",
  "text": "Extracted body text…",
  "fetched_at": "2026-05-03T12:34:56Z"
}
```

If extraction succeeds but no body text is found (paywall, JS-rendered, login wall): 200 with `text: ""` and a `note: "no extractable body"` field. The GUI treats this as "fetched but empty," not an error.

If the upstream fetch fails: upstream status (or 502 on network error), body `{"error":"<message>"}`.

**Timeout**: 60 seconds.

### 5.4 `POST /fetch`

Enumerate the signed-in user's bookmarked posts. Added in `bsky-saves` 0.4.0.

**Request body** (`application/json`):

Two accepted credential shapes, detected by which fields are present.

App-password shape (0.4.0+):

```json
{
  "credentials": {
    "handle": "alice.bsky.social",
    "app_password": "xxxx-xxxx-xxxx-xxxx",
    "pds": "https://bsky.social"
  },
  "cursor": null,
  "limit": 100
}
```

JWT-pair shape (0.4.1+, for clients that already hold a session):

```json
{
  "credentials": {
    "access_jwt": "...",
    "refresh_jwt": "...",
    "did": "did:plc:...",
    "pds": "https://bsky.social"
  },
  "cursor": null,
  "limit": 100
}
```

- `pds` is optional and defaults to `https://bsky.social`.
- `cursor` is opaque, optional, omit / `null` for the first page.
- `limit` is optional, default 100, max 100.
- If neither `app_password` nor `access_jwt` is present: `400 {"error":"missing credentials"}`.

**Response** (200, `application/json`):

```json
{
  "saves": [
    {
      "uri": "at://did:plc:.../app.bsky.feed.post/...",
      "saved_at": "2026-05-05T20:41:52.913Z",
      "author": {
        "did": "did:plc:...",
        "handle": "alice.bsky.social",
        "display_name": "Alice"
      },
      "post_text": "Hello world",
      "embed": null,
      "images": [
        { "kind": "image", "url": "https://...", "thumb": "https://...", "alt": "..." }
      ],
      "quoted_post": null
    }
  ],
  "cursor": "opaque-string-or-null"
}
```

Field notes:

- `embed` is normalised: `null` if absent; `{type, url, title, description}` for external link embeds. Quoted-post and image embeds are folded into `quoted_post` / `images` respectively.
- `images`: `[]` if none; otherwise an array of `{kind, url, thumb, alt}`. `kind` is `"image"` for native attachments and `"embed_thumb"` for external-link thumbnails.
- `quoted_post`: `null` or a nested record with the same snake_case shape (`{uri, cid, author, text, created_at, images, thread_replies}`).
- `post_created_at` is **not** populated here — added by `/enrich`.
- `thread_replies` / `thread_schema_version` / `thread_fetched_at` are **not** populated here — added by `/hydrate-threads`.
- `cursor` is an opaque pagination token; `null` when there are no more pages. The GUI **MUST** treat it as fully opaque and round-trip it byte-for-byte.

**Rotated credentials** (JWT-pair path only): when the daemon refreshes a session mid-request (because `access_jwt` expired), the response includes:

```json
{
  "rotated_credentials": {
    "access_jwt": "<new>",
    "refresh_jwt": "<new>",
    "did": "did:plc:..."
  }
}
```

When present, the GUI **MUST** persist the new pair synchronously before issuing the next request — AT Protocol invalidates the old `refresh_jwt` once it's been used to mint a new one, so async persistence risks losing the rotation. Absent on responses that didn't trigger a refresh, and never present under the app-password path.

**GUI-side obligations** (JWT-pair path):

- Persist `rotated_credentials` synchronously.
- Serialise `/fetch` calls per session — two concurrent calls can both trigger refresh; one will lose the race and fail.

**Errors**:

- `400 {"error":"missing credentials"}`
- `400 {"error":"invalid cursor"}` — cursor decode failure; GUI retries with `cursor: null`.
- `401 {"error":"createSession failed: <message>"}` — app-password path, bad credentials.
- `401 {"error":"auth refresh failed", "code":"refresh_failed"|"upstream_rejected_after_refresh"}` — JWT-pair path, expired session can't be recovered. The `code` field is informational; GUI treats both values identically (re-prompt for app password).
- `5xx {"error":"..."}`

**Timeout**: 30 seconds per page.

**Cursor encoding** (daemon-internal; GUI must NOT inspect): the cursor is `urlsafe-base64(JSON({v, endpoint, upstream}))` so the daemon stays stateless across paginated calls while remembering which bookmark-endpoint probe succeeded. Credentials are NEVER encoded in the cursor — cursors can land in logs or diagnostic surfaces; auth never leaves the request body.

### 5.5 `POST /enrich`

Decode `post_created_at` from each URI's record-key TID. Pure offline operation — no network, no auth. Added in `bsky-saves` 0.4.0.

**Request body** (`application/json`):

```json
{ "uris": ["at://did:plc:.../app.bsky.feed.post/...", "..."] }
```

No `credentials` field. Enrich is offline-only.

**Response** (200, `application/json`):

```json
{
  "enriched": [
    { "uri": "at://did:plc:.../app.bsky.feed.post/...", "post_created_at": "2026-05-05T16:28:04Z" }
  ],
  "errors": [
    { "uri": "at://...", "reason": "invalid at-uri" }
  ]
}
```

- `enriched` is a sparse delta: only the fields enrichment populates. The GUI merges these into the existing save records by `uri`.
- Today, exactly one field: `post_created_at`. Most of what users might think of as "enrichment" (display name, embeds, images) is already populated by `/fetch`.
- Malformed at-URIs go into `errors`, not the top-level error.

**Errors**:

- `400 {"error":"missing uris"}`
- `5xx {"error":"..."}`

**Timeout**: sub-second. Pure string parsing.

### 5.6 `POST /hydrate-threads`

For each given URI, walk the reply tree to collect same-author follow-up replies (the "self-thread" pattern). Added in `bsky-saves` 0.4.0.

**Request body** (`application/json`): same two credential shapes as `/fetch` (app-password or JWT-pair), plus `uris`:

```json
{
  "uris": ["at://...", "..."],
  "credentials": {
    "handle": "alice.bsky.social",
    "app_password": "xxxx-xxxx-xxxx-xxxx",
    "pds": "https://bsky.social"
  }
}
```

**Credential use**: under the app-password path, the daemon validates with `createSession`, then discards the JWT and reads threads anonymously from the public AppView (`public.api.bsky.app`). Under the JWT-pair path, the daemon does not use the JWT at all — the endpoint's upstream calls are all anonymous. Credentials function as a gate, not as authentication for the upstream call.

**Response** (200, `application/json`):

```json
{
  "threaded": [
    {
      "uri": "at://...",
      "thread_replies": [
        {
          "uri": "at://...",
          "text": "...",
          "indexedAt": "2026-05-05T...Z",
          "images": [],
          "created_at": "2026-05-05T...Z"
        }
      ],
      "thread_schema_version": 4,
      "thread_fetched_at": "2026-05-06T...Z"
    }
  ],
  "errors": [
    { "uri": "at://...", "reason": "thread fetch failed" }
  ]
}
```

- `thread_schema_version` reflects the version the daemon used. Current value: `4` (after the 0.3.1 fix that scoped same-author traversal to unbroken chains).
- `rotated_credentials` never appears on this endpoint — no upstream call that could trigger refresh.

**Errors**: same shape as `/enrich`.

**Timeout**: 300 seconds. Thread walks can fan out across hundreds of `getPostThread` calls.

**Batching**: callers SHOULD batch as many URIs per request as they have on hand (up to a few hundred). The daemon performs one `createSession` per request under the app-password path, and Bluesky rate-limits `createSession` aggressively, so chatty calling patterns can hit per-account limits.

> **Note: HTTP path vs. Python-function path.** This is the HTTP endpoint contract. The `bsky-saves` Python package also exposes a `bsky_saves.threads.hydrate_threads()` function used by the CLI and by Pyodide consumers that import the package directly. As of `bsky-saves` 0.4.3, that *Python function* gained an optional `limit` kwarg for bounded-batch processing — it has no analogue on the HTTP endpoint and is irrelevant to clients of `/hydrate-threads`. If the GUI's Pyodide worker calls `hydrate_threads(...)` directly (not via HTTP), see the `bsky-saves` Python API docs for `limit` semantics; it's recommended for large inventories to keep the worker from blocking on a single call.

### 5.7 CORS

Applies to every endpoint. Requests from allowlisted origins (see §4.4):

- `Access-Control-Allow-Origin` echoes the request's `Origin` header; never `*`.
- `Access-Control-Allow-Methods: GET, POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`
- Preflight `OPTIONS` from an allowed origin returns 204 with the same headers and no body.
- `Access-Control-Max-Age: 600`

Requests from non-allowlisted origins — including preflight `OPTIONS` — return 403 per §4.4; no CORS headers are echoed.

### 5.8 Reserved paths

- Unknown API paths (anything that looks like a documented endpoint but isn't one) return `404 {"error":"not found"}`.
- The daemon must not serve files from outside `_gui/` (when under `--gui`) and must not expose any debugging surface (`/__debug__`, `/api`, `/console`, etc.).
- SPA fallback (§4.1) only applies to paths that don't collide with any documented API endpoint.

### 5.9 Capability versioning

- The `/ping` `version` field is the public compatibility marker; the GUI's `MIN_HELPER_VERSION` constant (in `app/src/lib/min-helper-version.ts`) is the floor below which the GUI shows `OutdatedHelperBanner` and refuses to enter local mode.
- **Current value: `MIN_HELPER_VERSION = '0.4.1'`.** PyPI's current `bsky-saves` is `0.5.1` (cleanup release on top of `0.5.0`, which was the first wheel to ship the `--gui` flag + bundled GUI serving — i.e. the milestone release where the bsky-saves side implements §3 and §4 of this spec). Comfortably above the GUI floor; `OutdatedHelperBanner` does not render. Bumping `MIN_HELPER_VERSION` is a forward-looking GUI-side change tied to specific feature requirements (e.g. the v0.4.1 bump was driven by needing `"jwt-credentials"`); the bsky-saves team is not blocked on it for any work in this spec.
- New endpoints land as additions to `features`. The GUI feature-detects per-capability rather than version-gating wholesale, so an old GUI talking to a new daemon works for the subset it knows about.
- Removing or renaming endpoints is a breaking change and must bump the `bsky-saves` major version.

---

## 6. Release-process requirements

### 6.1 Changelog

Each wheel release's changelog notes the bundled `GUI_VERSION`. A bump to `GUI_VERSION` without a corresponding wheel release is fine; the next wheel release picks it up automatically.

### 6.2 PyPI publishing

Use PyPI Trusted Publishers (OIDC), not long-lived API tokens.

### 6.3 Pre-release smoke test in CI

Run before publishing. Steps:

1. Build the wheel (which runs the fetch hook from §3.2).
2. Install the wheel in a fresh venv.
3. Start `bsky-saves serve --gui --port 0` (or another ephemeral port) in the background.
4. `curl -fsS http://127.0.0.1:<port>/` → returns the bundled `index.html` (`grep -q '<title>'`).
5. `curl -fsS http://127.0.0.1:<port>/ping` → returns JSON with `name == "bsky-saves"` and a non-empty `features` array.
6. `curl -fsS http://127.0.0.1:<port>/assets/<first-hashed-asset>` → returns 200.
7. `curl -fsS -X POST http://127.0.0.1:<port>/fetch-image -H 'Content-Type: application/json' -d '{"url":"https://evil.com/x.png"}'` → returns `400 {"error":"url not allowed"}`.
8. Shut down the daemon.

Failure of any step blocks the release.

### 6.4 Cross-repo release coordination

For the MVP cut and for any future `MIN_HELPER_VERSION` bumps, the published sequence is **`bsky-saves` ships first, GUI bumps `MIN_HELPER_VERSION` after**.

- The bsky-saves team cuts the wheel that introduces a new capability.
- The wheel reaches PyPI.
- The GUI team observes the wheel works and opens a one-line PR raising `MIN_HELPER_VERSION` in `app/src/lib/min-helper-version.ts`.
- The GUI tag picks up the bump on the next release.

This sequencing avoids the "GUI ships first, users see `OutdatedHelperBanner` against a still-current wheel" scenario. It does mean wheels can ship features the GUI doesn't yet require — that's harmless; the GUI feature-detects per-capability via the `features` array (§5.1) and just doesn't use what it doesn't know about.

Lockstep releases are not required and are not the published policy — too costly to coordinate. If a specific future feature genuinely needs lockstep, treat it as the exception and call it out in the issue/PR.

### 6.5 GUI release readiness — `v0.5.2` released

The GUI release-CI workflow (`bsky-saves-gui/.github/workflows/release.yml`) has been live on `main` since PR #7 and was first exercised on a real `v*` tag with **`v0.5.2`, released 2026-05-12**. Workflow run completed cleanly; all expected artifacts attached to the release entry at <https://github.com/tenorune/bsky-saves-gui/releases/tag/v0.5.2>:

| Asset | Purpose | Size at v0.5.2 |
|---|---|---|
| `dist.tar.gz` | Production bundle (sourcemaps stripped). The wheel consumes this. | 273 KB |
| `dist.tar.gz.sha256` | Checksum file. **Copy this byte-for-byte into the bsky-saves repo's `gui-dist.sha256` when bumping `GUI_VERSION`.** | 78 B |
| `dist-with-maps.tar.gz` | Debug bundle with sourcemaps. **Not consumed by the wheel.** Useful only when the GUI team needs to debug a deployed bundle. | 734 KB |
| `SBOM.cdx.json` | CycloneDX SBOM of production deps. Optional audit artifact; not required at build time. | 28 KB |

The bsky-saves fetch hook (§3.2) should pin against:

```
https://github.com/tenorune/bsky-saves-gui/releases/download/v{GUI_VERSION}/dist.tar.gz
https://github.com/tenorune/bsky-saves-gui/releases/download/v{GUI_VERSION}/dist.tar.gz.sha256
```

**Initial pin: `GUI_VERSION=v0.5.2`.**

Future releases follow the same URL pattern automatically. The release-CI workflow fires on every `v*` tag push; if the GUI team ever needs to exercise the workflow without cutting a real release (e.g. while testing a workflow change), they use `workflow_dispatch` from the Actions tab — that path uploads artifacts to the workflow run only, no release entry, so it doesn't pollute the release page or trigger downstream consumers.

---

## 7. Non-goals for MVP

- **Authenticated endpoints** (sessions, JWT outside the AT Protocol credential shape, shared secrets). The daemon is unauthenticated within its origin allowlist; see §4.5.
- **Auto-update of the wheel.** Users `pipx upgrade bsky-saves`.
- **Mutual TLS or hardware-attested pairing** between the hosted PWA and the local daemon. Origin allowlist on HTTP-on-localhost is sufficient for MVP.
- **Tier 2/3 installers** (frozen binaries, OS-native installers). Once the wheel reliably ships with a vendored GUI, that's a separate workstream.
- **Sigstore/cosign signing of the GUI tarball.** Stretch goal once SHA-256 pinning is in place.
- **Configurable URL allowlist for `/fetch-image`.** Hardcoded to bsky.app domains.
- **Streaming responses** (SSE, chunked JSON). Single request / single response in v1.
- **System tray / autostart integration.** CLI command only.
- **`POST /run`** (the v1-spec's Phase 2 one-shot endpoint). Planned, but out of scope here.
- **Pre-allowlisting Vite dev server origins** (e.g. `http://localhost:5173`). Developers running both `vite dev` and `bsky-saves serve --gui` simultaneously pass `--allow-origin` ad-hoc. The daemon's defaults target end-users, not the GUI team's dev loop.
- **Supporting non-HTTPS PDS hosts.** The GUI's CSP `connect-src` admits `https:` broadly to cover the federated AT Protocol PDS space, but not `http:` (other than the loopback helper). Users with a non-HTTPS PDS (e.g. a LAN dev PDS) either configure HTTPS on their PDS (recommended) or build a custom GUI with a relaxed CSP. Mainstream support is HTTPS-only.

---

## 8. Acceptance criteria

The GUI team considers this work done when all of the following hold against the next published wheel:

1. `pip install bsky-saves` followed by `bsky-saves serve --gui` mounts the GUI at `http://127.0.0.1:47826/`.
2. The page renders, the manifest validates, and `GET /ping` returns `{name: "bsky-saves", version: "<X.Y.Z>", features: [...]}` with at least `["fetch-image", "extract-article"]` in `features`.
3. The GUI's `probeHelper()` resolves on the served origin (i.e. the helper appears in the GUI's `detectBackends()` output).
4. `OutdatedHelperBanner` does **not** render against the current wheel — i.e. the wheel's `version` is `>= MIN_HELPER_VERSION` in the GUI.
5. A cross-origin request from `evil.com` to `http://127.0.0.1:47826/fetch-image` is blocked (Origin check returns `403` or CORS preflight rejects the actual request).
6. A request with `Host: evil.com` (DNS-rebinding simulation) returns `421`.
7. `POST /fetch-image` with `{"url":"https://evil.com/x.png"}` returns `400 {"error":"url not allowed"}`.
8. Build-hook CI failure on a deliberately corrupted `dist.tar.gz.sha256` pin.

When these eight pass, the GUI team can wire up the deferred runtime-smoke and version-coordination gates in the GUI's release workflow against the real wheel (currently stubbed pending this work).

---

## 9. Glossary

- **GUI bundle / `dist.tar.gz`** — the static Svelte build attached to each `bsky-saves-gui` release. ~270 KB.
- **Daemon / helper / `bsky-saves serve`** — long-running localhost Python process exposing the HTTP API; with `--gui`, also mounts the GUI bundle.
- **`saves.lightseed.net`** — the operator's hosted PWA deploy. Same bundle as the wheel ships.
- **`GUI_VERSION`** — the tag of `bsky-saves-gui` the current wheel is built against. Pinned in `bsky-saves`'s source.
- **`MIN_HELPER_VERSION`** — the minimum daemon version the GUI requires to enter local mode. Defined in `bsky-saves-gui/app/src/lib/min-helper-version.ts`.
- **Capability resolution** — runtime probing via `/ping`'s `features` array; the same JS bundle behaves correctly with or without a daemon present and with whatever subset of features the daemon advertises.
- **Origin allowlist** — the set of HTTP `Origin` headers the daemon will accept on API routes. The full auth layer.
- **App-password path** — credentials shape `{handle, app_password, pds?}`; daemon does its own `createSession`.
- **JWT-pair path** — credentials shape `{access_jwt, refresh_jwt, did, pds?}`; daemon reuses an existing session and may rotate it.
- **Rotated credentials** — new JWT pair the daemon returns when it refreshes a session mid-request. MUST be persisted synchronously by the GUI.

---

## 10. Cross-references

The following GUI-repo docs informed this spec; share them alongside if the bsky-saves team wants the underlying source material:

- `docs/bsky-saves-gui-dist-workstream.md` — multi-repo workstream doc. Section 4 is the origin of the GUI-vendoring + `--gui`-serving requirements (§3, §4 here). The doc's threat catalogue (R1–R7) informs the security rationale here; only R1, R2, and R3 directly drove requirements in this spec.
- `docs/bsky-saves-serve-requirements.md` — v1 `serve` API. Inlined into §5.1–§5.3 (`/ping`, `/fetch-image`, `/extract-article`) and §5.7 (CORS). Authoritative for any disputed detail in those endpoints.
- `docs/bsky-saves-serve-fetch-enrich-threads-requirements.md` — v0.4 expansion. Inlined into §5.4–§5.6 (`/fetch`, `/enrich`, `/hydrate-threads`). Authoritative for cursor encoding, credential paths, rotated-credentials semantics, and capability advertisement.
- `app/src/lib/helper-client.ts` — the GUI-side client for the HTTP API. Read this to see exactly what the GUI sends and expects.
- `app/src/lib/min-helper-version.ts` — the current minimum daemon version the GUI accepts.

**If anything in this spec contradicts the source docs above, the source docs are authoritative — file a GUI-side issue and this spec gets updated.**

# `bsky-saves serve` — enrich + hydrate-threads endpoints

> Extends the v1 spec at `bsky-saves-serve-requirements.md`. That spec covers `/ping`, `/fetch-image`, `/extract-article`. This doc adds `/enrich` and `/hydrate-threads` so the GUI can route those operations through a local helper instead of Pyodide.

## Goal

Let the GUI offload **enrichment** and **thread hydration** to a running `bsky-saves serve` daemon, the same way it already offloads image and article hydration. Users with the helper installed get faster, less crash-prone enrichment and thread walks; users without the helper continue to fall back to Pyodide.

## Background

Today the GUI does the following operations via Pyodide (in-browser Python):

- **`fetch`** — list a user's bookmarks via the Bluesky API.
- **`enrich`** — for each bookmark, fetch full author profile, embed metadata, quoted-post bodies.
- **`hydrate threads`** — for each bookmark, walk the reply tree to collect same-author follow-up replies (the "self-thread" pattern).

It does these via the helper / cf-worker:

- **`hydrate images`** — `POST /fetch-image`.
- **`hydrate articles`** — `POST /extract-article`.

Pyodide works but has real costs:

- Cold start downloads ~10 MB of WASM and re-installs `bsky-saves` via micropip on every browser session.
- `bsky-saves` updates require bumping a hard-coded version in the GUI source.
- Long-running operations (thread walks across hundreds of posts) tie up a Web Worker for minutes.
- The `httpx`-via-pyodide-http shim is fragile across `bsky-saves` releases.

If the helper is installed, all five operations could go through it. The helper is already a Python process with `bsky-saves` linked; it has direct access to `httpx` and can pipeline Bluesky API calls without a WASM tax.

## Requirements

### 1. `POST /enrich`

**Request body** (`application/json`):

```json
{
  "uris": ["at://did:plc:.../app.bsky.feed.post/...", "..."],
  "credentials": {
    "handle": "alice.bsky.social",
    "app_password": "xxxx-xxxx-xxxx-xxxx",
    "pds": "https://bsky.social"
  }
}
```

- `uris` — at-URIs to enrich. The helper looks up the corresponding `app.bsky.feed.getPosts` records (or `app.bsky.feed.getPostThread` if richer data is needed) and returns enriched bodies.
- `credentials` — required; the daemon does its own `com.atproto.server.createSession` once per call. Credentials are not persisted to disk.

**Response** (`200 application/json`):

```json
{
  "enriched": [
    {
      "uri": "at://...",
      "cid": "...",
      "author": { "did": "...", "handle": "...", "displayName": "..." },
      "record": { "text": "...", "createdAt": "..." },
      "embed": { "...optional embed details..." },
      "quoted_post": { "...if applicable..." },
      "thread_replies": null
    },
    "..."
  ],
  "errors": [
    { "uri": "at://...", "reason": "post not found" }
  ]
}
```

- Each entry in `enriched` mirrors the shape `bsky-saves` already produces in its CLI inventory (top-level fields like `author`, `record`, `embed`, `quoted_post`).
- Posts that failed to enrich appear in `errors` rather than `enriched`. This lets the caller fall back per-post without losing the rest of the batch.
- `thread_replies` is always `null` here. Threads are a separate endpoint (`/hydrate-threads`).

**Errors**:

- `400` `{"error":"missing credentials"}` — required field absent.
- `401` `{"error":"createSession failed: <message>"}` — Bluesky rejected the credentials.
- `5xx` `{"error":"..."}` — daemon-internal failure.

**Timeout**: 120 seconds per call. The daemon should batch upstream `app.bsky.feed.getPosts` calls (50 URIs at a time) to keep wall-clock low.

### 2. `POST /hydrate-threads`

**Request body** (`application/json`):

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

**Response** (`200 application/json`):

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

- `thread_replies` follows the same shape `bsky-saves hydrate threads` already writes to inventory JSON. The shape is owned by the `bsky-saves` repo; this endpoint just exposes it over HTTP.
- `thread_schema_version` reflects the version the daemon used. Today's value is `4` (after the 0.3.1 fix that scoped same-author traversal to unbroken chains).
- Posts whose thread fetch failed appear in `errors`.

**Errors**: same shape as `/enrich`.

**Timeout**: 300 seconds. Thread walks fan out across hundreds of `getPostThread` calls and can be slow on large posts.

### 3. Capability advertisement

Both new endpoints are advertised via:

- The existing **`/ping`** `features` array — gains `"enrich"` and `"hydrate-threads"` entries when the daemon supports them.
- The mirrored **`/capabilities`** endpoint (proposed in the distribution-requirements doc) — gains `/enrich` and `/hydrate-threads` entries.

Older daemons (pre-0.4) won't advertise these; the GUI feature-detects and falls back to Pyodide for any feature missing from the helper.

### 4. Authentication handling

- Credentials arrive in the request body. The daemon validates them by calling `com.atproto.server.createSession` and caches the resulting access JWT for the duration of the request. **The cache is in-memory and per-request; no persistence to disk, no shared cache across requests.**
- If the GUI calls `/enrich` and `/hydrate-threads` back-to-back, each call performs its own `createSession`. Acceptable: createSession is fast, and avoiding shared state simplifies the threat model.
- The daemon never logs credentials, never echoes them in error responses.
- If a request omits `credentials`, return `400 {"error":"missing credentials"}` rather than attempting an anonymous read (the Bluesky API requires auth for these endpoints anyway).

### 5. Progress reporting

For v1 of these endpoints, **no streaming**. A single request, a single response. Acceptance:

- The GUI shows a busy spinner. If the daemon takes > 60 s, that's fine.
- Future revisions could stream partial results via SSE or chunked JSON, but only if the GUI gains a use for it. Don't over-design now.

### 6. Concurrency

Each endpoint may be called concurrently. The daemon must not serialize requests behind a single lock — that would make the GUI feel sluggish. `bsky-saves`'s existing async-httpx code is the right base.

### 7. Origin allowlist + bind

Same rules as the v1 endpoints:

- Bind to `127.0.0.1` only.
- Apply the configured `--allow-origin` list. Reject browsers from other origins with the same `403 {"error":"Origin not allowed"}` shape.

### 8. Backwards compatibility

- The new endpoints are **additive**. Old GUIs (which only know `/fetch-image` and `/extract-article`) continue to work against new daemons.
- The new GUI features (routing enrich/threads through the helper) gate on the `features` array — they only kick in when the daemon advertises support.
- Inventory shape produced by `/enrich` and `/hydrate-threads` matches what `bsky-saves` writes when run as a CLI. The GUI's existing `parseInventory` accepts both.

## Why these two endpoints, in this order

`enrich` and `hydrate-threads` are the two operations that **today require Pyodide**. Adding them to `serve` lets a helper-equipped user opt out of Pyodide entirely. `fetch` itself (enumerating bookmarks via `app.bsky.feed.getActorLikes` and friends) is in scope for a follow-up — it's only run on first sign-in and on explicit "Update library" clicks, so the Pyodide cost there is amortized over many later operations.

The eventual end state is the v1 spec's Phase 2 `POST /run` — a one-shot endpoint that does fetch + enrich + threads + image hydration + article extraction in a single round trip. `/enrich` and `/hydrate-threads` are the partial step toward that: they're independently useful (the GUI can call them when the user re-runs threads or refreshes enrichment) and they de-risk `/run` by proving the auth-handling pattern.

## Out of scope

- **`POST /fetch`** — bookmark enumeration. Deferred to a follow-up; Pyodide's cost there is one-time per session.
- **Streaming responses** — single request / single response in v1.
- **Configurable batch size** — the daemon picks sensible defaults (50 for getPosts, etc.). No flags.
- **Disk caching of `getPostThread` responses** — the daemon is stateless. The GUI persists what it needs.
- **OAuth-style flow** — credentials are app-passwords for now, matching what `bsky-saves` CLI accepts. OAuth migration tracked separately in the broader Bluesky ecosystem.

## Acceptance criteria

A `bsky-saves` release that closes this can be characterized by:

- `/ping` returns `{"features": ["fetch-image", "extract-article", "enrich", "hydrate-threads"]}` (order doesn't matter).
- `POST /enrich` with 50 valid URIs + valid credentials returns 50 entries in `enriched`, in the same order, within 30 s on a typical residential connection.
- `POST /hydrate-threads` with 100 valid URIs + valid credentials returns 100 entries in `threaded` within 60 s.
- Both endpoints reject calls with `Origin: https://attacker.example` even when credentials are valid.
- Both endpoints reject calls without `credentials`.
- The GUI's `min-helper-version.ts` floor can be bumped to whatever version first ships these (likely `0.4.0`); the GUI will display "outdated, please upgrade to 0.4.0+" for older installs that lack these features.

## GUI side (already prepared)

- The helper-client module probes `/ping` and exposes `features`. Adding `enrich`/`hydrate-threads` consumers is purely additive.
- The Pyodide path stays as fallback. The GUI's enrich/threads code already has an injectable fetcher (see `image-hydrator`, `article-hydrator` for the pattern) — wiring a helper-backed enrich / threads runner alongside the Pyodide one is straightforward.
- `MIN_HELPER_VERSION` will bump to `0.4.0` (or whatever release first ships these endpoints) once available, with a concrete upgrade prompt visible in Settings → Backup.

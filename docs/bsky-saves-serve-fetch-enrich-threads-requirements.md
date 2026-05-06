# `bsky-saves serve` — fetch + enrich + hydrate-threads endpoints

> Extends the v1 spec at `bsky-saves-serve-requirements.md`. That spec covers `/ping`, `/fetch-image`, `/extract-article`. This doc adds `/fetch`, `/enrich`, and `/hydrate-threads` so the GUI can route those operations through a local helper instead of Pyodide.

## Goal

Let the GUI offload **bookmark enumeration**, **enrichment**, and **thread hydration** to a running `bsky-saves serve` daemon, the same way it already offloads image and article hydration. Together with the existing `/fetch-image` and `/extract-article` endpoints, this lets a helper-equipped user opt out of Pyodide entirely. Users without the helper continue to fall back to Pyodide.

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

### 1. `POST /fetch`

Enumerate the signed-in user's bookmarked posts (the same listing `bsky-saves fetch` produces from the CLI).

**Request body** (`application/json`):

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

- `credentials` — required. The daemon does its own `com.atproto.server.createSession` on each call.
- `cursor` — optional opaque pagination token returned by a previous call. Omit / `null` for the first page.
- `limit` — optional, default 100, max 100. Matches the underlying Bluesky API page size.

**Response** (`200 application/json`):

```json
{
  "saves": [
    {
      "uri": "at://did:plc:.../app.bsky.feed.post/...",
      "indexedAt": "2026-05-05T16:28:04.123Z",
      "saved_at": "2026-05-05T20:41:52.913Z"
    }
  ],
  "cursor": "opaque-string-or-null"
}
```

- `saves` is the page of bookmarks. Entries match what `bsky-saves fetch` writes to its inventory's `saves[]` array **before** enrichment — minimum fields the helper has at this stage (`uri`, `indexedAt`, `saved_at`). Whatever pre-enrichment fields `bsky-saves` populates today, this endpoint passes through.
- `saves` does **not** include `cid` (not currently captured by `bsky-saves`), `author`, `record`, `post_text`, `embed`, or `images`. Those come from `/enrich`.
- `cursor` is an opaque pagination token; `null` when there are no more pages.

**Errors**:

- `400 {"error":"missing credentials"}`.
- `401 {"error":"createSession failed: <message>"}`.
- `5xx {"error":"..."}`.

**Timeout**: 30 seconds per page.

### 2. `POST /enrich`

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
      "uri": "at://did:plc:.../app.bsky.feed.post/...",
      "author": {
        "did": "did:plc:...",
        "handle": "alice.bsky.social",
        "display_name": "Alice"
      },
      "post_text": "Hello world",
      "post_created_at": "2026-05-05T16:28:04Z",
      "indexedAt": "2026-05-05T16:28:04.123Z",
      "embed": {
        "type": "external",
        "url": "https://example.com/article",
        "title": "Article title",
        "description": "Article description"
      },
      "images": [
        { "kind": "image", "url": "https://...", "thumb": "https://...", "alt": "..." }
      ],
      "quoted_post": {
        "uri": "at://...",
        "cid": "...",
        "author": { "did": "...", "handle": "...", "display_name": "..." },
        "text": "...",
        "created_at": "...",
        "images": []
      }
    }
  ],
  "errors": [
    { "uri": "at://...", "reason": "post not found" }
  ]
}
```

- **The shape is owned by `bsky-saves`'s `normalise_record`, not by this spec.** Whatever the CLI's `bsky-saves fetch` + enrichment writes to its inventory JSON is what this endpoint emits, byte-for-byte. The example above reflects the current CLI output (snake_case `post_text`, `post_created_at`, `display_name`; flat top-level fields rather than nested `record.text` / `record.createdAt`; normalized `embed` with `type`/`url`/`title`/`description`; `images` array with `{kind, url, thumb, alt}`).
- `quoted_post` mirrors the same convention (snake_case `created_at`, `display_name`).
- The `record: {text, createdAt}` shape (the *raw* Bluesky API shape) is **not** what this endpoint returns. Callers that need the raw shape should call the Bluesky API directly.
- Fields the CLI doesn't currently populate (e.g., post `cid`) are not added by `serve` either. If `bsky-saves` later adds them, the endpoint inherits them automatically.
- Posts that failed to enrich appear in `errors` rather than `enriched`. This lets the caller fall back per-post without losing the rest of the batch.
- Threads are a separate endpoint (`/hydrate-threads`) — `enriched` entries do not include a `thread_replies` field.

**Errors**:

- `400` `{"error":"missing credentials"}` — required field absent.
- `401` `{"error":"createSession failed: <message>"}` — Bluesky rejected the credentials.
- `5xx` `{"error":"..."}` — daemon-internal failure.

**Timeout**: 120 seconds per call. The daemon should batch upstream `app.bsky.feed.getPosts` calls (50 URIs at a time) to keep wall-clock low.

### 3. `POST /hydrate-threads`

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

### 4. Capability advertisement

The new endpoints are advertised via:

- The existing **`/ping`** `features` array — gains `"fetch"`, `"enrich"`, and `"hydrate-threads"` entries when the daemon supports them.
- The mirrored **`/capabilities`** endpoint (proposed in the distribution-requirements doc) — gains `/fetch`, `/enrich`, and `/hydrate-threads` entries.

Older daemons (pre-0.4) won't advertise these; the GUI feature-detects per-endpoint and falls back to Pyodide for any feature missing from the helper. Mixed support is fine — a daemon that advertises `enrich` and `hydrate-threads` but not `fetch` will see those two operations routed through the helper while `fetch` stays on Pyodide.

### 5. Authentication handling

- Credentials arrive in the request body. The daemon validates them by calling `com.atproto.server.createSession` and caches the resulting access JWT for the duration of the request. **The cache is in-memory and per-request; no persistence to disk, no shared cache across requests.**
- If the GUI calls `/enrich` and `/hydrate-threads` back-to-back, each call performs its own `createSession`. Acceptable: createSession is fast, and avoiding shared state simplifies the threat model.
- The daemon never logs credentials, never echoes them in error responses.
- If a request omits `credentials`, return `400 {"error":"missing credentials"}` rather than attempting an anonymous read (the Bluesky API requires auth for these endpoints anyway).

### 6. Progress reporting

For v1 of these endpoints, **no streaming**. A single request, a single response. Acceptance:

- The GUI shows a busy spinner. If the daemon takes > 60 s, that's fine.
- Future revisions could stream partial results via SSE or chunked JSON, but only if the GUI gains a use for it. Don't over-design now.

### 7. Concurrency

Each endpoint may be called concurrently. The daemon must not serialize requests behind a single lock — that would make the GUI feel sluggish. `bsky-saves`'s existing async-httpx code is the right base.

### 8. Origin allowlist + bind

Same rules as the v1 endpoints:

- Bind to `127.0.0.1` only.
- Apply the configured `--allow-origin` list. Reject browsers from other origins with the same `403 {"error":"Origin not allowed"}` shape.

### 9. Backwards compatibility

- The new endpoints are **additive**. Old GUIs (which only know `/fetch-image` and `/extract-article`) continue to work against new daemons.
- The new GUI features (routing enrich/threads through the helper) gate on the `features` array — they only kick in when the daemon advertises support.
- Inventory shape produced by `/enrich` and `/hydrate-threads` matches what `bsky-saves` writes when run as a CLI. The GUI's existing `parseInventory` accepts both.

## Why these three endpoints together

`fetch`, `enrich`, and `hydrate-threads` are exactly the operations that **today require Pyodide**. Adding all three to `serve` lets a helper-equipped user opt out of Pyodide entirely — including the cold-start WASM download on every fresh sign-in, which is the most painful single step in the GUI's onboarding for users with the helper installed.

The eventual end state is the v1 spec's Phase 2 `POST /run` — a one-shot endpoint that does fetch + enrich + threads + image hydration + article extraction in a single round trip. The three granular endpoints in this doc are the partial step toward that: they're independently useful (the GUI can call them when the user re-runs threads, refreshes enrichment, or paginates through bookmarks) and they de-risk `/run` by proving the auth-handling, pagination, and inventory-shape patterns.

## Out of scope

- **Streaming responses** — single request / single response in v1.
- **Configurable batch size** — the daemon picks sensible defaults (50 for getPosts, etc.). No flags.
- **Disk caching of `getPostThread` responses** — the daemon is stateless. The GUI persists what it needs.
- **OAuth-style flow** — credentials are app-passwords for now, matching what `bsky-saves` CLI accepts. OAuth migration tracked separately in the broader Bluesky ecosystem.

## Acceptance criteria

A `bsky-saves` release that closes this can be characterized by:

- `/ping` returns `{"features": ["fetch-image", "extract-article", "fetch", "enrich", "hydrate-threads"]}` (order doesn't matter).
- `POST /fetch` paginates the signed-in user's bookmarks; the GUI can walk the cursor to enumerate the entire collection without invoking Pyodide.
- `POST /enrich` with 50 valid URIs + valid credentials returns 50 entries in `enriched`, in the same order, within 30 s on a typical residential connection.
- `POST /hydrate-threads` with 100 valid URIs + valid credentials returns 100 entries in `threaded` within 60 s.
- All three endpoints reject calls with `Origin: https://attacker.example` even when credentials are valid.
- All three endpoints reject calls without `credentials`.
- The GUI's `min-helper-version.ts` floor can be bumped to whatever version first ships these (likely `0.4.0`); the GUI will display "outdated, please upgrade to 0.4.0+" for older installs that lack these features.

## GUI side (already prepared)

- The helper-client module probes `/ping` and exposes `features`. Adding `enrich`/`hydrate-threads` consumers is purely additive.
- The Pyodide path stays as fallback. The GUI's enrich/threads code already has an injectable fetcher (see `image-hydrator`, `article-hydrator` for the pattern) — wiring a helper-backed enrich / threads runner alongside the Pyodide one is straightforward.
- `MIN_HELPER_VERSION` will bump to `0.4.0` (or whatever release first ships these endpoints) once available, with a concrete upgrade prompt visible in Settings → Backup.

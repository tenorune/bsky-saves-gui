# `bsky-saves serve` — fetch + enrich + hydrate-threads endpoints

> Extends the v1 spec at `bsky-saves-serve-requirements.md`. That spec covers `/ping`, `/fetch-image`, `/extract-article`. This doc adds `/fetch`, `/enrich`, and `/hydrate-threads` so the GUI can route those operations through a local helper instead of Pyodide.

## Goal

Let the GUI offload **bookmark enumeration**, **enrichment**, and **thread hydration** to a running `bsky-saves serve` daemon, the same way it already offloads image and article hydration. Together with the existing `/fetch-image` and `/extract-article` endpoints, this lets a helper-equipped user opt out of Pyodide entirely. Users without the helper continue to fall back to Pyodide.

## Background

Today the GUI does the following operations via Pyodide (in-browser Python):

- **`fetch`** — list a user's bookmarks via the Bluesky API.
- **`enrich`** — for each bookmark, decode `post_created_at` from the at-URI's record-key TID. Today this is a pure-function offline step; no network or auth.
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

- `credentials` — required. The daemon does its own `com.atproto.server.createSession` on each call. `pds` is optional and defaults to `https://bsky.social` when absent or empty (matches the `bsky-saves` CLI's default). `handle` and `app_password` are required.
- `cursor` — optional opaque pagination token returned by a previous call. Omit / `null` for the first page.
- `limit` — optional, default 100, max 100. Matches the underlying Bluesky API page size.

**Response** (`200 application/json`):

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

- `saves` is the page of bookmarks. Each entry matches what `bsky-saves fetch` writes to its inventory's `saves[]` array — including `author`, `post_text`, `embed`, `images`, and `quoted_post` when applicable. The Bluesky `getActorLikes` (or equivalent) endpoint returns enough data in a single round-trip that fetch already populates these.
- `embed` is normalized: `null` if absent, otherwise `{type, url, title, description}` for external links (other types — quoted-post-only, no media — are folded into `quoted_post` / `images`).
- `images` is normalized: `[]` if absent, otherwise `[{kind, url, thumb, alt}]`. `kind` is `image` for native attachments and `embed_thumb` for external link thumbnails.
- `quoted_post` is `null` if absent, otherwise a nested record with the same snake_case shape (`{uri, cid, author, text, created_at, images, thread_replies}`).
- Notable fields **not** yet populated at this stage: `post_created_at` (added by `/enrich`), `thread_replies` / `thread_schema_version` / `thread_fetched_at` (added by `/hydrate-threads`).
- `cid` of the post itself is not currently captured by `bsky-saves`; if upstream adds it, this endpoint inherits it.
- `cursor` is an opaque pagination token; `null` when there are no more pages.

**Cursor encoding (daemon-side detail; the GUI MUST treat the cursor as fully opaque):**

`bsky-saves`'s `probe_bookmark_endpoints` walks four candidate endpoints in fallback order (`pds:bookmark.getBookmarks` → `appview:bookmark.getBookmarks` → `appview:getActorBookmarks` → `pds:listRecords`) until one succeeds. We need to remember which one succeeded across paginated calls — otherwise we re-probe each page. The daemon stays stateless by encoding the choice **inside the cursor it returns**:

- The returned cursor is `urlsafe-base64(JSON({ v, endpoint, upstream }))` where:
  - `v` — schema version, integer, currently `1`. Future schema changes branch on this.
  - `endpoint` — the probe winner identifier (e.g., `"pds:bookmark.getBookmarks"`, `"appview:listRecords"`).
  - `upstream` — whatever cursor the chosen endpoint returned for next-page lookup.
- On request with `cursor: null`, the daemon runs the probe, fetches the first page, and emits a freshly-encoded cursor for page 2.
- On request with `cursor: "<wrapped>"`, the daemon decodes, **skips the probe**, and fetches directly using `endpoint` + `upstream`.
- **The GUI MUST round-trip the cursor byte-for-byte and never inspect it.** The format is the daemon's private contract; new versions may extend the JSON without GUI changes.
- **Credentials are NEVER encoded in the cursor.** Cursors can land in logs, browser history, or external diagnostic surfaces; auth never leaves the request body. Per-page `createSession` is the price (fast, ~200 ms; v1 spec already accepts this).
- **Failure fallback mid-pagination.** If the daemon decodes a cursor but the named endpoint returns a hard failure (4xx/5xx that isn't "no more results"), it re-runs `probe_bookmark_endpoints` **with no upstream cursor** (the four bookmark endpoints have incompatible cursor formats — e.g. `pds:listRecords` uses a record-key TID, `bookmark.getBookmarks` uses an opaque lexicon cursor — so cross-endpoint cursor reuse risks silently wrong pages). It then returns a cursor encoding the new endpoint. **This means a fallback restarts pagination from page 1 of the new endpoint**, so the GUI may receive entries it has already seen on this run; deduplicate by `uri` if downstream code can't tolerate that. This is invisible to the GUI in terms of error surface — it just sees a slight latency bump on that one page and a non-monotonic cursor chain.

**Errors**:

- `400 {"error":"missing credentials"}`.
- `400 {"error":"invalid cursor"}` — cursor failed to decode (corrupted, mangled by an intermediary, or signed by a daemon-version-incompatible schema). The GUI should retry with `cursor: null` to start a fresh session.
- `401 {"error":"createSession failed: <message>"}`.
- `5xx {"error":"..."}`.

**Timeout**: 30 seconds per page.

### 2. `POST /enrich`

**Request body** (`application/json`):

```json
{
  "uris": ["at://did:plc:.../app.bsky.feed.post/...", "..."]
}
```

- `uris` — at-URIs to enrich.
- **No `credentials` field.** Today's `bsky-saves enrich` is purely offline — it decodes `post_created_at` from each URI's record-key TID without making any network call. No `createSession`, no Bluesky API access. The endpoint inherits this; auth is not required.

**Response** (`200 application/json`):

```json
{
  "enriched": [
    {
      "uri": "at://did:plc:.../app.bsky.feed.post/...",
      "post_created_at": "2026-05-05T16:28:04Z"
    }
  ],
  "errors": [
    { "uri": "at://...", "reason": "invalid at-uri" }
  ]
}
```

- `enriched` is a **sparse delta**: per-URI, only the fields enrichment populates. The caller merges these into the full save records it already received from `/fetch` (keyed by `uri`).
- **Today, `bsky-saves enrich` populates exactly one top-level field: `post_created_at`** (the post's original creation timestamp, decoded offline from the rkey's TID). Most of what users might think of as "enrichment" — author display name, embed metadata, images, quoted post — is already returned by `/fetch`.
- If `bsky-saves` extends enrich in the future to populate fields that *do* require network or auth (refreshed `display_name`, `cid`, profile data), the request body's auth contract should be re-opened then. v1 `serve` mirrors today's offline-only behavior; revisiting credentials is appropriately a major-version concern, not v1 scope creep.
- The shape is owned by `bsky-saves`, not by this spec. The endpoint emits whatever the CLI's enrich step writes to the inventory.
- Entries that failed to enrich (e.g., malformed at-URIs) appear in `errors` rather than `enriched`.
- Threads are a separate endpoint (`/hydrate-threads`) — `enriched` entries do not include `thread_replies`.

**Errors**:

- `400 {"error":"missing uris"}` — required field absent.
- `400 {"error":"invalid uri"}` — entries that don't parse as at-URIs land in the response's `errors` array, not as a top-level error. Reserved for the malformed-payload case.
- `5xx {"error":"..."}` — daemon-internal failure.

**Timeout**: sub-second. The work is pure-function string parsing; nothing fans out.

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

- `credentials.pds` is optional and defaults to `https://bsky.social` when absent or empty. `handle` and `app_password` are required.

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

**Batching**: callers SHOULD pass as many URIs per request as they have on hand (up to a few hundred) rather than splitting into many small calls. Each request performs one `createSession` against the user's PDS for credential validation (see § 6); Bluesky throttles `createSession` more aggressively than read endpoints, so a chatty caller can hit the per-account limit. One request per session-load is the intended pattern.

**Note on credential use**: the daemon validates `credentials` with `com.atproto.server.createSession` (fail-fast on a bad app password), then discards the resulting JWT and reads threads from the public AppView (`https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread`) unauthenticated — matching the `bsky-saves` CLI's working pattern. See § 6 for the broader auth contract.

### 4. Capability advertisement

The new endpoints are advertised via the existing **`/ping`** `features` array — gains `"fetch"`, `"enrich"`, and `"hydrate-threads"` entries when the daemon supports them.

Older daemons (pre-0.4) won't advertise these; the GUI feature-detects per-endpoint and falls back to Pyodide for any feature missing from the helper. Mixed support is fine — a daemon that advertises `enrich` and `hydrate-threads` but not `fetch` will see those two operations routed through the helper while `fetch` stays on Pyodide.

### 5. Authentication handling

Applies to `/fetch` and `/hydrate-threads` only. `/enrich` is offline and takes no credentials.

- Credentials arrive in the request body. The daemon validates them by calling `com.atproto.server.createSession` once per request.
- **Endpoint-specific use of the resulting JWT:**
  - `/fetch` uses the JWT for the actual upstream calls (`bookmark.getBookmarks`, `getActorBookmarks`, `listRecords`) — those endpoints require auth.
  - `/hydrate-threads` discards the JWT after validation and calls the public AppView (`public.api.bsky.app`) unauthenticated. Credentials here are **validation-only** — they confirm the caller holds a working app password but don't gate the actual read. This matches the `bsky-saves` CLI's working pattern; authenticated AppView calls hit the "OAuth tokens are meant for PDS access only" wall and aren't relevant for public thread reads.
- The in-memory JWT lives for the duration of the request only — no persistence to disk, no shared cache across requests.
- If the GUI calls `/fetch` and `/hydrate-threads` back-to-back, each call performs its own `createSession`. Callers should batch where possible (especially `/hydrate-threads`, which would otherwise burn the per-account `createSession` rate budget on validation roundtrips). Avoiding shared state simplifies the threat model.
- The daemon never logs credentials, never echoes them in error responses.
- If a request omits `credentials`, return `400 {"error":"missing credentials"}`. Even though `/hydrate-threads`'s upstream call is anonymous, the credential check is a deliberate gate: it confirms a real account is behind the request, complementing the origin allowlist as an abuse defense.

### 6. Progress reporting

For v1 of these endpoints, **no streaming**. A single request, a single response. Acceptance:

- The GUI shows a busy spinner. If the daemon takes > 60 s, that's fine.
- Future revisions could stream partial results via SSE or chunked JSON, but only if the GUI gains a use for it. Don't over-design now.

### 7. Concurrency

Each endpoint may be called concurrently. The daemon must not serialize requests behind a single lock — that would make the GUI feel sluggish. `ThreadingHTTPServer` (already the v1 baseline) handles cross-request concurrency; within a single request, fan-out (e.g., the per-thread `getPostThread` calls in `/hydrate-threads`) can use a `ThreadPoolExecutor` over the existing sync `httpx` client. No async/await refactor required.

### 8. Origin allowlist + bind

Same rules as the v1 endpoints:

- Bind to `127.0.0.1` only.
- Apply the configured `--allow-origin` list. Reject browsers from other origins with the same `403 {"error":"Origin not allowed"}` shape.

### 9. Backwards compatibility

- The new endpoints are **additive**. Old GUIs (which only know `/fetch-image` and `/extract-article`) continue to work against new daemons.
- The new GUI features (routing enrich/threads through the helper) gate on the `features` array — they only kick in when the daemon advertises support.
- Inventory shape produced by `/enrich` and `/hydrate-threads` matches what `bsky-saves` writes when run as a CLI. The GUI's existing `parseInventory` accepts both.

## Why these three endpoints together

`fetch`, `enrich`, and `hydrate-threads` are the three CLI steps the GUI currently runs through Pyodide. Adding all three to `serve` lets a helper-equipped user opt out of Pyodide entirely — including the cold-start WASM download on every fresh sign-in, which is the most painful single step in the GUI's onboarding for users with the helper installed. `enrich` carries little Pyodide cost on its own (it's offline and trivial), but it's included for completeness so a helper-routed pipeline can stay end-to-end on the daemon without ever spawning the WASM worker.

The eventual end state is the v1 spec's Phase 2 `POST /run` — a one-shot endpoint that does fetch + enrich + threads + image hydration + article extraction in a single round trip. The three granular endpoints in this doc are the partial step toward that: they're independently useful (the GUI can call them when the user re-runs threads, refreshes enrichment, or paginates through bookmarks) and they de-risk `/run` by proving the pagination, inventory-shape, and credential-handling patterns.

## Out of scope

- **Streaming responses** — single request / single response in v1.
- **Configurable batch size** — the daemon picks sensible defaults (50 for getPosts, etc.). No flags.
- **Disk caching of `getPostThread` responses** — the daemon is stateless. The GUI persists what it needs.
- **OAuth-style flow** — credentials are app-passwords for now, matching what `bsky-saves` CLI accepts. OAuth migration tracked separately in the broader Bluesky ecosystem.

## Acceptance criteria

A `bsky-saves` release that closes this can be characterized by:

- `/ping` returns `{"features": ["fetch-image", "extract-article", "fetch", "enrich", "hydrate-threads"]}` (order doesn't matter).
- `POST /fetch` paginates the signed-in user's bookmarks; the GUI can walk the cursor to enumerate the entire collection without invoking Pyodide.
- `POST /enrich` with 50 valid URIs returns 50 entries in `enriched` (one `post_created_at` per URI) in well under one second. No credentials required.
- `POST /hydrate-threads` with 100 valid URIs + valid credentials returns 100 entries in `threaded` within 60 s.
- All three endpoints reject calls with `Origin: https://attacker.example`.
- `/fetch` and `/hydrate-threads` reject calls without `credentials`. `/enrich` does not.
- The GUI's `min-helper-version.ts` floor can be bumped to whatever version first ships these (likely `0.4.0`); the GUI will display "outdated, please upgrade to 0.4.0+" for older installs that lack these features.

## GUI side (already prepared)

- The helper-client module probes `/ping` and exposes `features`. Adding `enrich`/`hydrate-threads` consumers is purely additive.
- The Pyodide path stays as fallback. The GUI's enrich/threads code already has an injectable fetcher (see `image-hydrator`, `article-hydrator` for the pattern) — wiring a helper-backed enrich / threads runner alongside the Pyodide one is straightforward.
- `MIN_HELPER_VERSION` will bump to `0.4.0` (or whatever release first ships these endpoints) once available, with a concrete upgrade prompt visible in Settings → Backup.

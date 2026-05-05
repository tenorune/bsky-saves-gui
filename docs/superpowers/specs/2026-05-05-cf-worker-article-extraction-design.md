# Design: cf-worker article extraction (Plan 22)

## Goal

Let users hydrate article text without running the local helper. Today, article backup is helper-only; users who set up a custom Cloudflare Worker proxy can back up images but not articles. This plan adds a `/extract-article` endpoint to a new bundled variant of the worker, and wires it into the GUI's article-backup backend selection.

## Scope

- **In scope.** User-deployed custom Cloudflare Workers. New bundled artifact, new endpoint, GUI capability probe, modal step-3 tab to choose which artifact to deploy, article hydrator routes via worker when helper is absent.
- **Out of scope.** Operator's image proxy article extraction (deliberate: would make `tenorune.workers.dev` an attractive general-purpose scraper). Per-site extraction tuning. Migration prompting. Embedded-image rewriting in extracted text. Provenance metadata on already-hydrated articles.

## Architecture

### Two worker artifacts

Both live in `templates/cf-worker/`:

- `worker.js` — current hand-written image-only proxy. Unchanged in shape; gains only the `GET /capabilities` endpoint.
- `dist/worker-with-articles.bundle.js` — esbuild-bundled, minified output that bundles the same proxy logic plus `POST /extract-article`. Source at `src/worker-with-articles.ts`. Pulls in `@mozilla/readability` and `linkedom`. Bundle is committed to the repo so the GUI can `?raw`-import it the same way it imports `worker.js`.

A `package.json` and a `pnpm build:worker` script in `templates/cf-worker/` produce the bundle. The bundle is regenerated and committed whenever the source changes.

### `GET /capabilities`

Both workers expose this. Returns:

```json
{ "endpoints": ["/fetch"] }
```

or

```json
{ "endpoints": ["/fetch", "/extract-article"] }
```

Same auth/CORS as `/fetch`: Origin must match `ALLOWED_ORIGIN`, `X-Proxy-Secret` must match `SHARED_SECRET`.

### `POST /extract-article`

Only on `worker-with-articles.bundle.js`. Body:

```json
{ "url": "https://example.com/post" }
```

Auth + URL validation reuses the same helpers as `/fetch`: Origin, secret, http/https scheme only, optional `URL_ALLOWLIST` prefix check. Fetch shape matches `/fetch`: 20 s timeout, 10 MB body cap, `User-Agent: bsky-saves-gui-proxy/1`.

After fetching the HTML, the worker:
1. Parses with `linkedom`'s `parseHTML`.
2. Runs `Readability(document).parse()`.
3. Returns 200 with:

```json
{
  "url": "...",
  "title": "...",
  "text": "...",
  "fetched_at": "2026-05-05T12:34:56.789Z",
  "note": "extracted body looked short"
}
```

Schema matches the helper's existing `ExtractedArticle` so `article-hydrator.ts` and the `isExtractedArticle` typeguard work unchanged.

#### Soft-fail conventions (match helper)

- Readability returns `null` → 200, `text: ""`, `note: "could not extract main content"`.
- Extracted text < 200 chars → 200, `note: "extracted body looked short"`.
- Upstream non-2xx, network failure, body too large → 502 with `{ "error": "..." }`.
- Bad request body, bad URL → 400.
- Wrong Origin → 403. Wrong secret → 401. Other paths → 404.

### GUI integration

#### Proxy-config schema

Add one field to the persisted config:

```ts
type ProxyConfig = {
  url: string;
  sharedSecret: string;
  supportsArticles: boolean;  // new
};
```

`loadProxyConfig` returns `null` when no config exists. Old saved configs (no `supportsArticles` field) load with `supportsArticles: false` via a defensive default in the loader.

#### Capability probe

In `CustomProxySetupModal.handleSaveWorker`:

1. Save `{ url, sharedSecret, supportsArticles: false }` so the URL/secret persist even if probing fails.
2. `GET ${url}/capabilities` with `X-Proxy-Secret: ${sharedSecret}`. On 200, parse `endpoints`. If it includes `/extract-article`, update the config with `supportsArticles: true`.
3. Show inline status under the form:
   - ✓ "Article extraction enabled" — green tone.
   - ⚠ "Image-only worker — paste the article-enabled bundle in step 3 to enable article backup." — neutral/yellow tone.
   - "Saved (could not probe capabilities)" — if the probe network call itself failed; treat as image-only.
4. Dispatch `change` so Settings refreshes the trigger button label and re-detects backends.

#### Modal step 3 — tabs

Above the `<pre>` source-code block in step 3, two tabs:

- `[ Image only ]` (default)
- `[ Image + article extraction ]`

Active tab is visually distinguished (filled background or underline; pick whichever fits the existing modal palette). Switching tabs swaps both the `<pre>` content and the CopyButton's `text` prop. Both source strings are imported at build time:

```ts
import workerImageOnly from '../../../templates/cf-worker/worker.js?raw';
import workerWithArticles from '../../../templates/cf-worker/dist/worker-with-articles.bundle.js?raw';
```

The hint copy below the tab matches the active tab — e.g. "(~200 lines, readable source)" vs "(~minified bundle, larger; gives you article extraction in addition to images)".

#### Article hydrator

Add `extractArticleViaWorker(config: ProxyConfig, articleUrl: string)` to `app/src/lib/user-worker-client.ts` (extend the existing module that already hosts the image-fetch worker client). It POSTs to `${url}/extract-article` with the standard headers and body, and returns the parsed `ExtractedArticle`. Throws on non-2xx or malformed JSON. Special case: 404 → throw a sentinel error type (e.g. `class WorkerNoArticlesError`) that the hydrator can detect.

`article-hydrator.ts` selection logic:

1. If helper reachable → call helper.
2. Else if proxy config exists and `supportsArticles` is true → call `extractArticleViaWorker`.
3. Else → fail this URL with note "no article backend available — start the helper or enable article extraction on your custom worker."

Runtime fallback: if `extractArticleViaWorker` throws `WorkerNoArticlesError`, the hydrator updates the stored config to `supportsArticles: false`, and fails this article with note "worker no longer supports articles — redeploy with the article-enabled bundle." Subsequent articles in the same backup run skip the worker.

### `describe-backend.ts`

`describeArticleBackend()` currently reports helper-only. Update so when the helper is absent but `supportsArticles` is true, it reports "your custom Cloudflare Worker."

## Testing

### cf-worker (vitest with `unstable_dev`)

New tests in `templates/cf-worker/tests/`:

- `/capabilities` returns the right endpoint list for each bundle (one test against `worker.js`, one against `worker-with-articles.bundle.js`).
- `/extract-article` happy path: fixture HTML page, mocked upstream fetch, returns parsed `{ url, title, text, fetched_at }` matching schema.
- Empty / short extracted body → 200 with `note`.
- Readability-null page → 200 with `text: ""` and `note`.
- Non-2xx upstream → 502.
- Body-too-large upstream → 502.
- Auth, origin, allowlist failures → same shape as the existing `/fetch` tests.

### GUI (vitest)

- `user-worker-client.test.ts`: `extractArticleViaWorker` happy path; 404 throws `WorkerNoArticlesError`; 502 throws with reason; malformed JSON throws.
- `proxy-config.test.ts`: round-trip with `supportsArticles`; old saved config without the field loads with `supportsArticles: false`.
- `article-hydrator.test.ts`: helper present → uses helper; helper absent + worker supports articles → uses worker; helper absent + worker image-only → fails with the expected note; runtime 404 from worker → flips the stored flag and fails subsequent articles fast.
- `describe-backend.test.ts`: returns the worker description when helper is absent and worker supports articles.

## Risks and mitigations

- **Bundle size + readability.** The bundled artifact is ~200–400 KB minified, not human-readable. Mitigation: keep the simple `worker.js` as the default tab in the modal; users opt into the bundle only if they want articles. The unminified TypeScript source is in the repo for auditing; reproducible-build instructions go in the README.
- **Workers CPU limits.** Readability on large pages can be slow; cf Workers have a 30 s wall-clock limit on the free tier (50 ms CPU on basic, 30 s on standard / paid). The 10 MB body cap and 20 s upstream timeout already cap the worst case; users may need the Standard usage model. README will mention this.
- **Worker downgraded later.** Capability flag is probed only on save. Mitigation: runtime 404 fallback flips the flag and surfaces a clear note so the user knows to redeploy.
- **Capability probe failure ≠ image-only worker.** If the probe network call fails (CORS / DNS / etc.), we conservatively treat the worker as image-only. The user can re-save to retry the probe.

## Definition of done

- `templates/cf-worker/dist/worker-with-articles.bundle.js` is built, committed, and reproducible via `pnpm build:worker`.
- `worker.js` and the bundle both expose `GET /capabilities`.
- The bundle exposes `POST /extract-article` returning the helper-compatible schema.
- Setup-guide modal step 3 has tabs; the right artifact is shown and copied for each tab.
- Saving a worker URL probes `/capabilities` and persists `supportsArticles`.
- Article backup picks helper → user-worker (when `supportsArticles`); falls back gracefully on runtime 404.
- All existing tests pass; new tests cover the worker endpoint, client, hydrator, and describe-backend changes.

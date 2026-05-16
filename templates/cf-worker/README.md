# Cloudflare Worker Proxy — Deploy Instructions

This directory contains Cloudflare Worker templates that act as a CORS proxy
for image and article-URL fetches made by bsky-saves-gui. Deploy one to **your
own Cloudflare account** — the app developer never sees your traffic.

The hosted GUI can call your worker over HTTPS for image and article backups,
sidestepping the mixed-content rule that blocks Safari from reaching a local
`http://localhost`-served helper.

## Two flavors

Pick one based on what you want to back up:

| File | What it proxies | Notes |
|---|---|---|
| [`worker.js`](worker.js) | Images only (`POST /fetch`). | Hand-written, ~200 lines, easy to audit. Sufficient if you only want image backups. |
| [`dist/worker-with-articles.bundle.js`](dist/worker-with-articles.bundle.js) | Images **and** article extraction (`POST /fetch` + `POST /extract-article`, Mozilla Readability + linkedom). | Pre-built ESM bundle. Pick this one if you also want article-text backups. Source lives at [`src/worker-with-articles.ts`](src/worker-with-articles.ts). |

Both variants use the same `ALLOWED_ORIGIN` / `SHARED_SECRET` configuration
and the same `/fetch` and `/capabilities` endpoints, so you can swap one for
the other later without re-configuring the GUI.

## Two ways to deploy

| Path | Best for | Time |
|---|---|---|
| **Dashboard (no CLI)** — below | Most users. No tools to install. | ~10 minutes |
| **Command line (`wrangler`)** — [further down](#command-line-path-wrangler) | If you already use wrangler, or prefer a versioned worker dir. | ~10 minutes |

The GUI also ships an in-app walkthrough: **Settings → Backups → "Custom
Cloudflare Worker proxy"** opens a step-by-step modal with the source for
either variant inline and a Copy button. The steps below mirror that flow so
you can follow it without leaving the GitHub README.

---

## Dashboard path (no CLI)

Prerequisite: a [Cloudflare account](https://dash.cloudflare.com/sign-up).
The free tier allows 100,000 worker requests per day, which is more than
enough for personal use of bsky-saves-gui.

### 1. Generate a shared secret

Open your browser's DevTools (F12 → Console) and paste:

```js
crypto.getRandomValues(new Uint8Array(32)).reduce((a,b)=>a+b.toString(16).padStart(2,'0'),'')
```

Press Enter. You'll get a 64-character hex string. Copy it — you'll paste it
twice below.

### 2. Create the worker on Cloudflare

Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Compute** →
**Workers & Pages** → **Create application** → **Start with Hello World!**
Name it something like `bsky-saves-image-proxy`. Click **Deploy** to accept
the placeholder.

### 3. Paste the worker source

On the worker page click **Edit code**. Paste one of the templates over the
placeholder, then click **Deploy**:

- Image only → copy [`worker.js`](worker.js).
- Image + article extraction → copy [`dist/worker-with-articles.bundle.js`](dist/worker-with-articles.bundle.js).

### 4. Set environment variables

Worker page → **Settings** → **Variables and Secrets**:

- Variable `ALLOWED_ORIGIN` = the origin of your bsky-saves-gui deployment,
  e.g. `https://saves.lightseed.net`. Multiple origins may be supplied as a
  comma-separated list, e.g. `https://saves.example.com,https://staging.example.com`.
- Secret `SHARED_SECRET` = the 64-character hex string from step 1.

### 5. Copy the worker URL and test it

The URL is at the top of the worker page, ending in `.workers.dev`. Test it by
pasting `<that URL>/fetch` into a browser tab — you should see
`{"error":"Origin not allowed"}` with status 403. That means the worker is
reachable and gating origins correctly.

### 6. Paste into the app

In bsky-saves-gui, go to **Settings → Backups → Custom Cloudflare Worker
proxy**. Put the URL into **Proxy URL** and the same hex string into
**Shared secret**. Click Save. The app will probe the worker to confirm
it's reachable.

---

## Command-line path (`wrangler`)

The more technical alternative. Use this if you already use wrangler or want
the worker source under version control.

### Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up).
- [Node.js](https://nodejs.org) 18 or later.
- `wrangler` CLI — the Cloudflare deployment tool.

### Step 1 — Install wrangler

```bash
npm install -g wrangler
```

Verify:
```bash
wrangler --version
```

### Step 2 — Log in to Cloudflare

```bash
wrangler login
```

This opens a browser window. Authorize wrangler. Close the tab when prompted.

### Step 3 — Copy the template files

Copy the worker source you want plus the `wrangler.toml` template into a new
working folder:

```bash
mkdir my-bsky-proxy
# pick one:
cp worker.js my-bsky-proxy/                              # image only
cp dist/worker-with-articles.bundle.js my-bsky-proxy/    # image + articles
cp wrangler.toml.template my-bsky-proxy/wrangler.toml
cd my-bsky-proxy
```

### Step 4 — Customize `wrangler.toml`

Open `wrangler.toml` and set `name` and `main` to match the file you copied:

```toml
name = "my-bsky-saves-proxy"
main = "worker.js"
# or, for the articles variant:
# main = "worker-with-articles.bundle.js"
compatibility_date = "2025-01-01"
```

You can leave everything else as-is.

### Step 5 — Set the secrets

You need two strings:

| Value | Where to find it |
|---|---|
| `SHARED_SECRET` | Generate one. From DevTools console: `crypto.getRandomValues(new Uint8Array(32)).reduce((a,b)=>a+b.toString(16).padStart(2,'0'),'')` |
| `ALLOWED_ORIGIN` | The origin of your bsky-saves-gui deployment, e.g. `https://saves.lightseed.net`. Multiple origins may be supplied as a comma-separated list. |

Run the following two commands in your `my-bsky-proxy` folder. Wrangler will
prompt you to paste the value for each:

```bash
wrangler secret put SHARED_SECRET
```
Paste the hex string. Press Enter.

```bash
wrangler secret put ALLOWED_ORIGIN
```
Paste your app's origin (e.g. `https://saves.lightseed.net`). Press Enter.

Secrets are encrypted and stored by Cloudflare. They are never in
`wrangler.toml` and never committed to any repository.

### Step 6 — Deploy

```bash
wrangler deploy
```

Expected output (last line):
```
Published my-bsky-saves-proxy (x.xx sec)
  https://my-bsky-saves-proxy.<your-subdomain>.workers.dev
```

Copy the worker URL.

### Step 7 — Configure the app

In bsky-saves-gui, go to **Settings → Backups → Custom Cloudflare Worker
proxy**. Paste the worker URL into the "Proxy URL" field and the same
`SHARED_SECRET` into the "Shared secret" field, then Save. The app will probe
the worker with your secret to confirm it's reachable.

### Building the articles bundle from source

`dist/worker-with-articles.bundle.js` is committed pre-built so users can copy
it without running a build. If you want to rebuild it (e.g. you patched the
source):

```bash
cd templates/cf-worker
pnpm install
pnpm build
```

### Updating

When a new version of the worker is published in this repo, copy it over your
existing file and run `wrangler deploy` again. Secrets are preserved.

---

## Security notes

- `ALLOWED_ORIGIN` locks the worker to your app's origin. Requests from any
  other origin receive `403 Forbidden`. To allow more than one origin (e.g.
  a production and staging deployment), set the value to a comma-separated
  list — each entry is exact-matched, and the matched origin is echoed back
  in the `Access-Control-Allow-Origin` header.
- `SHARED_SECRET` ensures only your app (which knows the secret) can use the
  proxy. Requests without the correct `X-Proxy-Secret` header receive `401 Unauthorized`.
- Only `http://` and `https://` URLs are proxied. Other schemes are rejected.
- Upstream responses larger than 10 MB are refused.
- Upstream fetches time out after 20 seconds.

## Endpoints

### `OPTIONS *`

CORS preflight. Returns `204 No Content` with the appropriate CORS headers
when `Origin` matches one of the values in `ALLOWED_ORIGIN` (single value or
comma-separated list). Returns `403` otherwise.

### `POST /fetch`

Required headers:
- `Origin: <ALLOWED_ORIGIN>` — must match the configured value (or any entry of the comma-separated list).
- `X-Proxy-Secret: <SHARED_SECRET>` — must match the configured value.
- `Content-Type: application/json`

Request body:
```json
{ "url": "https://example.com/article" }
```

Success response (`200 OK`):
```json
{
  "status": 200,
  "headers": { "content-type": "text/html; charset=utf-8" },
  "body_b64": "PGh0bWw+..."
}
```

Error responses follow the same JSON shape:
```json
{ "error": "Unauthorized" }
```

| HTTP Status | Meaning |
|---|---|
| `204` | Preflight OK |
| `400` | Bad request (invalid URL, missing field, non-JSON body) |
| `401` | Wrong or missing `X-Proxy-Secret` |
| `403` | Origin not allowed |
| `404` | Unknown path or method |
| `500` | Worker misconfigured (missing env var) |
| `502` | Upstream fetch failed or timed out |

### `GET /capabilities`

Returns `{ "endpoints": [...] }` for runtime detection. Use this to discover
whether a deployed worker supports `/extract-article` in addition to `/fetch`.

### `POST /extract-article` (articles bundle only)

Body `{ "url": "https://..." }`, returns
`{ url, title, text, fetched_at, note? }` matching the local helper's shape.

## Deploying as the site's operator proxy

The bsky-saves-gui app supports a layered image-backup backend strategy:

1. **Local helper** (`bsky-saves serve`) — most private, requires user to install bsky-saves locally.
2. **User-deployed Cloudflare Worker** — user runs `wrangler deploy` or follows the dashboard path and pastes URL+secret into Settings.
3. **Operator-deployed Cloudflare Worker** *(this section)* — set up by the site operator; used as a fallback when no helper or user-worker is configured. Users opt in by default but can opt out from Settings → Backup → Advanced.

Operators who deploy this worker should harden it with a URL allowlist so that
the worker only proxies the bsky CDN, limiting abuse surface to a single host.

### Required environment variables

Set these via `wrangler secret put` (for secrets) or `wrangler.toml` `[vars]` (for non-sensitive values):

| Variable | Required | Purpose |
|----------|----------|---------|
| `ALLOWED_ORIGIN` | yes | The deployed GUI's origin, e.g. `https://saves.example.com`. Multiple origins may be supplied as a comma-separated list, e.g. `https://saves.example.com,https://staging.example.com`. Requests with other Origins are rejected. |
| `SHARED_SECRET` | yes | Random secret. The GUI sends this in the `X-Proxy-Secret` header. |
| `URL_ALLOWLIST` | recommended for operator deployments | Comma-separated URL prefixes the worker is allowed to fetch. For an operator proxy, set this to `https://cdn.bsky.app/img/` so the worker only relays the bsky image CDN. Empty/unset = no restriction (only safe for trusted user deployments). |

### Wiring into the GUI build

The GUI reads these build-time environment variables:

```
VITE_OPERATOR_IMAGE_PROXY_URL=https://your-operator-worker.workers.dev
VITE_OPERATOR_IMAGE_PROXY_KEY=<same value as SHARED_SECRET>
```

In a GitHub Pages deploy (see `.github/workflows/pages.yml`), add both as repository **variables** (`vars.*`, not `secrets.*`) and reference them under the build step's `env:` block.

The key is baked into the deployed JS bundle and is visible to anyone who inspects the page — and travels with every downstream bundle (the Python wheel and OS installers vendor the same `dist/`). This is acceptable: its purpose is to deter random internet traffic, not to authenticate. The real protection is the **URL allowlist** (which makes the proxy useless for anything other than the bsky image CDN) plus Cloudflare's standard rate-limiting and abuse defenses.

### Opt-out behavior

Users can opt out of the operator proxy from the GUI: Settings → Backup → Advanced backup options → "Don't use the operator's proxy". When opted out, the GUI excludes the operator backend from `detectBackends`, regardless of the build-time configuration. The user can re-enable by unticking the checkbox.

The opt-out preference is persisted per browser (in IndexedDB).

### Privacy expectations

Operators should clearly document in their privacy policy:
- That the operator proxy is configured.
- The URL of the deployed worker.
- The fact that image bytes flow through the worker.
- Whether the worker logs any traffic (it should not — the template doesn't).
- The opt-out path.

See `docs/privacy.md` in the GUI repo for the canonical reference.

## Notes

- Cloudflare Workers' free plan limits CPU per request; large pages with heavy
  Readability work may need the Standard usage model.
- The `URL_ALLOWLIST` env var (if set) applies to both `/fetch` and
  `/extract-article`.

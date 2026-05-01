# bsky-saves-gui-helper

A tiny stdlib-only Python helper that runs a loopback HTTP server on `127.0.0.1` so the [bsky-saves-gui](https://github.com/tenorune/bsky-saves-gui) web app can fetch arbitrary article URLs without being blocked by browser CORS restrictions.

## Install

```bash
pipx install bsky-saves-gui-helper
```

Or with plain pip into a virtual environment:

```bash
pip install bsky-saves-gui-helper
```

Requires **Python 3.10 or later**. No extra dependencies — pure stdlib.

## Run

```bash
bsky-saves-gui-helper
```

The server binds to `127.0.0.1:7878` by default and prints the active configuration on startup. Press Ctrl-C to stop.

## Flags

| Flag | Env var | Default | Description |
|---|---|---|---|
| `--port PORT` | `HELPER_PORT` | `7878` | Loopback port to bind |
| `--allow-origin ORIGIN` | `HELPER_ALLOW_ORIGIN` | `https://saves.lightseed.net` and `http://localhost:5173` | Permitted CORS origins. Repeatable. Env var accepts space-separated values. |
| `--allow-host HOST` | `HELPER_ALLOW_HOST` | _(none — all article hosts allowed)_ | Restrict outbound fetches to these hostnames. Repeatable. Env var accepts space-separated values. |
| `--timeout SECONDS` | — | `20` | Socket timeout for outbound article fetches |
| `--max-bytes BYTES` | — | `10485760` (10 MB) | Maximum response body size |

CLI flags take precedence over env vars, which take precedence over built-in defaults.

### Examples

Self-hosted instance on a different domain:

```bash
bsky-saves-gui-helper --allow-origin https://mysaves.example.com
```

Development against a local Vite dev server:

```bash
bsky-saves-gui-helper --allow-origin http://localhost:5173
```

Restrict which article sites can be fetched:

```bash
bsky-saves-gui-helper --allow-host www.bbc.com --allow-host www.theguardian.com
```

## Endpoints

### `GET /health`

Returns:

```json
{"ok": true, "version": "0.1.0"}
```

### `POST /fetch`

Request body (JSON):

```json
{"url": "https://www.example.com/article"}
```

Success response (JSON):

```json
{
  "status": 200,
  "headers": {"Content-Type": "text/html; charset=utf-8"},
  "body_b64": "<base64-encoded response body>"
}
```

Error response (JSON):

```json
{"error": "Unsupported URL scheme 'file'; only http and https are allowed."}
```

HTTP status codes:
- `200` — successful fetch (the upstream status is in the JSON payload)
- `400` — bad request (invalid JSON body, missing `url`, disallowed URL scheme)
- `403` — origin not in CORS allow-list, or target host not in `--allow-host` list
- `404` — unknown path
- `502` — upstream fetch failed or response body too large
- `500` — unexpected internal error

## Security notes

- **Loopback-only.** The server binds to `127.0.0.1` and will not accept connections from any other interface. It is not a network proxy.
- **CORS allow-list.** Every response path checks the `Origin` header against the configured allow-list. Requests from unlisted origins receive `403`. The default allow-list contains only the reference deployment origin and the Vite dev server.
- **URL scheme validation.** Only `http://` and `https://` URLs are accepted. `file://`, `ftp://`, `gopher://`, and all other schemes are rejected with `400`.
- **Outbound host allow-list (optional).** `--allow-host` lets you restrict which article domains the helper will contact. Unlisted hosts receive `403`.
- **Body size cap.** Responses larger than `--max-bytes` (default 10 MB) are truncated and the request returns `502`.
- **Fetch timeout.** Outbound requests time out after `--timeout` seconds (default 20 s).

## Self-host configuration

If you deploy the web app under your own domain, pass your domain as the allowed origin:

```bash
bsky-saves-gui-helper --allow-origin https://YOUR_DOMAIN
```

The `VITE_HELPER_ORIGIN` build variable in the web app controls which loopback address and port the app probes for the helper. If you change `--port`, update `VITE_HELPER_ORIGIN` in your deployment.

## License

MIT — see [LICENSE](../LICENSE) at the repo root.

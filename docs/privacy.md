# Privacy

This page describes how `${VITE_APP_NAME}` (deployed at `${VITE_APP_DOMAIN}`) handles your data.

## Architecture summary

This is a static web app. There is no operator-run server that receives your credentials, your saved posts, or any other content by default. The page, its scripts, and its styles are static files hosted on GitHub Pages. Almost all processing happens in your browser.

The exception is **image backup**, which can optionally route image bytes through a small server-side proxy. See "What can leave your browser" below.

## What stays local

- Your handle and app password (only in browser memory unless you opt in to encrypted persistence in IndexedDB).
- Your Bluesky session token (access JWT + refresh JWT + handle + DID + PDS), stored in your browser's `sessionStorage` so the **Update** button works after a page reload without re-typing your password. Wiped automatically when you close the tab or quit the browser, and when you click "Clear all local data" in Settings.
- Your inventory of saved posts (in IndexedDB on this device).
- Hydrated content (image blobs, extracted article text).

## What can leave your browser

### For all users

- **Your Bluesky PDS** receives your authentication and AT Protocol requests when you sign in and run an update.
- **`cdn.bsky.app`** receives image fetches when an image renders in the Library or post view (just like any browser viewing a page that embeds bsky-hosted images).

### When backup is configured (opt-in)

`${VITE_APP_NAME}` supports a layered set of backends for **image** and **article** backup. Bytes flow through whichever backend is configured. The order of preference (most private first):

1. **Local helper** (`bsky-saves serve` running on your machine, default port 47826)
   - Used when detected.
   - Bytes never leave your machine: the helper fetches from `cdn.bsky.app` (or article URLs) on your behalf and returns the bytes via loopback HTTP.
   - The operator of `${VITE_APP_DOMAIN}` sees nothing.
   - Required for **article backup**: trafilatura-based article extraction only runs in the helper today.

2. **Your own Cloudflare Worker** (URL + shared secret you configure in Settings → Backup → Advanced)
   - Used when configured and the local helper is not running.
   - Bytes flow through your Cloudflare account; the operator of `${VITE_APP_DOMAIN}` sees nothing.
   - Source code in the project repo at `templates/cf-worker/`.

3. **Operator-deployed Cloudflare Worker** (image backup only — when configured by the operator at build time)
   - Used as a last resort when neither the local helper nor your own worker is available.
   - **Image bytes flow through the operator's Cloudflare account.** The operator does not log URLs or content.
   - Restricted by URL allowlist to `cdn.bsky.app/img/` so the worker can only relay bsky's image CDN.
   - Opt out from Settings → Backup → Advanced backup options → "Don't use the operator's proxy". When opted out, the operator backend is excluded from the layered detection regardless of build-time configuration.
   - Article backup is **not** supported through the operator's worker.

There is no analytics service. No telemetry. No error reporting endpoint.

## GitHub Pages edge logging

Static files are hosted on GitHub Pages. GitHub sees server-level request metadata (IP, path, user agent) like any web host, per <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener noreferrer">GitHub's privacy statement</a>. The operator does not have access to those logs.

## Threats out of scope

- A compromised browser extension can read anything this page can read, including the session token in `sessionStorage` and any unlocked credentials.
- A compromised device is out of scope.
- Supply chain attacks on the GitHub Pages deploy. Mitigated by version-pinned dependencies and tag-driven CI.
- Cloudflare Workers' own infrastructure (when any cf-worker backend is in use). Cloudflare sees TCP-level request metadata but not content beyond what the worker handler observes; the worker handler in this project does not log content.

## How to revoke a Bluesky app password

If you ever want to revoke the app password you used here, sign in to <a href="https://bsky.app" target="_blank" rel="noopener noreferrer">Bluesky</a>, open <a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noopener noreferrer">Settings → Privacy and Security → App Passwords</a>, and delete it. The app password used by this tool is unrelated to your main account password.

## Questions

Send a message to <a href="https://bsky.app/profile/${VITE_OPERATOR_HANDLE}" target="_blank" rel="noopener noreferrer">@${VITE_OPERATOR_HANDLE}</a> on Bluesky or open an issue at the project repository linked from the footer.

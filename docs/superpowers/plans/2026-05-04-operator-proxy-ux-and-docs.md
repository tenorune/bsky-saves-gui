# Plan 13: Operator-proxy UX (Settings panel) + docs (cf-worker README, privacy)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Make the operator-proxy backend (Plan 12 engine) discoverable and controllable from the GUI, document deployment for operators, and update the privacy doc to honestly describe data flow across all three image backends and the article path.

**Three tasks:**

1. **Settings → Backup → Advanced operator-proxy panel.** When `VITE_OPERATOR_IMAGE_PROXY_URL` is configured at build time, show the proxy URL, a reachability indicator (probed via `OPTIONS` preflight), and a "Don't use the operator's proxy" checkbox bound to `operatorProxyOptOut`.
2. **`templates/cf-worker/README.md` extension.** Add a section for operator deployment: required env vars (including the new `URL_ALLOWLIST`), GitHub Actions secrets pattern, opt-out semantics, hardening recommendations.
3. **`docs/privacy.md` rewrite.** Update to describe the helper, user-worker, and operator-proxy paths for image backup, plus the helper-only article path, plus the opt-out story. Replace stale text.

**Tech Stack:** No new dependencies.

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `47edca4` (Plan 12 final commit) or later.

---

## Task 1: Operator-proxy panel in Settings → Backup → Advanced

The panel renders only when `config.operatorImageProxyUrl` is non-empty (i.e., the operator deployed with the env vars set). It shows:
- The URL (read-only).
- A reachability badge: probed by sending an `OPTIONS` request to the URL with `Origin: window.location.origin`. The cf-worker template returns 204 on a valid preflight; anything else (network error, 403, etc.) means unreachable or misconfigured.
- A checkbox: "Don't use the operator's proxy". Checked = opt out. Updating the toggle calls `setOperatorProxyOptOut(...)` and re-runs `detectBackends`.

**Files:**
- Modify: `app/src/routes/Settings.svelte`

- [ ] **Step 1: Add imports**

In `app/src/routes/Settings.svelte`'s `<script>` block, after existing backup-prefs imports, add:

```ts
import { setOperatorProxyOptOut } from '$lib/backup-prefs';
import { config } from '$lib/config';
```

(`config` may already be imported; only add if missing.)

- [ ] **Step 2: Add state and reachability probe**

Below the existing onMount in Settings.svelte, add:

```ts
  let operatorProxyReachable: 'unknown' | 'ok' | 'fail' = 'unknown';
  $: operatorProxyConfigured = config.operatorImageProxyUrl !== '';
  $: operatorProxyOptOut = backupPrefs?.operatorProxyOptOut ?? false;

  async function probeOperatorProxy(): Promise<void> {
    if (!operatorProxyConfigured) return;
    operatorProxyReachable = 'unknown';
    try {
      const url = config.operatorImageProxyUrl.replace(/\/+$/, '') + '/fetch';
      const res = await fetch(url, {
        method: 'OPTIONS',
        headers: { Origin: window.location.origin },
      });
      operatorProxyReachable = res.status === 204 ? 'ok' : 'fail';
    } catch {
      operatorProxyReachable = 'fail';
    }
  }

  async function handleToggleOperatorProxyOptOut(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    await setOperatorProxyOptOut(checked);
    await reloadBackupPrefs();
    detectedBackends = await detectBackends();
  }
```

Update the existing `onMount` to call `probeOperatorProxy` after loading prefs:

```ts
  onMount(async () => {
    backupPrefs = await loadBackupPrefs();
    detectedBackends = await detectBackends();
    const cfg = await loadProxyConfig();
    if (cfg) {
      workerUrl = cfg.url;
      workerSecret = cfg.sharedSecret;
    }
    void probeOperatorProxy();
  });
```

- [ ] **Step 3: Add the panel inside the existing Advanced disclosure**

Inside the existing `<details class="advanced-toggle">` block (the Custom worker form), append the operator-proxy panel BELOW the existing custom worker section but inside the `</details>`:

```svelte
        {#if operatorProxyConfigured}
          <hr class="advanced-divider" />
          <p class="help">
            <strong>Operator's image proxy</strong>
            <br />
            <code>{config.operatorImageProxyUrl}</code>
            {#if operatorProxyReachable === 'ok'}
              <span class="status-ok">· reachable</span>
            {:else if operatorProxyReachable === 'fail'}
              <span class="status-fail">· unreachable</span>
            {/if}
          </p>
          <p class="help">
            When set up by the site operator, this proxy is used as a fallback
            for image backup when no local helper or custom Cloudflare Worker is
            configured. Image bytes flow through the operator's worker; the
            operator does not log URLs or content.
          </p>
          <label class="checkbox">
            <input
              type="checkbox"
              checked={operatorProxyOptOut}
              on:change={handleToggleOperatorProxyOptOut}
            />
            <span>Don't use the operator's proxy</span>
          </label>
        {/if}
```

- [ ] **Step 4: Add styles for the divider and status badges**

Inside the `<style>` block, add:

```css
  .advanced-divider {
    border: 0;
    border-top: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
    margin: 1rem 0 0.75rem;
  }
  .status-ok {
    color: color-mix(in oklab, green 70%, CanvasText);
    font-weight: 500;
  }
  .status-fail {
    color: color-mix(in oklab, red 70%, CanvasText);
    font-weight: 500;
  }
```

- [ ] **Step 5: Run check + tests + build**

Run: `pnpm check && pnpm test && pnpm build`

Expected: 0 errors, 0 warnings. 157/157 tests pass. Both bundles build.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(settings): operator-proxy panel with reachability + opt-out toggle"
```

DO NOT push.

---

## Task 2: `templates/cf-worker/README.md` operator-deploy section

Extend the existing 180-line README with a new section describing operator-deploy specifics. This README already covers user deployment; we're adding the operator-specific bits (URL_ALLOWLIST, GitHub Actions secrets, opt-out behavior).

**Files:**
- Modify: `templates/cf-worker/README.md`

- [ ] **Step 1: Read the current README**

Run: `cat templates/cf-worker/README.md` to understand the structure and existing sections.

- [ ] **Step 2: Append a new section near the end (or after the existing "Configuration" / "Deploy" section)**

Insert this section before any final "Troubleshooting" or "License" section. If no such section exists, append at end:

```markdown
## Deploying as the site's operator proxy

The bsky-saves-gui app supports a layered image-backup backend strategy:

1. **Local helper** (`bsky-saves serve`) — most private, requires user to install bsky-saves locally.
2. **User-deployed Cloudflare Worker** — user runs `wrangler deploy` and pastes URL+secret into Settings.
3. **Operator-deployed Cloudflare Worker** *(this section)* — set up by the site operator; used as a fallback when no helper or user-worker is configured. Users opt in by default but can opt out from Settings → Backup → Advanced.

Operators who deploy this worker should harden it with a URL allowlist so that
the worker only proxies the bsky CDN, limiting abuse surface to a single host.

### Required environment variables

Set these via `wrangler secret put` (for secrets) or `wrangler.toml` `[vars]` (for non-sensitive values):

| Variable | Required | Purpose |
|----------|----------|---------|
| `ALLOWED_ORIGIN` | yes | The deployed GUI's origin, e.g. `https://saves.example.com`. Requests with other Origins are rejected. |
| `SHARED_SECRET` | yes | Random secret. The GUI sends this in the `X-Proxy-Secret` header. |
| `URL_ALLOWLIST` | recommended for operator deployments | Comma-separated URL prefixes the worker is allowed to fetch. For an operator proxy, set this to `https://cdn.bsky.app/img/` so the worker only relays the bsky image CDN. Empty/unset = no restriction (only safe for trusted user deployments). |

### Wiring into the GUI build

The GUI reads these build-time environment variables:

```
VITE_OPERATOR_IMAGE_PROXY_URL=https://your-operator-worker.workers.dev
VITE_OPERATOR_IMAGE_PROXY_SECRET=<same value as SHARED_SECRET>
```

In a GitHub Pages deploy (see `.github/workflows/pages.yml`), add these as repository **variables** (URL) and **secrets** (the secret), then reference them under the build step's `env:` block.

The secret is baked into the deployed JS bundle and is therefore visible to anyone who inspects the page. This is acceptable: the secret's purpose is to deter random internet traffic, not to keep the URL or auth flow secret. The real protection is the **URL allowlist** (which makes the proxy useless for anything other than the bsky CDN) plus Cloudflare's standard rate-limiting and abuse defenses.

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

See `docs/privacy.md` in this repo for the canonical reference.
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs(cf-worker): operator-deploy section with URL_ALLOWLIST + opt-out"
```

DO NOT push.

---

## Task 3: `docs/privacy.md` rewrite

The current 43-line privacy doc is image-focused and predates the helper / operator-proxy / article paths. Rewrite it to honestly cover all three image backends, the article path, and the opt-out story.

**Files:**
- Modify: `docs/privacy.md`

- [ ] **Step 1: Read the current privacy doc**

Run: `cat docs/privacy.md`

Note the current frontmatter / variable substitutions (e.g., `${VITE_APP_NAME}`, `${VITE_APP_DOMAIN}`, `${VITE_OPERATOR_HANDLE}`). Preserve the templating pattern.

- [ ] **Step 2: Rewrite the doc**

Replace `docs/privacy.md` with this content:

```markdown
# Privacy

This page describes how `${VITE_APP_NAME}` (deployed at `${VITE_APP_DOMAIN}`) handles your data.

## Architecture summary

This is a static web app. There is no operator-run server that receives your credentials, your saves, or any other content by default. The page, its scripts, and its styles are static files hosted on GitHub Pages. Almost all processing happens in your browser.

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
```

- [ ] **Step 3: Verify the build still produces a valid privacy page**

Run: `pnpm build`

The build should still succeed; the privacy page is processed by Vite at build time with env-var substitution. If any of the `${VITE_*}` variable substitutions break, the build will fail. (The variables used here all already exist.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(privacy): rewrite to cover helper, user-worker, operator-proxy, articles"
```

DO NOT push.

---

## Final verification

- [ ] **Step 1: Run check + test + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 type errors, 0 warnings. 157/157 tests pass. Both bundles build.

- [ ] **Step 2: Push**

```bash
git push origin main
```

---

## What's next

After Plan 13, the operator-proxy backend is complete: engine + UX + opt-out + docs + privacy story.

Remaining candidates from earlier (each small):
- **Show Details modal** — failure list with permalinks + reasons.
- **Banner sequencing** — image first, article waits.
- **PostFocus backup footer** — per-post status indicator.
- **Cf-worker article extraction** — extends template with `/extract-article` (Mozilla Readability) so non-helper users can hydrate articles too.

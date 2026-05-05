# Plan 15: In-app custom-proxy setup guide

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Replace the "see `templates/cf-worker/` in the project repo" reference with concrete step-by-step instructions accessible inside the GUI. A user who's never used the command line should be able to follow the steps and end up with a working custom proxy.

**Architecture:** A nested `<details>` block inside Settings → Backup → Advanced disclosure, titled "Setup guide", containing six numbered steps with concrete clickable links and copy-pasteable code. Single component change — no modal infrastructure.

**Out of scope:**
- Modal / dedicated route for the guide (deliberate: nested `<details>` is simpler and good enough).
- Screenshots or animated walkthroughs (text only for now).
- "Test connection" button (the existing detect+save+re-detect flow already validates).
- Article-extraction guide (cf-worker doesn't extract articles in v1; deferred to Plan 19).

**Tech Stack:** Svelte 4. No new dependencies.

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `b2d0dc5` or later.

---

## Task 1: Inline setup guide in Settings → Backup → Advanced

**Files:**
- Modify: `app/src/routes/Settings.svelte`

- [ ] **Step 1: Replace the help text + add the nested guide**

Open `app/src/routes/Settings.svelte`. Find the existing Advanced disclosure block. Inside it, find this paragraph:

```svelte
        <p class="help">
          Custom Cloudflare Worker proxy. Used as a fallback when no local helper
          is running. See <code>templates/cf-worker/</code> in the project repo
          for how to deploy your own.
        </p>
```

Replace the entire `<p>` (and only that paragraph; leave the URL/secret form below it unchanged) with:

```svelte
        <p class="help">
          Custom Cloudflare Worker proxy. Used as a fallback when no local helper
          is running. The setup is one-time, takes about 10 minutes, and runs on
          Cloudflare's free tier.
        </p>

        <details class="setup-guide">
          <summary>Setup guide</summary>
          <ol class="setup-guide__steps">
            <li>
              <strong>Generate a shared secret.</strong>
              Open your browser's DevTools (F12 → Console). Paste this and press
              Enter:
              <pre class="setup-guide__code">crypto.getRandomValues(new Uint8Array(32)).reduce((a,b)=&gt;a+b.toString(16).padStart(2,'0'),'')</pre>
              You'll get a 64-character hex string. Copy it — you'll paste it
              twice below.
            </li>
            <li>
              <strong>Create the worker on Cloudflare.</strong>
              Go to
              <a href="https://dash.cloudflare.com" target="_blank" rel="noopener noreferrer">dash.cloudflare.com</a>
              → Workers &amp; Pages → Create → Create Worker. Name it something
              like <code>bsky-saves-image-proxy</code>. Click Deploy to accept
              the placeholder.
            </li>
            <li>
              <strong>Paste the worker source.</strong>
              On the worker page click <em>Edit code</em>. In a new tab, open
              <a
                href="https://github.com/tenorune/bsky-saves-gui/blob/main/templates/cf-worker/worker.js"
                target="_blank"
                rel="noopener noreferrer"
              >the worker source</a>, click <em>Raw</em>, copy everything. Paste
              it over the placeholder in Cloudflare. Click Deploy.
            </li>
            <li>
              <strong>Set environment variables.</strong>
              Worker page → Settings → Variables and Secrets:
              <ul>
                <li>Variable <code>ALLOWED_ORIGIN</code> = <code>{window.location.origin}</code></li>
                <li>Secret <code>SHARED_SECRET</code> = the 64-character hex string from step 1</li>
              </ul>
            </li>
            <li>
              <strong>Copy the worker URL.</strong>
              It's at the top of the worker page, ending in
              <code>.workers.dev</code>. Test it by pasting
              <code>&lt;that URL&gt;/fetch</code> into a browser tab — you should
              see <code>{`{"error":"forbidden"}`}</code> with status 403. That
              means the worker is reachable.
            </li>
            <li>
              <strong>Paste below.</strong>
              Put the URL into <em>Proxy URL</em> and the same hex string into
              <em>Shared secret</em>. Click Save.
            </li>
          </ol>
        </details>
```

Note `{window.location.origin}` interpolates the deployed GUI's origin so the user sees the correct value to paste (e.g., `https://saves.lightseed.net`). Note the JSON example uses `{` and `}` wrapped in a Svelte template-literal expression so Svelte doesn't interpret the braces.

- [ ] **Step 2: Add CSS for the setup-guide block**

Inside the existing `<style>` block (alongside the other `.advanced-toggle` / `.settings-section` rules), add:

```css
  .setup-guide {
    margin: 0.5rem 0 1rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
    border-radius: 6px;
    background: color-mix(in oklab, CanvasText 3%, Canvas);
  }
  .setup-guide summary {
    cursor: pointer;
    font-weight: 500;
    font-size: 0.9rem;
  }
  .setup-guide__steps {
    margin: 0.75rem 0 0.25rem 1.25rem;
    padding: 0;
    font-size: 0.875rem;
    line-height: 1.5;
  }
  .setup-guide__steps li {
    margin-bottom: 0.85rem;
  }
  .setup-guide__steps li:last-child {
    margin-bottom: 0;
  }
  .setup-guide__steps ul {
    margin: 0.25rem 0 0 1rem;
    padding: 0;
  }
  .setup-guide__code {
    margin: 0.4rem 0;
    padding: 0.5rem 0.75rem;
    background: color-mix(in oklab, CanvasText 8%, Canvas);
    border-radius: 4px;
    font-size: 0.8rem;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .setup-guide a {
    color: inherit;
    text-decoration: underline;
  }
```

- [ ] **Step 3: Run check + tests + build**

Run: `pnpm check && pnpm test && pnpm build`

Expected: 0 errors, 0 warnings, 164/164 tests pass. Both bundles build.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(settings): step-by-step custom-proxy setup guide inline"
```

DO NOT push. Controller pushes at end of Plan 15.

## Self-Review Checklist

- The old `<p>` referencing `templates/cf-worker/` is gone.
- The new `<details class="setup-guide">` is inside the existing Advanced disclosure (so it's only visible when the user expands Advanced backup options).
- All six numbered steps render in order.
- The `{window.location.origin}` interpolation renders the actual deployed origin (no escaping issues).
- The JSON example renders correctly (no Svelte template-literal escape issues).
- The "Raw" link to GitHub points at the project repo's main branch.
- All `<a>` tags have `target="_blank" rel="noopener noreferrer"`.
- CSS rules added; pnpm check has no new unused-selector warnings.
- Commit message exactly: `feat(settings): step-by-step custom-proxy setup guide inline`
- Only `Settings.svelte` modified.

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED
- What you implemented (briefly)
- Test/check/build results
- Commit SHA
- Any concerns

---

## Final verification

- [ ] **Step 1: Run check + test + build**

```bash
pnpm check && pnpm test && pnpm build
```

- [ ] **Step 2: Push**

```bash
git push origin main
```

---

## What's next

Plan 15 closes the in-app docs gap for custom-proxy setup. The setup guide is collapsed by default inside an already-advanced disclosure, so it doesn't clutter Settings for users who don't need it.

Remaining candidates:
- **Plan 16**: Show Details modal for backup failures.
- **Plan 17**: Banner sequencing (image first, article waits).
- **Plan 18**: PostFocus per-post backup status footer.
- **Plan 19**: cf-worker `/extract-article` endpoint via Mozilla Readability so non-helper users can hydrate articles too.

# Plan 11: Show article links in posts (with optional backed-up text expansion)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** When a saved post links to an article, show the URL (with title when known) in the rendered post — even when the article hasn't been backed up. When backup IS present, the existing collapsible "View backed-up article text" expansion still works below the link.

**Why this matters:** Today `PostBody.svelte` only renders the article block when `save.article` exists, which the parser only synthesizes from `article_text` (i.e., post-backup). Saves with linked articles but no backup show no indication of the link at all. Users can't even click through to the original. This is a UX gap unrelated to backup itself.

**Architecture:** One template change in `PostBody.svelte`. Always render an `<a>` to `save.embed.url` when present, with title (from `save.embed.title`) as the link text (falling back to the URL). Keep the existing `<details>` expansion for backed-up text, but make it conditional on `save.article?.text` rather than `save.article` so the link renders independently.

The bsky-saves `embed` shape for a post with a linked article is roughly `{url, title?, description?, thumb?}`. For Plan 11, render `url` + `title` only. `description` and `thumb` are out of scope (could add later if useful).

**Out of scope:** Thread reply embeds (the thread-reply shape doesn't include embed metadata). Quoted-post embeds (`quoted_post.embed.url` — rare, skip).

**Tech Stack:** Svelte 4, TypeScript 5. No new dependencies.

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `7dc7700` or later.

---

## Task 1: Render the article link in `PostBody.svelte`

Update `PostBody.svelte` to always show the embed link when `save.embed.url` exists, and keep the backed-up text in a collapsible.

**Files:**
- Modify: `app/src/reader/PostBody.svelte`

- [ ] **Step 1: Add a reactive declaration for the embed link**

In `app/src/reader/PostBody.svelte`'s `<script>` block, after the existing `$: quotedPost = ...` line, add:

```ts
  // Article link from save.embed.url. Present whenever the post links to an
  // external URL — regardless of whether the article has been backed up.
  $: embedLink = ((): { url: string; title: string } | null => {
    const e = save.embed as { url?: unknown; title?: unknown } | undefined;
    if (!e) return null;
    if (typeof e.url !== 'string' || !/^https?:\/\//.test(e.url)) return null;
    const title = typeof e.title === 'string' && e.title.length > 0 ? e.title : '';
    return { url: e.url, title };
  })();
```

- [ ] **Step 2: Render the link block in the template**

Find the existing article `<details>` block in the template:

```svelte
  {#if save.article}
    <details class="post-body__article">
      <summary>Linked article{save.article.title ? `: ${save.article.title}` : ''}</summary>
      <p>{save.article.text}</p>
    </details>
  {/if}
```

Replace it with:

```svelte
  {#if embedLink}
    <p class="post-body__embed-link">
      <a href={embedLink.url} target="_blank" rel="noopener noreferrer">
        {embedLink.title || embedLink.url}
      </a>
    </p>
  {/if}

  {#if save.article && save.article.text}
    <details class="post-body__article">
      <summary>View backed-up article text</summary>
      <p>{save.article.text}</p>
    </details>
  {/if}
```

Two changes:
- The link block always renders when `embedLink` is non-null (independent of backup state).
- The backup expansion now requires `save.article.text` to be non-empty (a paywalled save with `text === ''` won't render an empty expansion). Summary text changes to "View backed-up article text" since the title is already shown in the link above.

- [ ] **Step 3: Add CSS for the embed-link block**

In the `<style>` block, add a rule for the link paragraph (placement: after the existing `.post-body__images` rules and before `.post-body__article`):

```css
  .post-body__embed-link {
    margin-top: 0.5rem;
    font-size: 0.9rem;
  }
  .post-body__embed-link a {
    color: inherit;
    text-decoration: underline;
    word-break: break-word;
    opacity: 0.85;
  }
  .post-body__embed-link a:hover {
    opacity: 1;
  }
```

- [ ] **Step 4: Run check + tests + build**

Run: `pnpm check && pnpm test && pnpm build`

Expected: 0 errors, 0 warnings. 152/152 tests pass. Both bundles build.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(post-body): always show linked-article URL; backup text in collapsible"
```

DO NOT push. Controller will push at the end of Plan 11.

## Self-Review Checklist

- The link renders for any post with `save.embed.url` (a string starting with `https?://`), regardless of backup state.
- Title falls back to the URL when missing or empty.
- Backed-up text expansion requires non-empty `save.article.text` (handles the paywall case where `note: 'no extractable body'` was set with `text: ''`).
- Link opens in a new tab with `rel="noopener noreferrer"`.
- `pnpm check && pnpm test && pnpm build` all clean.
- Commit message exactly: `feat(post-body): always show linked-article URL; backup text in collapsible`
- Only `PostBody.svelte` modified.

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED
- What you implemented
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

Plan 11 closes a small but real UX gap. Plan 12 (per the candidate list) would be operator-proxy support — code + UX + opt-out + docs — which is the largest remaining piece and unblocks A-tier users on devices that can't run a helper.

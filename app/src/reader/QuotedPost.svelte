<script lang="ts">
  // bsky-saves stores quoted posts at the top-level `quoted_post` field with a
  // shape that's similar-but-not-identical to the parent save: text fields
  // appear as `text` (not `post_text`) and timestamps as `created_at` (not
  // `post_created_at`). Author is sometimes present as an object, sometimes
  // missing entirely. Render defensively from `unknown`.
  export let quote: unknown;

  function pickString(obj: unknown, ...keys: string[]): string | null {
    if (obj === null || typeof obj !== 'object') return null;
    const o = obj as Record<string, unknown>;
    for (const k of keys) {
      const v = o[k];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    return null;
  }

  $: text = pickString(quote, 'text', 'post_text') ?? '';
  $: createdAt = pickString(quote, 'created_at', 'post_created_at') ?? '';
  $: handle = pickString(
    typeof quote === 'object' && quote !== null
      ? (quote as Record<string, unknown>).author
      : null,
    'handle',
  );
  $: dateOnly = createdAt.slice(0, 10);
</script>

{#if text || handle}
  <blockquote class="quoted-post">
    <header class="quoted-post__header">
      {#if handle}<span class="quoted-post__handle">@{handle}</span>{/if}
      {#if dateOnly}<time class="quoted-post__time" datetime={createdAt}>{dateOnly}</time>{/if}
    </header>
    {#if text}
      <p class="quoted-post__text">{text}</p>
    {/if}
  </blockquote>
{/if}

<style>
  .quoted-post {
    margin: 0.75rem 0 0;
    padding: 0.75rem;
    border: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
    border-radius: 6px;
    background: color-mix(in oklab, CanvasText 4%, Canvas);
    font-size: 0.95em;
  }
  .quoted-post__header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: baseline;
    font-size: 0.875rem;
    margin-bottom: 0.4rem;
  }
  .quoted-post__handle {
    font-weight: 500;
    opacity: 0.8;
  }
  .quoted-post__time {
    margin-left: auto;
    opacity: 0.65;
    font-variant-numeric: tabular-nums;
  }
  .quoted-post__text {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
</style>

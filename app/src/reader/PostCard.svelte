<script lang="ts">
  import type { Save } from './inventory-shape';
  import { formatAuthor, formatDateTime, formatHandle } from './format';
  import PostBody from './PostBody.svelte';

  export let save: Save;
  export let onSelect: (save: Save) => void;
</script>

<article class="post-card">
  <button
    type="button"
    class="post-card__button"
    on:click={() => onSelect(save)}
    aria-label="Open post"
  >
    <header class="post-card__header">
      <span class="post-card__author">{formatAuthor(save.author)}</span>
      <span class="post-card__handle">{formatHandle(save.author.handle)}</span>
      <time class="post-card__time" datetime={save.record.createdAt}>
        {formatDateTime(save.record.createdAt)}
      </time>
    </header>
    <PostBody {save} />
  </button>
</article>

<style>
  .post-card {
    border: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
    border-radius: 8px;
    margin-bottom: 0.75rem;
    overflow: hidden;
  }
  .post-card__button {
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    width: 100%;
    padding: 1rem;
    cursor: pointer;
  }
  .post-card__button:hover {
    background: color-mix(in oklab, CanvasText 4%, Canvas);
  }
  .post-card__header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: baseline;
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
  }
  .post-card__author {
    font-weight: 600;
  }
  .post-card__handle {
    opacity: 0.7;
  }
  .post-card__time {
    margin-left: auto;
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }
  /*
   * In the Library feed (compact card), keep quoted-post images visually
   * subordinate at half the available width. PostFocus doesn't override this,
   * so quoted images render full width there.
   */
  .post-card :global(.quoted-post__images) {
    max-width: 50%;
  }
</style>

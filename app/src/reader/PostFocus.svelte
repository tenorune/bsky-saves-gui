<script lang="ts">
  import type { Save } from './inventory-shape';
  import { formatAuthor, formatDateTime, formatHandle } from './format';
  import PostBody from './PostBody.svelte';

  export let save: Save;

  $: thread = save.thread ?? [];
  $: bskyUrl = (() => {
    // Best-effort link to the original post on bsky.app: at://did/coll/rkey → /profile/handle/post/rkey
    const m = /\/([^/]+)$/.exec(save.uri);
    const rkey = m?.[1] ?? '';
    return `https://bsky.app/profile/${encodeURIComponent(save.author.handle)}/post/${encodeURIComponent(rkey)}`;
  })();
</script>

<article class="post-focus">
  <header class="post-focus__header">
    <span class="post-focus__author">{formatAuthor(save.author)}</span>
    <span class="post-focus__handle">{formatHandle(save.author.handle)}</span>
    <time class="post-focus__time" datetime={save.record.createdAt}>
      {formatDateTime(save.record.createdAt)}
    </time>
  </header>

  <PostBody {save} />

  <p class="post-focus__link">
    <a href={bskyUrl} target="_blank" rel="noopener noreferrer">View on bsky.app</a>
  </p>

  {#if thread.length > 0}
    <section class="post-focus__thread">
      <h3>Thread</h3>
      <ol>
        {#each thread as entry (entry.uri)}
          <li>
            <header>
              {#if entry.record.createdAt}
                <time datetime={entry.record.createdAt}>{formatDateTime(entry.record.createdAt)}</time>
              {/if}
            </header>
            {#if entry.record.text}
              <p class="post-focus__thread-text">{entry.record.text}</p>
            {/if}
            {#if entry.images && entry.images.length > 0}
              <div class="post-focus__thread-images">
                {#each entry.images as img}
                  <img src={img.url} alt={img.alt ?? ''} loading="lazy" />
                {/each}
              </div>
            {/if}
          </li>
        {/each}
      </ol>
    </section>
  {/if}
</article>

<style>
  /*
   * Bordered "card" container that matches PostCard exactly so a focused post
   * looks like a feed item, just with extra content (link to original, thread)
   * appended.
   */
  .post-focus {
    border: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
    border-radius: 8px;
    padding: 1rem;
    max-width: 44rem;
    margin: 0 auto;
  }
  .post-focus__header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: baseline;
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
  }
  .post-focus__author {
    font-weight: 600;
  }
  .post-focus__handle {
    opacity: 0.7;
  }
  .post-focus__time {
    margin-left: auto;
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }
  .post-focus__link {
    margin-top: 1rem;
    font-size: 0.9em;
  }
  .post-focus__thread {
    margin-top: 1.5rem;
    border-top: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
    padding-top: 1rem;
  }
  .post-focus__thread h3 {
    margin: 0 0 0.5rem;
    font-size: 0.875rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.7;
  }
  .post-focus__thread ol {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .post-focus__thread li {
    border-left: 3px solid color-mix(in oklab, CanvasText 15%, transparent);
    padding: 0.5rem 0 0.5rem 0.75rem;
    margin-bottom: 0.75rem;
  }
  .post-focus__thread header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: baseline;
    font-size: 0.875rem;
  }
  .post-focus__thread time {
    margin-left: auto;
    opacity: 0.7;
  }
  .post-focus__thread-text {
    margin: 0.25rem 0 0;
    white-space: pre-wrap;
  }
  .post-focus__thread-images {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .post-focus__thread-images img {
    width: 100%;
    border-radius: 6px;
    object-fit: cover;
  }
</style>

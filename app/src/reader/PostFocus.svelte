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
    <h2>{formatAuthor(save.author)}</h2>
    <p class="post-focus__handle">
      {formatHandle(save.author.handle)}
      <span class="post-focus__sep">·</span>
      <time datetime={save.record.createdAt}>{formatDateTime(save.record.createdAt)}</time>
    </p>
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
              <strong>{formatAuthor(entry.author)}</strong>
              <span class="post-focus__handle">{formatHandle(entry.author.handle)}</span>
              <time datetime={entry.record.createdAt}>{formatDateTime(entry.record.createdAt)}</time>
            </header>
            <p class="post-focus__thread-text">{entry.record.text}</p>
          </li>
        {/each}
      </ol>
    </section>
  {/if}
</article>

<style>
  .post-focus {
    max-width: 44rem;
    margin: 0 auto;
  }
  .post-focus__header h2 {
    margin: 0 0 0.25rem;
  }
  .post-focus__handle {
    margin: 0;
    opacity: 0.75;
    font-size: 0.95em;
  }
  .post-focus__sep {
    margin: 0 0.4em;
  }
  .post-focus__link {
    margin-top: 1rem;
    font-size: 0.9em;
  }
  .post-focus__thread {
    margin-top: 2rem;
    border-top: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
    padding-top: 1rem;
  }
  .post-focus__thread h3 {
    margin: 0 0 0.5rem;
    font-size: 1rem;
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
</style>

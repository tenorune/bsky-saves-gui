<script lang="ts">
  import type { Save } from './inventory-shape';
  import QuotedPost from './QuotedPost.svelte';
  import HydratedImage from '../components/HydratedImage.svelte';

  export let save: Save;

  type ImageEmbedView = { thumb?: string; fullsize?: string; alt?: string };

  $: text = save.record.text;
  $: localImages = save.local_images ?? [];
  $: embedImages = ((): ImageEmbedView[] => {
    const e = save.embed as { images?: ImageEmbedView[] } | undefined;
    return Array.isArray(e?.images) ? (e!.images as ImageEmbedView[]) : [];
  })();
  $: quotedPost = (save as unknown as { quoted_post?: unknown }).quoted_post ?? null;
  // Article link from save.embed.url. Present whenever the post links to an
  // external URL — regardless of whether the article has been backed up.
  $: embedLink = ((): { url: string; title: string } | null => {
    const e = save.embed as { url?: unknown; title?: unknown } | undefined;
    if (!e) return null;
    if (typeof e.url !== 'string' || !/^https?:\/\//.test(e.url)) return null;
    const title = typeof e.title === 'string' && e.title.length > 0 ? e.title : '';
    return { url: e.url, title };
  })();
</script>

<div class="post-body">
  {#if text}
    <p class="post-body__text">{text}</p>
  {/if}

  {#if localImages.length > 0}
    <div class="post-body__images">
      {#each localImages as img}
        <HydratedImage src={img.path} alt="" />
      {/each}
    </div>
  {:else if embedImages.length > 0}
    <div class="post-body__images">
      {#each embedImages as img}
        <HydratedImage src={img.fullsize ?? img.thumb ?? ''} alt={img.alt ?? ''} />
      {/each}
    </div>
  {/if}

  {#if quotedPost}
    <QuotedPost quote={quotedPost} />
  {/if}

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
</div>

<style>
  .post-body__text {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .post-body__images {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .post-body__images :global(img) {
    width: 100%;
    border-radius: 6px;
    object-fit: cover;
  }
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
  .post-body__article {
    margin-top: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: color-mix(in oklab, CanvasText 5%, Canvas);
    border-radius: 6px;
    font-size: 0.9em;
  }
  .post-body__article summary {
    cursor: pointer;
    font-weight: 500;
  }
  .post-body__article p {
    margin: 0.5rem 0 0;
    white-space: pre-wrap;
  }
</style>

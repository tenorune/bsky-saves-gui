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
</script>

<div class="post-body">
  {#if text}
    <p class="post-body__text">{text}</p>
  {/if}

  {#if embedImages.length > 0}
    <div class="post-body__images">
      {#each embedImages as img}
        <HydratedImage src={img.fullsize ?? img.thumb ?? ''} alt={img.alt ?? ''} />
      {/each}
    </div>
  {:else if localImages.length > 0}
    <div class="post-body__images">
      {#each localImages as img}
        <HydratedImage src={img.url ?? img.path} alt="" />
      {/each}
    </div>
  {/if}

  {#if quotedPost}
    <QuotedPost quote={quotedPost} />
  {/if}

  {#if save.article}
    <details class="post-body__article">
      <summary>Linked article{save.article.title ? `: ${save.article.title}` : ''}</summary>
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

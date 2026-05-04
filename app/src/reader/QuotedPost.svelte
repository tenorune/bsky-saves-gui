<script lang="ts">
  import HydratedImage from '../components/HydratedImage.svelte';
  // bsky-saves stores quoted posts at the top-level `quoted_post` field with a
  // shape that's similar-but-not-identical to the parent save: text fields
  // appear as `text` (not `post_text`) and timestamps as `created_at` (not
  // `post_created_at`). Author is sometimes present as an object, sometimes
  // missing entirely. Render defensively from `unknown`.
  export let quote: unknown;

  interface ImageRef {
    readonly url: string;
    readonly alt: string;
  }

  function pickString(obj: unknown, ...keys: string[]): string | null {
    if (obj === null || typeof obj !== 'object') return null;
    const o = obj as Record<string, unknown>;
    for (const k of keys) {
      const v = o[k];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    return null;
  }

  function pickImages(obj: unknown): ImageRef[] {
    if (obj === null || typeof obj !== 'object') return [];
    const o = obj as Record<string, unknown>;
    const out: ImageRef[] = [];

    // bsky-saves' top-level shape: images: [{url, alt, kind}].
    if (Array.isArray(o.images)) {
      for (const item of o.images as unknown[]) {
        const url = pickString(item, 'url', 'fullsize', 'thumb');
        if (!url) continue;
        const alt = pickString(item, 'alt') ?? '';
        out.push({ url, alt });
      }
      if (out.length > 0) return out;
    }

    // PostView embed shape: embed.images: [{fullsize, thumb, alt}].
    const embed = o.embed;
    if (embed && typeof embed === 'object') {
      const eImgs = (embed as Record<string, unknown>).images;
      if (Array.isArray(eImgs)) {
        for (const item of eImgs as unknown[]) {
          const url = pickString(item, 'fullsize', 'thumb', 'url');
          if (!url) continue;
          const alt = pickString(item, 'alt') ?? '';
          out.push({ url, alt });
        }
      }
    }

    // Hydrated local images: local_images: [{path, url}].
    const local = o.local_images;
    if (out.length === 0 && Array.isArray(local)) {
      for (const item of local as unknown[]) {
        const url = pickString(item, 'path', 'url');
        if (!url) continue;
        out.push({ url, alt: '' });
      }
    }

    return out;
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
  $: images = pickImages(quote);
</script>

{#if text || handle || images.length > 0}
  <blockquote class="quoted-post">
    <header class="quoted-post__header">
      {#if handle}<span class="quoted-post__handle">@{handle}</span>{/if}
      {#if dateOnly}<time class="quoted-post__time" datetime={createdAt}>{dateOnly}</time>{/if}
    </header>
    {#if text}
      <p class="quoted-post__text">{text}</p>
    {/if}
    {#if images.length > 0}
      <div class="quoted-post__images">
        {#each images as img}
          <HydratedImage src={img.url} alt={img.alt} />
        {/each}
      </div>
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
  .quoted-post__images {
    margin-top: 0.5rem;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 0.4rem;
  }
  .quoted-post__images :global(img) {
    width: 100%;
    border-radius: 4px;
    object-fit: cover;
  }
</style>


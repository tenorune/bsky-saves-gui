<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { resolveImageSrc } from '$lib/image-resolver';

  export let src: string;
  export let alt = '';

  let resolved: string = src;
  let blobUrlToRevoke: string | null = null;

  async function resolve(remote: string): Promise<void> {
    if (blobUrlToRevoke !== null) {
      URL.revokeObjectURL(blobUrlToRevoke);
      blobUrlToRevoke = null;
    }
    try {
      const result = await resolveImageSrc(remote);
      resolved = result.src;
      if (result.isBlob) blobUrlToRevoke = result.src;
    } catch {
      resolved = remote;
    }
  }

  onMount(() => {
    void resolve(src);
  });

  // Re-resolve if the bound src changes (rare in this app, but cheap).
  $: void resolve(src);

  onDestroy(() => {
    if (blobUrlToRevoke !== null) URL.revokeObjectURL(blobUrlToRevoke);
  });
</script>

<!--
  Intentionally unstyled: parent components (PostBody, QuotedPost, PostFocus)
  carry the grid/sizing rules and target the inner <img> via :global(img).
-->
<img src={resolved} {alt} loading="lazy" />

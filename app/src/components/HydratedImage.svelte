<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { loadImageBlob } from '$lib/image-store';

  export let src: string;
  export let alt: string = '';

  let resolved: string = src;
  let objectUrl: string | null = null;

  async function resolve(remote: string): Promise<void> {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    try {
      const blob = await loadImageBlob(remote);
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        resolved = objectUrl;
      } else {
        resolved = remote;
      }
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
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });
</script>

<!--
  Intentionally unstyled: parent components (PostBody, QuotedPost, PostFocus)
  already have grid/sizing rules targeting `img` inside their own scope. We
  pass through with a `:global(img)` selector at each call site.
-->
<img src={resolved} {alt} loading="lazy" />

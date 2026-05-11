<script lang="ts">
  // Live-app-only widget shown beneath a focused post: backup-status footer
  // + failures-modal trigger. Imported only by the live Post route so the
  // archive bundle never pulls in describe-backend, hydration-state, or the
  // failures modal.

  import type { Save } from '../reader/inventory-shape';
  import { imageHydration, articleHydration } from '$lib/hydration-state';
  import { getSavedImageUrls } from '$lib/image-store';
  import { getPostBackupStatus } from '$lib/post-backup-status';
  import { extractImageUrlsFromSave } from '$lib/extract-image-urls';
  import { clearLibraryScroll } from '$lib/library-scroll';
  import { navigate } from '$lib/router';

  function openLibrary(e: MouseEvent): void {
    e.preventDefault();
    clearLibraryScroll();
    navigate('/library');
  }
  function openSettings(e: MouseEvent): void {
    e.preventDefault();
    navigate('/settings');
  }
  import BackupFailuresModal from './BackupFailuresModal.svelte';
  import { describeAvailableImageBackend, describeArticleBackend } from '$lib/describe-backend';

  export let save: Save;

  function articleUrlForSave(s: Save): string | null {
    const embed = (s as Record<string, unknown>).embed;
    if (!embed || typeof embed !== 'object') return null;
    const url = (embed as Record<string, unknown>).url;
    return typeof url === 'string' && /^https?:\/\//.test(url) ? url : null;
  }

  // Image URLs reachable from the save: the post itself, the quoted
  // post, and any thread replies (including the quoted post's thread).
  // Mirrors bsky-saves' image-iteration so backup-status reflects every
  // image the user can see when reading the post.
  $: imageUrls = extractImageUrlsFromSave(save);
  $: articleUrl = articleUrlForSave(save);

  let savedImageUrls = new Set<string>();

  $: void (async () => {
    void $imageHydration.fetched;
    savedImageUrls = await getSavedImageUrls(imageUrls);
  })();

  let setupAvailable = false;

  $: void (async () => {
    void $imageHydration.status;
    void $articleHydration.status;
    const img = await describeAvailableImageBackend();
    const art = await describeArticleBackend();
    setupAvailable = img !== null || art.available;
  })();

  $: status = getPostBackupStatus({
    save,
    imageUrlsInPost: imageUrls,
    articleUrlInPost: articleUrl,
    savedImageUrls,
    imageHydration: $imageHydration,
    articleHydration: $articleHydration,
    setupAvailable,
  });

  let failuresOpen = false;

  $: postScopedFailures = [
    ...$imageHydration.failures
      .filter((f) => imageUrls.includes(f.url))
      .map((f) => ({ ...f, type: 'image' as const })),
    ...$articleHydration.failures
      .filter((f) => f.url === articleUrl)
      .map((f) => ({ ...f, type: 'article' as const })),
  ];

  // Subject phrase for the library-link branch: "Image" / "Images" /
  // "Article" / "Image and Article" / "Images and Article". Same logic
  // as in post-backup-status.ts; duplicated here so the link can be
  // rendered as a real anchor (with a click handler that clears the
  // saved Library scroll) rather than parsed out of the summary text.
  $: librarySubject = (() => {
    const hasImages = status.images.total > 0;
    const hasArticle = status.article !== null;
    const imageWord = status.images.total === 1 ? 'Image' : 'Images';
    if (hasImages && hasArticle) return `${imageWord} and Article`;
    if (hasImages) return imageWord;
    return 'Article';
  })();
</script>

{#if status.hasAssets}
  <footer
    class="post-backup-overlay"
    class:post-backup-overlay--failed={status.anyFailed}
    aria-label="Backup status"
  >
    {#if status.anyFailed}
      <button
        type="button"
        class="post-backup-overlay__button"
        on:click={() => (failuresOpen = true)}
      >
        {status.summary}
      </button>
    {:else if status.link === 'library'}
      {librarySubject} not yet backed up in your <a class="post-backup-overlay__button" href="#/library" on:click={openLibrary}>Library</a>.
    {:else if status.link === 'setup'}
      Not yet saved — <a class="post-backup-overlay__button" href="#/settings" on:click={openSettings}>set up a backend</a>.
    {:else}
      {status.summary}
    {/if}
  </footer>
{/if}

<BackupFailuresModal
  open={failuresOpen}
  failures={postScopedFailures}
  inventory={{ saves: [save] }}
  title="Backup failures for this post"
  on:close={() => (failuresOpen = false)}
/>

<style>
  .post-backup-overlay {
    margin-top: 0.5rem;
    font-size: 0.85rem;
    opacity: 0.7;
  }
  .post-backup-overlay--failed {
    color: color-mix(in oklab, red 70%, CanvasText);
    opacity: 0.95;
  }
  .post-backup-overlay__button {
    font: inherit;
    color: inherit;
    background: none;
    border: 0;
    padding: 0;
    text-align: left;
    cursor: pointer;
    text-decoration: underline;
  }
  .post-backup-overlay__button:hover {
    text-decoration: none;
  }
</style>

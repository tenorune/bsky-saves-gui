<script lang="ts">
  import { imageHydration } from '$lib/hydration-state';
  import { startImageBackup, cancelImageBackup } from '$lib/start-image-backup';
  import { articleHydration } from '$lib/hydration-state';
  import { startArticleBackup, cancelArticleBackup } from '$lib/start-article-backup';
  import BackupFailuresModal from './BackupFailuresModal.svelte';

  /** Inventory the backup operates on. Required. */
  export let inventory: unknown;

  let busy = false;
  let errorMessage = '';

  async function handleStart() {
    if (busy) return;
    errorMessage = '';
    busy = true;
    try {
      const result = await startImageBackup(inventory);
      if (!result.started) {
        errorMessage = result.reason ?? 'Could not start backup.';
      }
    } finally {
      busy = false;
    }
  }

  function handleStop() {
    cancelImageBackup();
  }

  function dismissError() {
    errorMessage = '';
  }

  $: status = $imageHydration.status;
  $: total = $imageHydration.total;
  $: fetched = $imageHydration.fetched;
  $: skipped = $imageHydration.skipped;
  $: failed = $imageHydration.failed;
  $: succeeded = fetched + skipped;

  $: aStatus = $articleHydration.status;
  $: aTotal = $articleHydration.total;
  $: aFetched = $articleHydration.fetched;
  $: aSkipped = $articleHydration.skipped;
  $: aFailed = $articleHydration.failed;
  $: aSucceeded = aFetched + aSkipped;

  let articleBusy = false;
  let articleErrorMessage = '';

  let imageFailuresOpen = false;
  let articleFailuresOpen = false;

  $: imageFailuresRows = $imageHydration.failures.map((f) => ({
    ...f,
    type: 'image' as const,
  }));
  $: articleFailuresRows = $articleHydration.failures.map((f) => ({
    ...f,
    type: 'article' as const,
  }));

  async function handleStartArticles() {
    if (articleBusy) return;
    articleErrorMessage = '';
    articleBusy = true;
    try {
      const result = await startArticleBackup(inventory);
      if (!result.started) {
        articleErrorMessage = result.reason ?? 'Could not start article backup.';
      }
    } finally {
      articleBusy = false;
    }
  }

  function handleStopArticles() {
    cancelArticleBackup();
  }

  function dismissArticleError() {
    articleErrorMessage = '';
  }
</script>

{#if status !== 'idle' || aStatus !== 'idle'}
  <div class="backup-status">
    {#if errorMessage}
      <div class="backup-status__error" role="alert">
        <span>{errorMessage}</span>
        <button type="button" class="backup-status__dismiss" on:click={dismissError}>Dismiss</button>
      </div>
    {/if}
    {#if articleErrorMessage}
      <div class="backup-status__error" role="alert">
        <span>{articleErrorMessage}</span>
        <button type="button" class="backup-status__dismiss" on:click={dismissArticleError}>Dismiss</button>
      </div>
    {/if}

    {#if status === 'running'}
      <p class="backup-status__line">
        Saving images: {succeeded} of {total}
        {#if failed > 0}
          (<button type="button" class="backup-status__failed-link" on:click={() => (imageFailuresOpen = true)}>{failed} failed</button>)
        {/if}
      </p>
      <button type="button" on:click={handleStop}>Stop</button>
    {:else if status === 'done' && total > 0}
      {#if failed === 0}
        <p class="backup-status__line">All {total} images saved.</p>
        <button type="button" on:click={handleStart} disabled={busy}>Re-check</button>
      {:else}
        <p class="backup-status__line">
          {succeeded} of {total} images saved
          (<button type="button" class="backup-status__failed-link" on:click={() => (imageFailuresOpen = true)}>{failed} failed</button>)
        </p>
        <button type="button" on:click={handleStart} disabled={busy}>Retry</button>
      {/if}
    {:else if status === 'cancelled'}
      <p class="backup-status__line">
        Stopped at {succeeded} of {total} images
        {#if failed > 0}
          (<button type="button" class="backup-status__failed-link" on:click={() => (imageFailuresOpen = true)}>{failed} failed</button>)
        {/if}
      </p>
      <button type="button" on:click={handleStart} disabled={busy}>Resume</button>
    {/if}

    {#if aStatus === 'running'}
      <p class="backup-status__line">
        Saving articles: {aSucceeded} of {aTotal}
        {#if aFailed > 0}
          (<button type="button" class="backup-status__failed-link" on:click={() => (articleFailuresOpen = true)}>{aFailed} failed</button>)
        {/if}
      </p>
      <button type="button" on:click={handleStopArticles}>Stop</button>
    {:else if aStatus === 'done' && aTotal > 0}
      {#if aFailed === 0}
        <p class="backup-status__line">All {aTotal} articles saved.</p>
        <button type="button" on:click={handleStartArticles} disabled={articleBusy}>Re-check</button>
      {:else}
        <p class="backup-status__line">
          {aSucceeded} of {aTotal} articles saved
          (<button type="button" class="backup-status__failed-link" on:click={() => (articleFailuresOpen = true)}>{aFailed} failed</button>)
        </p>
        <button type="button" on:click={handleStartArticles} disabled={articleBusy}>Retry</button>
      {/if}
    {:else if aStatus === 'cancelled'}
      <p class="backup-status__line">
        Stopped at {aSucceeded} of {aTotal} articles
        {#if aFailed > 0}
          (<button type="button" class="backup-status__failed-link" on:click={() => (articleFailuresOpen = true)}>{aFailed} failed</button>)
        {/if}
      </p>
      <button type="button" on:click={handleStartArticles} disabled={articleBusy}>Resume</button>
    {/if}
  </div>
{/if}

<BackupFailuresModal
  open={imageFailuresOpen}
  failures={imageFailuresRows}
  {inventory}
  title="Image backup failures"
  on:close={() => (imageFailuresOpen = false)}
/>
<BackupFailuresModal
  open={articleFailuresOpen}
  failures={articleFailuresRows}
  {inventory}
  title="Article backup failures"
  on:close={() => (articleFailuresOpen = false)}
/>

<style>
  .backup-status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
    border-radius: 6px;
    background: color-mix(in oklab, CanvasText 4%, Canvas);
    font-size: 0.9rem;
  }
  .backup-status__line {
    margin: 0;
    flex: 1;
  }
  .backup-status button {
    font: inherit;
    padding: 0.35rem 0.75rem;
    border: 1px solid color-mix(in oklab, CanvasText 25%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
  }
  .backup-status button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .backup-status__error {
    flex-basis: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    color: color-mix(in oklab, red 70%, CanvasText);
    font-weight: 500;
  }
  .backup-status__dismiss {
    margin-left: auto;
  }
  .backup-status__failed-link {
    font: inherit;
    background: none;
    border: 0;
    padding: 0;
    color: color-mix(in oklab, red 70%, CanvasText);
    text-decoration: underline;
    cursor: pointer;
  }
  .backup-status__failed-link:hover {
    text-decoration: none;
  }
</style>

<script lang="ts">
  import { imageHydration } from '$lib/hydration-state';
  import { startImageBackup, cancelImageBackup } from '$lib/start-image-backup';

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
</script>

<div class="backup-status">
  {#if errorMessage}
    <div class="backup-status__error" role="alert">
      <span>{errorMessage}</span>
      <button type="button" class="backup-status__dismiss" on:click={dismissError}>Dismiss</button>
    </div>
  {/if}

  {#if status === 'idle'}
    <button
      type="button"
      class="backup-status__primary"
      on:click={handleStart}
      disabled={busy}
    >
      Save my own copy of images
    </button>
  {:else if status === 'running'}
    <p class="backup-status__line">
      Saving images: {succeeded} of {total}
      {#if failed > 0}({failed} failed){/if}
    </p>
    <button type="button" on:click={handleStop}>Stop</button>
  {:else if status === 'done'}
    {#if total === 0}
      <!-- nothing to back up; suppress the row -->
    {:else if failed === 0}
      <p class="backup-status__line">All {total} images saved.</p>
      <button type="button" on:click={handleStart} disabled={busy}>Re-check</button>
    {:else}
      <p class="backup-status__line">
        {succeeded} of {total} images saved ({failed} failed)
      </p>
      <button type="button" on:click={handleStart} disabled={busy}>Retry</button>
    {/if}
  {:else if status === 'cancelled'}
    <p class="backup-status__line">
      Stopped at {succeeded} of {total} images
      {#if failed > 0}({failed} failed){/if}
    </p>
    <button type="button" on:click={handleStart} disabled={busy}>Resume</button>
  {/if}
</div>

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
  .backup-status__primary {
    font-weight: 600;
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
</style>

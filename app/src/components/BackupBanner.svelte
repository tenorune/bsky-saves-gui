<script lang="ts">
  import { onMount } from 'svelte';
  import { extractImageUrls } from '$lib/extract-image-urls';
  import {
    shouldShowBackupBanner,
    snoozeBackupPrompt,
    setBackupDontAsk,
  } from '$lib/backup-prefs';
  import { imageHydration } from '$lib/hydration-state';
  import { startImageBackup } from '$lib/start-image-backup';
  import { describeAvailableImageBackend } from '$lib/describe-backend';

  /** Inventory the banner observes for image content. Required. */
  export let inventory: unknown;

  let prefsAllow = false; // false until we've loaded prefs once
  let busy = false;
  let startError = '';
  let backendDesc: string | null = null;

  onMount(async () => {
    prefsAllow = await shouldShowBackupBanner('images');
    backendDesc = await describeAvailableImageBackend();
  });

  async function handleSave() {
    if (busy) return;
    busy = true;
    startError = '';
    try {
      const result = await startImageBackup(inventory);
      if (!result.started) {
        startError = result.reason ?? 'Could not start backup.';
      }
    } finally {
      busy = false;
    }
  }

  async function handleSnooze() {
    await snoozeBackupPrompt('images');
    prefsAllow = false;
  }

  async function handleDontAsk() {
    await setBackupDontAsk('images', true);
    prefsAllow = false;
  }

  $: imageCount = extractImageUrls(inventory).length;
  $: status = $imageHydration.status;
  $: visible = prefsAllow && imageCount > 0 && status === 'idle';
</script>

{#if visible}
  <div class="backup-banner" role="region" aria-label="Image backup suggestion">
    <p class="backup-banner__text">
      {imageCount} of your saves include images. They'll work as long as Bluesky keeps
      them online. Save your own copy →
    </p>
    <p class="backup-banner__sub">
      {#if backendDesc}
        Will use {backendDesc}.
      {:else}
        No backup method is available — set up the local helper or a custom Cloudflare Worker first (Settings → Backup → Advanced).
      {/if}
    </p>
    <div class="backup-banner__actions">
      <button
        type="button"
        class="backup-banner__primary"
        on:click={handleSave}
        disabled={busy}
      >
        Save my own copy →
      </button>
      <button type="button" class="backup-banner__link" on:click={handleSnooze}>
        Remind me later
      </button>
      <button type="button" class="backup-banner__link" on:click={handleDontAsk}>
        Don't ask me again
      </button>
    </div>
    {#if startError}
      <p class="backup-banner__error" role="alert">{startError}</p>
    {/if}
  </div>
{/if}

<style>
  .backup-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
    padding: 0.75rem 1rem;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 8px;
    background: color-mix(in oklab, CanvasText 6%, Canvas);
  }
  .backup-banner__text {
    margin: 0;
    flex: 1 1 18rem;
    font-size: 0.95rem;
  }
  .backup-banner__actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .backup-banner__primary {
    font: inherit;
    font-weight: 600;
    padding: 0.4rem 0.85rem;
    border: 1px solid color-mix(in oklab, CanvasText 30%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
  }
  .backup-banner__primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .backup-banner__link {
    font: inherit;
    font-size: 0.875rem;
    background: none;
    border: 0;
    padding: 0.25rem 0.4rem;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
    opacity: 0.85;
  }
  .backup-banner__link:hover {
    opacity: 1;
  }
  .backup-banner__sub {
    flex-basis: 100%;
    margin: 0;
    font-size: 0.85rem;
    opacity: 0.75;
  }
  .backup-banner__error {
    flex-basis: 100%;
    margin: 0;
    color: color-mix(in oklab, red 70%, CanvasText);
    font-weight: 500;
  }
</style>

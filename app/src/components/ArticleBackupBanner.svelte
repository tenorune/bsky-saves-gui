<script lang="ts">
  import { onMount } from 'svelte';
  import { extractArticleUrls } from '$lib/extract-article-urls';
  import {
    shouldShowBackupBanner,
    snoozeBackupPrompt,
    setBackupDontAsk,
  } from '$lib/backup-prefs';
  import { articleHydration } from '$lib/hydration-state';
  import { startArticleBackup } from '$lib/start-article-backup';
  import { describeArticleBackend } from '$lib/describe-backend';

  /** Inventory the banner observes for article content. Required. */
  export let inventory: unknown;

  let prefsAllow = false; // false until we've loaded prefs once
  let busy = false;
  let startError = '';
  let articleBackendStatus: { available: boolean; description: string } = {
    available: false,
    description: 'the local helper is not running',
  };

  onMount(async () => {
    prefsAllow = await shouldShowBackupBanner('articles');
    articleBackendStatus = await describeArticleBackend();
  });

  async function handleSave() {
    if (busy) return;
    busy = true;
    startError = '';
    try {
      const result = await startArticleBackup(inventory);
      if (!result.started) {
        startError = result.reason ?? 'Could not start article backup.';
      }
    } finally {
      busy = false;
    }
  }

  async function handleSnooze() {
    await snoozeBackupPrompt('articles');
    prefsAllow = false;
  }

  async function handleDontAsk() {
    await setBackupDontAsk('articles', true);
    prefsAllow = false;
  }

  $: articleCount = extractArticleUrls(inventory).length;
  $: status = $articleHydration.status;
  $: visible = prefsAllow && articleCount > 0 && status === 'idle';
</script>

{#if visible}
  <div class="article-banner" role="region" aria-label="Article backup suggestion">
    <p class="article-banner__text">
      {articleCount} of your saves link to articles. Save the full article
      text so it doesn't disappear if the source goes away. Set up backup →
    </p>
    <p class="article-banner__sub">
      {#if articleBackendStatus.available}
        Will use {articleBackendStatus.description}.
      {:else}
        Article backup needs the local bsky-saves helper — currently {articleBackendStatus.description}.
      {/if}
    </p>
    <div class="article-banner__actions">
      <button
        type="button"
        class="article-banner__primary"
        on:click={handleSave}
        disabled={busy}
      >
        Set up backup →
      </button>
      <button type="button" class="article-banner__link" on:click={handleSnooze}>
        Remind me later
      </button>
      <button type="button" class="article-banner__link" on:click={handleDontAsk}>
        Don't ask me again
      </button>
    </div>
    {#if startError}
      <p class="article-banner__error" role="alert">{startError}</p>
    {/if}
  </div>
{/if}

<style>
  .article-banner {
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
  .article-banner__text {
    margin: 0;
    flex: 1 1 18rem;
    font-size: 0.95rem;
  }
  .article-banner__sub {
    margin: 0;
    flex-basis: 100%;
    font-size: 0.85rem;
    opacity: 0.75;
  }
  .article-banner__actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .article-banner__primary {
    font: inherit;
    font-weight: 600;
    padding: 0.4rem 0.85rem;
    border: 1px solid color-mix(in oklab, CanvasText 30%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
  }
  .article-banner__primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .article-banner__link {
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
  .article-banner__link:hover {
    opacity: 1;
  }
  .article-banner__error {
    flex-basis: 100%;
    margin: 0;
    color: color-mix(in oklab, red 70%, CanvasText);
    font-weight: 500;
  }
</style>

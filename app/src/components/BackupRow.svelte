<script lang="ts">
  import { onMount } from 'svelte';
  import { imageHydration, articleHydration, type HydrationProgress } from '$lib/hydration-state';
  import { startImageBackup, cancelImageBackup } from '$lib/start-image-backup';
  import { startArticleBackup, cancelArticleBackup } from '$lib/start-article-backup';
  import { describeAvailableImageBackend, describeArticleBackend } from '$lib/describe-backend';
  import { loadBackupPrefs, setBackupDontAsk, type BackupPrefs } from '$lib/backup-prefs';
  import { buildBackupStatusLine } from '$lib/backup-status-line';
  import BackupFailuresModal from './BackupFailuresModal.svelte';
  import CustomProxySetupModal from './CustomProxySetupModal.svelte';

  export let domain: 'images' | 'articles';
  export let inventory: unknown;
  export let mode: 'library' | 'settings';

  let backupPrefs: BackupPrefs | null = null;
  let backendDescription: string | null = null;
  let busy = false;
  let errorMessage = '';
  let failuresOpen = false;
  let setupOpen = false;
  let confirmation = '';

  $: store = domain === 'images' ? imageHydration : articleHydration;
  $: hydration = $store as HydrationProgress;
  $: status = hydration.status;

  $: dontAsk = backupPrefs
    ? domain === 'images'
      ? backupPrefs.images.dontAsk
      : backupPrefs.articles.dontAsk
    : false;

  $: line = buildBackupStatusLine({ domain, hydration, backendDescription });

  $: visible = mode === 'settings' || status !== 'idle';

  $: failedFailures = hydration.failures.map((f) => ({
    ...f,
    type: domain === 'images' ? ('image' as const) : ('article' as const),
  }));

  $: title = domain === 'images' ? 'Images' : 'Articles';
  $: backendAvailable = backendDescription !== null;

  async function refreshBackend() {
    if (domain === 'images') {
      backendDescription = await describeAvailableImageBackend();
    } else {
      const r = await describeArticleBackend();
      backendDescription = r.available ? r.description : null;
    }
  }

  async function reloadPrefs() {
    backupPrefs = await loadBackupPrefs();
  }

  onMount(async () => {
    await reloadPrefs();
    await refreshBackend();
  });

  $: void (async () => {
    void hydration.status;
    await refreshBackend();
  })();

  function showConfirmation(message: string) {
    confirmation = message;
    setTimeout(() => {
      if (confirmation === message) confirmation = '';
    }, 2500);
  }

  function waitForRunCompletion(): Promise<HydrationProgress> {
    const s = domain === 'images' ? imageHydration : articleHydration;
    return new Promise((resolve) => {
      let firstCall = true;
      const unsub = s.subscribe((current) => {
        // Skip the synchronous initial callback Svelte fires on subscribe.
        if (firstCall) {
          firstCall = false;
          return;
        }
        if (current.status === 'done' || current.status === 'cancelled') {
          unsub();
          resolve(current);
        }
      });
    });
  }

  async function handleStart() {
    if (busy || status === 'running') return;
    errorMessage = '';
    busy = true;
    try {
      const result = domain === 'images'
        ? await startImageBackup(inventory)
        : await startArticleBackup(inventory);
      if (!result.started) {
        errorMessage = result.reason ?? 'Could not start backup.';
        return;
      }
      await reloadPrefs();
      const final = await waitForRunCompletion();
      if (final.status === 'cancelled') {
        showConfirmation('✓ Stopped');
      } else if (final.fetched === 0 && final.failed === 0) {
        showConfirmation('✓ Already up to date');
      } else if (final.fetched > 0 && final.failed === 0) {
        showConfirmation('✓ Done');
      }
    } finally {
      busy = false;
    }
  }

  function handleStop() {
    if (domain === 'images') cancelImageBackup();
    else cancelArticleBackup();
  }

  async function handleToggleDontAsk(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    await setBackupDontAsk(domain, checked);
    await reloadPrefs();
  }

  function dismissError() {
    errorMessage = '';
  }
</script>

{#if visible}
  <div class="backup-row">
    {#if mode === 'settings'}
      <h4 class="backup-row__title">{title}</h4>
    {/if}

    <p class="backup-row__line">
      {line.text}
      {#if status === 'done' && hydration.failed > 0}
        (<button
          type="button"
          class="backup-row__failed-link"
          on:click={() => (failuresOpen = true)}
        >{hydration.failed} failed</button>)
      {/if}
      {#if confirmation}
        <span class="backup-row__confirmation">{confirmation}</span>
      {/if}
    </p>

    {#if mode === 'settings'}
      <div class="backup-row__actions">
        {#if !backendAvailable}
          <button type="button" on:click={() => (setupOpen = true)}>Set up a backend</button>
        {:else if status === 'running'}
          <button type="button" on:click={handleStop}>Stop</button>
        {:else}
          <button type="button" on:click={handleStart} disabled={busy}>Save my own copy</button>
        {/if}
        <label class="backup-row__hide">
          <input type="checkbox" checked={dontAsk} on:change={handleToggleDontAsk} />
          <span>Hide reminder</span>
        </label>
      </div>
    {/if}

    {#if errorMessage}
      <div class="backup-row__error" role="alert">
        <span>{errorMessage}</span>
        <button type="button" class="backup-row__dismiss" on:click={dismissError}>Dismiss</button>
      </div>
    {/if}
  </div>
{/if}

<BackupFailuresModal
  open={failuresOpen}
  failures={failedFailures}
  {inventory}
  title={domain === 'images' ? 'Image backup failures' : 'Article backup failures'}
  on:close={() => (failuresOpen = false)}
/>
<CustomProxySetupModal
  open={setupOpen}
  on:close={() => (setupOpen = false)}
  on:change={refreshBackend}
/>

<style>
  .backup-row {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.5rem 0;
    margin-bottom: 0.75rem;
  }
  .backup-row__line {
    margin: 0;
    font-size: 0.9rem;
  }
  .backup-row__actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .backup-row__actions button {
    font: inherit;
    padding: 0.4rem 0.85rem;
    border: 1px solid color-mix(in oklab, CanvasText 25%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
  }
  .backup-row__actions button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .backup-row__hide {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.875rem;
    opacity: 0.85;
  }
  .backup-row__failed-link {
    font: inherit;
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .backup-row__failed-link {
    color: color-mix(in oklab, red 70%, CanvasText);
  }
  .backup-row__error {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: color-mix(in oklab, red 70%, CanvasText);
  }
  .backup-row__dismiss {
    font: inherit;
    background: none;
    border: 0;
    padding: 0 0.25rem;
    color: inherit;
    cursor: pointer;
    text-decoration: underline;
    opacity: 0.85;
  }
  .backup-row__title {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
  }
  .backup-row__confirmation {
    margin-left: 0.4rem;
    color: color-mix(in oklab, green 70%, CanvasText);
    font-weight: 500;
    font-size: 0.85rem;
  }
</style>

<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { inventoryState, loadFromDb } from '$lib/inventory-loader';
  import { saveInventory, clearInventory } from '$lib/inventory-store';
  import { clearCredentials } from '$lib/credentials-store';
  import { clearAccount } from '$lib/account-store';
  import { lastSession, clearLastSession } from '$lib/last-session';
  import { clearBeaconSent } from '$lib/beacon';
  import { loadProxyConfig, saveProxyConfig, clearProxyConfig } from '$lib/proxy-config';
  import {
    loadBackupPrefs,
    setBackupDontAsk,
    setBackupEnabled,
    setOperatorProxyOptOut,
    clearBackupPrefs,
    type BackupPrefs,
  } from '$lib/backup-prefs';
  import { config } from '$lib/config';
  import { detectBackends, type Backend } from '$lib/image-fetcher';
  import { describeAvailableImageBackend, describeArticleBackend } from '$lib/describe-backend';
  import { cancelImageBackup } from '$lib/start-image-backup';
  import { startArticleBackup, cancelArticleBackup } from '$lib/start-article-backup';
  import { clearImageBlobs } from '$lib/image-store';
  import { resetImageHydration, resetArticleHydration } from '$lib/hydration-state';
  import { exportJson } from '../exporters/json-exporter';
  import { downloadFile } from '../exporters/file-download';
  import { parseInventory } from '../reader/inventory-shape';
  import { navigate } from '$lib/router';
  import CustomProxySetupModal from '../components/CustomProxySetupModal.svelte';

  let status = '';
  let error = '';
  let importInputEl: HTMLInputElement | undefined;

  let backupPrefs: BackupPrefs | null = null;
  let detectedBackends: Backend[] = [];
  let availableImageBackendDesc: string | null = null;
  let articleBackendStatus: { available: boolean; description: string } = {
    available: false,
    description: 'the local helper is not running',
  };
  let backupAdvancedOpen = false;
  let setupModalOpen = false;
  let workerUrl = '';
  let workerSecret = '';

  onMount(async () => {
    backupPrefs = await loadBackupPrefs();
    detectedBackends = await detectBackends();
    availableImageBackendDesc = await describeAvailableImageBackend();
    articleBackendStatus = await describeArticleBackend();
    const cfg = await loadProxyConfig();
    if (cfg) {
      workerUrl = cfg.url;
      workerSecret = cfg.sharedSecret;
    }
    void probeOperatorProxy();
  });

  let operatorProxyReachable: 'unknown' | 'ok' | 'fail' = 'unknown';

  $: operatorProxyConfigured = config.operatorImageProxyUrl !== '';
  $: operatorProxyOptOut = backupPrefs?.operatorProxyOptOut ?? false;

  async function probeOperatorProxy(): Promise<void> {
    if (!operatorProxyConfigured) return;
    operatorProxyReachable = 'unknown';
    try {
      const url = config.operatorImageProxyUrl.replace(/\/+$/, '') + '/fetch';
      const res = await fetch(url, {
        method: 'OPTIONS',
        headers: { Origin: window.location.origin },
      });
      operatorProxyReachable = res.status === 204 ? 'ok' : 'fail';
    } catch {
      operatorProxyReachable = 'fail';
    }
  }

  async function handleToggleOperatorProxyOptOut(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    await setOperatorProxyOptOut(checked);
    await reloadBackupPrefs();
    detectedBackends = await detectBackends();
    availableImageBackendDesc = await describeAvailableImageBackend();
  }

  $: imagesEnabled = backupPrefs?.images.enabled ?? false;
  $: imagesDontAsk = backupPrefs?.images.dontAsk ?? false;
  $: articlesEnabled = backupPrefs?.articles.enabled ?? false;
  $: articlesDontAsk = backupPrefs?.articles.dontAsk ?? false;
  $: backupSectionVisible =
    imagesEnabled ||
    imagesDontAsk ||
    (backupPrefs?.images.snoozeUntil ?? null) !== null ||
    articlesEnabled ||
    articlesDontAsk ||
    (backupPrefs?.articles.snoozeUntil ?? null) !== null;
  $: helperBackend = detectedBackends.find((b) => b.kind === 'helper');
  $: workerBackend = detectedBackends.find((b) => b.kind === 'user-worker');
  $: imagesBackendLabel = imagesEnabled
    ? helperBackend
      ? `using local helper (bsky-saves ${helperBackend.version})`
      : workerBackend
        ? 'using your custom Cloudflare Worker'
        : detectedBackends.find((b) => b.kind === 'operator-proxy')
          ? "using the operator's image proxy"
          : 'no backend reachable right now'
    : availableImageBackendDesc !== null
      ? `not yet enabled — would use ${availableImageBackendDesc}`
      : 'not set up — no backend available';

  $: articlesBackendLabel = articlesEnabled
    ? helperBackend
      ? `using local helper (bsky-saves ${helperBackend.version})`
      : 'no helper running'
    : articleBackendStatus.available
      ? `not yet enabled — would use ${articleBackendStatus.description}`
      : `not set up — ${articleBackendStatus.description}`;

  async function reloadBackupPrefs() {
    backupPrefs = await loadBackupPrefs();
  }

  async function handleDisableImages() {
    cancelImageBackup();
    await setBackupEnabled('images', false);
    await reloadBackupPrefs();
  }

  async function handleToggleDontAsk(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    await setBackupDontAsk('images', checked);
    await reloadBackupPrefs();
  }

  async function handleSaveWorker() {
    if (!workerUrl || !workerSecret) return;
    await saveProxyConfig({ url: workerUrl, sharedSecret: workerSecret });
    detectedBackends = await detectBackends();
    availableImageBackendDesc = await describeAvailableImageBackend();
    status = 'Worker config saved.';
  }

  async function handleClearWorker() {
    await clearProxyConfig();
    workerUrl = '';
    workerSecret = '';
    detectedBackends = await detectBackends();
    availableImageBackendDesc = await describeAvailableImageBackend();
    status = 'Worker config cleared.';
  }

  let articleSetupError = '';

  async function handleSetUpArticles() {
    if (backupPrefs === null) return;
    articleSetupError = '';
    const state = get(inventoryState);
    if (state.status !== 'ready') {
      articleSetupError = 'No library loaded.';
      return;
    }
    const result = await startArticleBackup(state.inventory);
    if (!result.started) {
      articleSetupError = result.reason ?? 'Could not start article backup.';
      return;
    }
    await reloadBackupPrefs();
  }

  async function handleDisableArticles() {
    cancelArticleBackup();
    await setBackupEnabled('articles', false);
    await reloadBackupPrefs();
  }

  async function handleToggleArticlesDontAsk(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    await setBackupDontAsk('articles', checked);
    await reloadBackupPrefs();
  }

  $: libraryFetchedAt = (() => {
    const s = $inventoryState;
    if (s.status !== 'ready') return null;
    const f = s.inventory.fetched_at;
    return typeof f === 'string' && f.length >= 10 ? f.slice(0, 10) : null;
  })();

  async function exportInventory() {
    error = '';
    const s = get(inventoryState);
    if (s.status !== 'ready') {
      error = 'No inventory loaded.';
      return;
    }
    const r = await exportJson(s.inventory);
    downloadFile(r.blob, r.filename);
  }

  async function importInventory(e: Event) {
    error = '';
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseInventory(JSON.parse(text));
      await saveInventory(parsed);
      await loadFromDb();
      status = `Imported ${parsed.saves.length} saves.`;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Import failed';
    } finally {
      input.value = '';
    }
  }

  async function clearAll() {
    if (!confirm('Clear inventory, saved credentials, backup state, and beacon state? This cannot be undone.')) {
      return;
    }
    cancelImageBackup();
    cancelArticleBackup();
    await Promise.all([
      clearInventory(),
      clearCredentials(),
      clearProxyConfig(),
      clearBeaconSent(),
      clearAccount(),
      clearBackupPrefs(),
      clearImageBlobs(),
    ]);
    clearLastSession();
    resetImageHydration();
    resetArticleHydration();
    // Refresh local UI state so the Backup section disappears immediately.
    backupPrefs = await loadBackupPrefs();
    detectedBackends = await detectBackends();
    workerUrl = '';
    workerSecret = '';
    operatorProxyReachable = 'unknown';
    void probeOperatorProxy();
    await loadFromDb();
    status = 'All local data cleared.';
  }

  function signOut() {
    // Sign out clears only the session token. Inventory, saved credentials,
    // and account label all stay so the user can sign in again and pick up
    // where they left off. To wipe everything, use "Clear all local data".
    clearLastSession();
    navigate('/');
  }
</script>

<section class="route route--settings">
  <header class="route__header">
    <h2 class="route__title">Settings</h2>
  </header>

  {#if status}
    <p class="status">{status}</p>
  {/if}
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  <section class="settings-section">
    <h3>Account</h3>
    {#if $lastSession}
      <p class="help">
        Signed in as <code>@{$lastSession.handle}</code>.
      </p>
      <div class="settings-row">
        <button type="button" on:click={signOut}>Sign out</button>
      </div>
    {:else}
      <p class="help">Not signed in.</p>
      <div class="settings-row">
        <button type="button" on:click={() => navigate('/')}>Sign in</button>
      </div>
    {/if}
  </section>

  <section class="settings-section">
    <h3>Library</h3>
    {#if $inventoryState.status === 'ready'}
      <p class="help">
        {$inventoryState.inventory.saves.length} saves{#if libraryFetchedAt}, last updated {libraryFetchedAt}{/if}.
      </p>
    {:else if $inventoryState.status === 'empty'}
      <p class="help">No saves yet.</p>
    {/if}
    <div class="settings-row">
      {#if $inventoryState.status === 'ready'}
        <button type="button" on:click={exportInventory}>Export inventory file</button>
      {/if}
      <button type="button" on:click={() => importInputEl?.click()}>Import inventory file</button>
      <input
        bind:this={importInputEl}
        type="file"
        accept=".json,application/json"
        on:change={importInventory}
        hidden
      />
    </div>
  </section>

  {#if backupSectionVisible}
    <section class="settings-section">
      <h3>Backup</h3>
      <p class="help">
        Save your own copies of images and linked articles so they keep showing
        up even if Bluesky or the source site changes. Article backup needs the
        local bsky-saves helper.
      </p>

      <div class="settings-row">
        <strong>Images:</strong>
        <span>{imagesBackendLabel}</span>
        {#if imagesEnabled}
          <button type="button" class="link-button" on:click={handleDisableImages}>Disable</button>
        {/if}
      </div>

      <label class="checkbox">
        <input
          type="checkbox"
          checked={imagesDontAsk}
          on:change={handleToggleDontAsk}
        />
        <span>Don't ask me about image backup</span>
      </label>

      <div class="settings-row">
        <strong>Articles:</strong>
        <span>{articlesBackendLabel}</span>
        {#if articlesEnabled}
          <button type="button" class="link-button" on:click={handleDisableArticles}>Disable</button>
        {:else}
          <button type="button" on:click={handleSetUpArticles}>Set up article backup</button>
        {/if}
      </div>

      {#if articleSetupError}
        <p class="error" role="alert">{articleSetupError}</p>
      {/if}

      <label class="checkbox">
        <input
          type="checkbox"
          checked={articlesDontAsk}
          on:change={handleToggleArticlesDontAsk}
        />
        <span>Don't ask me about article backup</span>
      </label>

      <details
        class="advanced-toggle"
        bind:open={backupAdvancedOpen}
      >
        <summary>Advanced backup options</summary>

        <p class="help">
          Custom Cloudflare Worker proxy. Used as a fallback when no local helper
          is running. The setup is one-time, takes about 10 minutes, and runs on
          Cloudflare's free tier.
        </p>

        <button type="button" class="setup-guide-trigger" on:click={() => (setupModalOpen = true)}>
          Setup guide
        </button>

        <label>
          Proxy URL
          <input
            type="url"
            bind:value={workerUrl}
            placeholder="https://your-worker.workers.dev"
          />
        </label>
        <label>
          Shared secret
          <input type="password" bind:value={workerSecret} />
        </label>
        <div class="settings-row">
          <button type="button" on:click={handleSaveWorker}>Save</button>
          <button type="button" on:click={handleClearWorker}>Clear</button>
        </div>

        {#if operatorProxyConfigured}
          <hr class="advanced-divider" />
          <p class="help">
            <strong>Operator's image proxy</strong>
            <br />
            <code>{config.operatorImageProxyUrl}</code>
            {#if operatorProxyReachable === 'ok'}
              <span class="status-ok">· reachable</span>
            {:else if operatorProxyReachable === 'fail'}
              <span class="status-fail">· unreachable</span>
            {/if}
          </p>
          <p class="help">
            When set up by the site operator, this proxy is used as a fallback
            for image backup when no local helper or custom Cloudflare Worker is
            configured. Image bytes flow through the operator's worker; the
            operator does not log URLs or content.
          </p>
          <label class="checkbox">
            <input
              type="checkbox"
              checked={operatorProxyOptOut}
              on:change={handleToggleOperatorProxyOptOut}
            />
            <span>Don't use the operator's proxy</span>
          </label>
        {/if}
      </details>
    </section>
  {/if}

  <section class="settings-section">
    <h3>Reset</h3>
    <p class="help">
      Wipes the inventory, saved credentials, and beacon state from this browser. This cannot be undone.
    </p>
    <button type="button" class="danger" on:click={clearAll}>Clear all local data</button>
  </section>

  <CustomProxySetupModal open={setupModalOpen} on:close={() => (setupModalOpen = false)} />
</section>

<style>
  .route--settings {
    max-width: 44rem;
    margin: 0 auto;
  }
  .route__header {
    margin-bottom: 1.5rem;
  }
  .route__title {
    margin: 0;
  }
  .settings-section {
    border-top: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
    padding: 1rem 0;
  }
  .settings-section h3 {
    margin: 0 0 0.5rem;
  }
  .settings-section .help {
    margin: 0 0 0.75rem;
    font-size: 0.875rem;
    opacity: 0.8;
  }
  /* Used by Backup → Advanced (URL/secret form). */
  .settings-section label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 0.5rem;
    font-weight: 500;
  }
  /* Inline checkboxes for "Don't ask me" toggles: input first, then small label. */
  .settings-section label.checkbox {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
    margin: 0.25rem 0 0.5rem;
    font-weight: normal;
    font-size: 0.875rem;
    opacity: 0.85;
  }
  /* Inline link-style button for in-row actions like "Disable". Overrides the
     .settings-row button rule above (same specificity, declared after). */
  .settings-row .link-button {
    background: none;
    border: 0;
    padding: 0;
    margin: 0;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
    line-height: 1.25;
    opacity: 0.85;
  }
  .settings-row .link-button:hover {
    opacity: 1;
  }
  .settings-section input[type='url'],
  .settings-section input[type='password'] {
    font: inherit;
    padding: 0.5rem 0.75rem;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
  }
  .settings-section code {
    background: color-mix(in oklab, CanvasText 5%, Canvas);
    padding: 0.1em 0.3em;
    border-radius: 3px;
    font-size: 0.9em;
  }
  .settings-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .settings-row button {
    font: inherit;
    line-height: 1.25;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
  }
  .danger {
    background: color-mix(in oklab, red 10%, Canvas);
    border: 1px solid color-mix(in oklab, red 30%, transparent);
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .status {
    color: color-mix(in oklab, green 70%, CanvasText);
    font-weight: 500;
  }
  .error {
    color: color-mix(in oklab, red 70%, CanvasText);
    font-weight: 500;
  }
  .advanced-divider {
    border: 0;
    border-top: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
    margin: 1rem 0 0.75rem;
  }
  .status-ok {
    color: color-mix(in oklab, green 70%, CanvasText);
    font-weight: 500;
  }
  .status-fail {
    color: color-mix(in oklab, red 70%, CanvasText);
    font-weight: 500;
  }
  .setup-guide-trigger {
    font: inherit;
    padding: 0.35rem 0.75rem;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
    margin: 0.5rem 0;
  }
</style>

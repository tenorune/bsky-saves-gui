<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { inventoryState, loadFromDb } from '$lib/inventory-loader';
  import { saveInventory, clearInventory } from '$lib/inventory-store';
  import { clearCredentials } from '$lib/credentials-store';
  import { clearAccount } from '$lib/account-store';
  import { lastSession, clearLastSession } from '$lib/last-session';
  import { clearBeaconSent } from '$lib/beacon';
  import { loadProxyConfig, clearProxyConfig } from '$lib/proxy-config';
  import {
    loadBackupPrefs,
    setOperatorProxyOptOut,
    clearBackupPrefs,
    type BackupPrefs,
  } from '$lib/backup-prefs';
  import { config } from '$lib/config';
  import { startImageBackup, cancelImageBackup } from '$lib/start-image-backup';
  import { startArticleBackup, cancelArticleBackup } from '$lib/start-article-backup';
  import { clearImageBlobs } from '$lib/image-store';
  import { clearFailures } from '$lib/failure-store';
  import { resetImageHydration, resetArticleHydration } from '$lib/hydration-state';
  import { exportJson } from '../exporters/json-exporter';
  import { downloadFile } from '../exporters/file-download';
  import { parseInventory } from '../reader/inventory-shape';
  import { navigate } from '$lib/router';
  import CustomProxySetupModal from '../components/CustomProxySetupModal.svelte';
  import { assetToggles, setAssetToggle, loadAssetToggles } from '$lib/asset-toggles';
  import { loadInstallHintPref } from '$lib/install-hint-pref';
  import InstallHelperHint from '../components/library-status/InstallHelperHint.svelte';
  import { threadHydrator } from '$lib/thread-hydrator';
  import { capabilitySnapshot } from '$lib/capability-snapshot';
  import { signInDraft } from '$lib/sign-in-draft';
  import { loadInventory } from '$lib/inventory-store';

  let status = '';
  let error = '';
  let importInputEl: HTMLInputElement | undefined;

  let backupPrefs: BackupPrefs | null = null;
  let backupAdvancedOpen = false;
  let setupModalOpen = false;
  let customProxyConfigured = false;

  async function refreshCustomProxyStatus(): Promise<void> {
    const cfg = await loadProxyConfig();
    customProxyConfigured = cfg !== null && cfg.url !== '' && cfg.sharedSecret !== '';
  }

  async function handleSetupModalChange(): Promise<void> {
    await refreshCustomProxyStatus();
  }

  onMount(async () => {
    backupPrefs = await loadBackupPrefs();
    await refreshCustomProxyStatus();
    void probeOperatorProxy();
    await loadAssetToggles();
    await loadInstallHintPref();
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
  }

  async function reloadBackupPrefs() {
    backupPrefs = await loadBackupPrefs();
  }

  $: toggles = $assetToggles;

  function handleImagesToggleChange(event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    void setAssetToggle('images', checked, { onImagesToggleOn: triggerImageHydration });
  }

  function handleArticlesToggleChange(event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    void setAssetToggle('articles', checked, { onArticlesToggleOn: triggerArticleHydration });
  }

  function handleThreadsToggleChange(event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    void setAssetToggle('threads', checked, { onThreadsToggleOn: triggerThreadHydration });
  }

  async function triggerThreadHydration(): Promise<void> {
    const inv = (await loadInventory()) as { saves: { uri: string }[] } | null;
    if (!inv) return;
    const draft = get(signInDraft);
    const session = get(lastSession);
    const credentials = draft && draft.appPassword
      ? { handle: draft.handle, appPassword: draft.appPassword, pds: draft.pds }
      : session
        ? { accessJwt: session.accessJwt, refreshJwt: session.refreshJwt, did: session.did, pds: session.pds }
        : null;
    if (!credentials) return;
    const out = await threadHydrator.start({
      backend: get(capabilitySnapshot).threads,
      origin: config.helperOrigin,
      inventory: inv,
      credentials,
    });
    await saveInventory(out);
  }

  async function triggerImageHydration(): Promise<void> {
    const inv = await loadInventory();
    if (!inv) return;
    void startImageBackup(inv);
  }

  async function triggerArticleHydration(): Promise<void> {
    const inv = await loadInventory();
    if (!inv) return;
    void startArticleBackup(inv);
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
      clearFailures(),
    ]);
    clearLastSession();
    resetImageHydration();
    resetArticleHydration();
    // Refresh local UI state so the Backup section disappears immediately.
    backupPrefs = await loadBackupPrefs();
    customProxyConfigured = false;
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

  <section class="settings-section">
    <h3>Backups</h3>
    <p class="help">Choose which kinds of backups Library should keep up to date.</p>
    <label class="checkbox">
      <input
        type="checkbox"
        checked={toggles.threads}
        on:change={handleThreadsToggleChange}
      />
      <span>Back up threads</span>
    </label>
    <label class="checkbox">
      <input
        type="checkbox"
        checked={toggles.images}
        on:change={handleImagesToggleChange}
      />
      <span>Back up images</span>
    </label>
    <label class="checkbox">
      <input
        type="checkbox"
        checked={toggles.articles}
        on:change={handleArticlesToggleChange}
      />
      <span>Back up articles</span>
    </label>

    <details
      class="advanced-toggle"
      bind:open={backupAdvancedOpen}
    >
      <summary>Advanced backup options</summary>

      <div class="card advanced">
        <p class="advanced-heading"><strong>Custom Cloudflare Worker proxy</strong></p>
        <p class="help">
          Used as a fallback when no local helper is running. The setup is
          one-time, takes about 10 minutes, and runs on Cloudflare's free tier.
        </p>

        <button type="button" class="setup-guide-trigger" on:click={() => (setupModalOpen = true)}>
          {customProxyConfigured ? 'Edit setup' : 'Setup guide'}
        </button>

        {#if operatorProxyConfigured}
          <p class="advanced-heading advanced-heading--spaced"><strong>Operator's image proxy</strong></p>
          <p class="help">
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
      </div>
    </details>
  </section>

  <section class="settings-section">
    <InstallHelperHint showDismiss={false} />
  </section>

  <section class="settings-section">
    <h3>Reset</h3>
    <p class="help">
      Wipes the inventory, saved credentials, and beacon state from this browser. This cannot be undone.
    </p>
    <button type="button" class="danger" on:click={clearAll}>Clear all local data</button>
  </section>

  <CustomProxySetupModal
    open={setupModalOpen}
    on:close={() => (setupModalOpen = false)}
    on:change={handleSetupModalChange}
  />
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
  /* Inline checkboxes for "Don't ask me" toggles. */
  .settings-section label.checkbox {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
    margin: 0.25rem 0 0.5rem;
    font-weight: normal;
    font-size: 0.875rem;
    opacity: 0.85;
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
  .settings-row button,
  .settings-section > button {
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
  .advanced-toggle > summary {
    margin-bottom: 0.75rem;
  }
  .card.advanced {
    border: 1px solid color-mix(in oklab, CanvasText 15%, transparent);
    border-radius: 8px;
    padding: 1rem 1.25rem;
  }
  .advanced-heading {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
  }
  .advanced-heading--spaced {
    margin-top: 1.25rem;
  }
  .card.advanced .help {
    margin-top: 0;
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

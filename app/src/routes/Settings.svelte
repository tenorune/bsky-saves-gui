<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { navigate } from '$lib/router';
  import { inventoryState, loadFromDb } from '$lib/inventory-loader';
  import { saveInventory, clearInventory } from '$lib/inventory-store';
  import { clearCredentials } from '$lib/credentials-store';
  import { clearBeaconSent } from '$lib/beacon';
  import { loadProxyConfig, saveProxyConfig, clearProxyConfig } from '$lib/proxy-config';
  import { exportJson } from '../exporters/json-exporter';
  import { downloadFile } from '../exporters/file-download';
  import { parseInventory } from '../reader/inventory-shape';

  let proxyUrl = '';
  let proxySecret = '';
  let status = '';
  let error = '';

  onMount(async () => {
    const cfg = await loadProxyConfig();
    if (cfg) {
      proxyUrl = cfg.url;
      proxySecret = cfg.sharedSecret;
    }
  });

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
    if (!confirm('Clear inventory, saved credentials, proxy config, and beacon state? This cannot be undone.')) {
      return;
    }
    await Promise.all([
      clearInventory(),
      clearCredentials(),
      clearProxyConfig(),
      clearBeaconSent(),
    ]);
    await loadFromDb();
    proxyUrl = '';
    proxySecret = '';
    status = 'All local data cleared.';
  }

  async function saveProxy() {
    error = '';
    if (!proxyUrl || !proxySecret) {
      error = 'Both URL and shared secret are required.';
      return;
    }
    await saveProxyConfig({ url: proxyUrl, sharedSecret: proxySecret });
    status = 'Proxy config saved.';
  }

  async function clearProxy() {
    await clearProxyConfig();
    proxyUrl = '';
    proxySecret = '';
    status = 'Proxy config cleared.';
  }
</script>

<section class="route route--settings">
  <header class="route__header">
    <button type="button" class="route__back" on:click={() => navigate('/library')}>← Library</button>
    <h2 class="route__title">Settings</h2>
  </header>

  {#if status}
    <p class="status">{status}</p>
  {/if}
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  <section class="settings-section">
    <h3>Inventory</h3>
    <p class="help">Move your saved data between devices or browsers.</p>
    <div class="settings-row">
      <button type="button" on:click={exportInventory}>Export inventory file</button>
      <label class="file-input">
        Import inventory file
        <input type="file" accept=".json,application/json" on:change={importInventory} />
      </label>
    </div>
  </section>

  <section class="settings-section">
    <h3>Cloudflare Worker proxy</h3>
    <p class="help">
      Used for article hydration when no local helper is running. See the project's
      <code>templates/cf-worker/</code> README for how to deploy your own.
    </p>
    <label>
      Proxy URL
      <input type="url" bind:value={proxyUrl} placeholder="https://your-worker.workers.dev" />
    </label>
    <label>
      Shared secret
      <input type="password" bind:value={proxySecret} />
    </label>
    <div class="settings-row">
      <button type="button" on:click={saveProxy}>Save proxy</button>
      <button type="button" on:click={clearProxy}>Clear</button>
    </div>
  </section>

  <section class="settings-section">
    <h3>Local data</h3>
    <p class="help">
      Wipes inventory, saved credentials, proxy config, and beacon state from this browser.
    </p>
    <button type="button" class="danger" on:click={clearAll}>Clear all local data</button>
  </section>
</section>

<style>
  .route--settings {
    max-width: 44rem;
    margin: 0 auto;
  }
  .route__header {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }
  .route__back {
    background: none;
    border: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    padding: 0;
    margin: 0;
    opacity: 0.85;
  }
  .route__back:hover {
    opacity: 1;
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
  .settings-section label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 0.5rem;
    font-weight: 500;
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
  .settings-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .settings-row button,
  .file-input {
    font: inherit;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
  }
  .file-input input {
    display: none;
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
</style>

<script lang="ts">
  import { get } from 'svelte/store';
  import { inventoryState } from '$lib/inventory-loader';
  import { lastSession } from '$lib/last-session';
  import { loadAccount } from '$lib/account-store';
  import { exportJson } from '../exporters/json-exporter';
  import { exportMarkdown } from '../exporters/markdown-exporter';
  import { exportHtml } from '../exporters/html-exporter';
  import { downloadFile } from '../exporters/file-download';

  let busy = false;
  let error = '';
  let htmlMode: 'zip' | 'self-contained' = 'self-contained';

  async function resolveAccount(): Promise<string> {
    return get(lastSession)?.handle ?? (await loadAccount()) ?? 'unknown';
  }

  async function withInventory(fn: (inv: import('../reader/inventory-shape').Inventory) => Promise<void>) {
    error = '';
    const s = get(inventoryState);
    if (s.status !== 'ready') {
      error = 'No inventory loaded.';
      return;
    }
    busy = true;
    try {
      await fn(s.inventory);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  function handleJson() {
    return withInventory(async (inv) => {
      const r = await exportJson(inv);
      downloadFile(r.blob, r.filename);
    });
  }

  function detectHydration(inv: import('../reader/inventory-shape').Inventory) {
    const saves = inv.saves;
    const has = (predicate: (s: (typeof saves)[number]) => boolean) => saves.some(predicate);
    return {
      enrich: has((s) => typeof s.enriched_created_at === 'string'),
      threads: has(
        (s) => Array.isArray((s as unknown as { thread_replies?: unknown }).thread_replies),
      ),
      articles: has((s) => typeof (s as unknown as { article_text?: unknown }).article_text === 'string'),
      images: has((s) => Array.isArray(s.local_images) && s.local_images.length > 0),
    };
  }

  function handleMarkdown() {
    return withInventory(async (inv) => {
      const account = await resolveAccount();
      const r = await exportMarkdown(inv, {
        account,
        hydratedFlags: detectHydration(inv),
      });
      downloadFile(r.blob, r.filename);
    });
  }

  function handleHtml() {
    return withInventory(async (inv) => {
      const r = await exportHtml(inv, { mode: htmlMode });
      downloadFile(r.blob, r.filename);
    });
  }
</script>

<details class="export-menu">
  <summary>Export</summary>
  <div class="export-menu__panel">
    <button type="button" disabled={busy} on:click={handleJson}>JSON</button>
    <button type="button" disabled={busy} on:click={handleMarkdown}>Markdown</button>
    <div class="export-menu__html">
      <button type="button" disabled={busy} on:click={handleHtml}>HTML</button>
      <label>
        <input type="radio" bind:group={htmlMode} value="self-contained" />
        Self-contained
      </label>
      <label>
        <input type="radio" bind:group={htmlMode} value="zip" />
        Bundle as zip
      </label>
    </div>
    {#if error}
      <p class="export-menu__error" role="alert">{error}</p>
    {/if}
  </div>
</details>

<style>
  .export-menu {
    position: relative;
  }
  .export-menu summary {
    cursor: pointer;
    list-style: none;
    padding: 0.35rem 0.75rem;
    border: 1px solid color-mix(in oklab, CanvasText 25%, transparent);
    border-radius: 6px;
    background: color-mix(in oklab, CanvasText 6%, Canvas);
    font-weight: 600;
    user-select: none;
  }
  .export-menu summary:hover {
    background: color-mix(in oklab, CanvasText 12%, Canvas);
  }
  .export-menu[open] summary {
    background: color-mix(in oklab, CanvasText 12%, Canvas);
  }
  .export-menu summary::-webkit-details-marker {
    display: none;
  }
  .export-menu__panel {
    position: absolute;
    right: 0;
    top: 100%;
    background: Canvas;
    border: 1px solid color-mix(in oklab, CanvasText 15%, transparent);
    border-radius: 6px;
    padding: 0.75rem;
    min-width: 14rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .export-menu__panel button {
    font: inherit;
    padding: 0.4rem 0.6rem;
    cursor: pointer;
  }
  .export-menu__html {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    border-top: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
    padding-top: 0.5rem;
  }
  .export-menu__html label {
    font-size: 0.875rem;
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .export-menu__error {
    margin: 0;
    color: color-mix(in oklab, red 70%, CanvasText);
    font-size: 0.875rem;
  }
</style>

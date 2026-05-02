<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { inventoryState, loadFromDb } from '$lib/inventory-loader';
  import { navigate } from '$lib/router';
  import { slideFromRight } from '$lib/slide-transition';
  import LibraryView from '../reader/LibraryView.svelte';
  import { rkeyOf } from '../reader/inventory-shape';
  import type { Save } from '../reader/inventory-shape';

  onMount(() => {
    if (get(inventoryState).status === 'loading') {
      void loadFromDb();
    }
  });

  function open(save: Save): void {
    navigate(`/post/${rkeyOf(save.uri)}`);
  }

  function sync(): void {
    navigate('/sync');
  }
</script>

<section class="route route--library" use:slideFromRight>
  <header class="route__header">
    <h2 class="route__title">Library</h2>
    <button type="button" class="route__sync" on:click={sync} title="Re-fetch saves">
      Sync
    </button>
  </header>

  {#if $inventoryState.status === 'loading'}
    <p>Loading inventory…</p>
  {:else if $inventoryState.status === 'empty'}
    <p>
      No inventory yet. <a href="#/">Sign in</a> to fetch your saves.
    </p>
  {:else if $inventoryState.status === 'error'}
    <p class="error">Failed to load inventory: {$inventoryState.message}</p>
    <button type="button" on:click={() => loadFromDb()}>Retry</button>
  {:else}
    <LibraryView inventory={$inventoryState.inventory} onSelectPost={open} />
  {/if}
</section>

<style>
  .route--library {
    max-width: 44rem;
    margin: 0 auto;
  }
  .route__header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .route__title {
    margin: 0;
  }
  .route__sync {
    font: inherit;
    padding: 0.35rem 0.75rem;
    border: 1px solid color-mix(in oklab, CanvasText 25%, transparent);
    border-radius: 6px;
    background: color-mix(in oklab, CanvasText 6%, Canvas);
    color: inherit;
    cursor: pointer;
    font-weight: 600;
  }
  .route__sync:hover {
    background: color-mix(in oklab, CanvasText 12%, Canvas);
  }
  .error {
    color: color-mix(in oklab, red 70%, CanvasText);
  }
</style>

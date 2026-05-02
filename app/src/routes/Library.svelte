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
</script>

<section class="route route--library" use:slideFromRight>
  <header class="route__header">
    <h2 class="route__title">Library</h2>
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
  .error {
    color: color-mix(in oklab, red 70%, CanvasText);
  }
</style>

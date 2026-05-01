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
    <button type="button" class="route__back" on:click={() => navigate('/')}>← Sign in</button>
    <h2>Library</h2>
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
  .route__header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .route__back {
    background: none;
    border: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
  }
  .error {
    color: color-mix(in oklab, red 70%, CanvasText);
  }
</style>

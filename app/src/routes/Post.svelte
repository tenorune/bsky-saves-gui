<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { inventoryState, loadFromDb } from '$lib/inventory-loader';
  import { currentRoute, navigate } from '$lib/router';
  import { slideFromRight } from '$lib/slide-transition';
  import PostFocus from '../reader/PostFocus.svelte';
  import { rkeyOf } from '../reader/inventory-shape';

  onMount(() => {
    if (get(inventoryState).status === 'loading') {
      void loadFromDb();
    }
  });

  $: rkey = $currentRoute.params.rkey ?? '';
  $: save = (() => {
    const s = $inventoryState;
    if (s.status !== 'ready') return null;
    return s.inventory.saves.find((x) => rkeyOf(x.uri) === rkey) ?? null;
  })();
</script>

<section class="route route--post" use:slideFromRight>
  <header class="route__header">
    <button type="button" class="route__back" on:click={() => navigate('/library')}>← Library</button>
    <h2>Post</h2>
  </header>

  {#if $inventoryState.status === 'loading'}
    <p>Loading…</p>
  {:else if $inventoryState.status !== 'ready'}
    <p>No inventory available. <a href="#/">Sign in</a>.</p>
  {:else if save === null}
    <p>Post <code>{rkey}</code> not found in your inventory.</p>
    <button type="button" on:click={() => navigate('/library')}>Back to library</button>
  {:else}
    <PostFocus {save} />
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
</style>

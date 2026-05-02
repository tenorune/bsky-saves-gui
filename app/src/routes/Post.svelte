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
  <button type="button" class="route__back" on:click={() => navigate('/library')}>← Library</button>
  <header class="route__header">
    <h2 class="route__title">Post</h2>
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
  .route--post {
    position: relative;
    max-width: 44rem;
    margin: 0 auto;
  }
  .route__header {
    margin-bottom: 1.5rem;
  }
  .route__title {
    margin: 0;
  }
  .route__back {
    position: absolute;
    right: 100%;
    top: 0;
    margin-right: 1rem;
    white-space: nowrap;
    background: none;
    border: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    opacity: 0.85;
  }
  .route__back:hover {
    opacity: 1;
  }
  /*
   * On viewports too narrow for the left margin to hold the back button,
   * fall back to stacking it above the title (matches the previous layout).
   */
  @media (max-width: 60rem) {
    .route__back {
      position: static;
      display: block;
      margin: 0 0 0.5rem 0;
      padding: 0;
    }
  }
</style>

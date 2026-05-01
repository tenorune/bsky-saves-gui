<script lang="ts">
  import type { Inventory, Save } from './inventory-shape';
  import { filterSaves, sortByCreatedDesc } from './feed-filter';
  import PostCard from './PostCard.svelte';
  import SearchBar from './SearchBar.svelte';
  import DateRangeFilter from './DateRangeFilter.svelte';

  export let inventory: Inventory;
  export let onSelectPost: (save: Save) => void;

  let query = '';
  let from: string | null = null;
  let to: string | null = null;

  $: sorted = sortByCreatedDesc(inventory.saves);
  $: visible = filterSaves(sorted, { query, from, to });
</script>

<section class="library-view">
  <header class="library-view__filters">
    <SearchBar bind:value={query} />
    <DateRangeFilter bind:from bind:to />
    <p class="library-view__count" aria-live="polite">
      Showing {visible.length} of {inventory.saves.length}
    </p>
  </header>

  {#if visible.length === 0}
    <p class="library-view__empty">No saves match your filters.</p>
  {:else}
    <ul class="library-view__feed">
      {#each visible as save (save.uri)}
        <li>
          <PostCard {save} onSelect={onSelectPost} />
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .library-view {
    max-width: 44rem;
    margin: 0 auto;
  }
  .library-view__filters {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: end;
    margin-bottom: 1.5rem;
  }
  .library-view__count {
    margin: 0 0 0 auto;
    font-size: 0.875rem;
    opacity: 0.8;
  }
  .library-view__feed {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .library-view__empty {
    opacity: 0.7;
    font-style: italic;
  }
</style>

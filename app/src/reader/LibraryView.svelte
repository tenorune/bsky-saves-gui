<script lang="ts">
  import type { Inventory, Save } from './inventory-shape';
  import { filterSaves, sortByCreatedDesc } from './feed-filter';
  import PostCard from './PostCard.svelte';
  import SearchBar from './SearchBar.svelte';
  import DateRangeFilter from './DateRangeFilter.svelte';
  import {
    filterQuery,
    filterFrom,
    filterTo,
    filterShow,
    availableShowFilters,
    type ShowFilter,
  } from '../lib/library-filters';
  import { retainMode } from '../lib/retain-mode';

  export let inventory: Inventory;
  export let onSelectPost: (save: Save) => void;

  // The "Show" filter's options depend on the retain mode. If the
  // persisted selection isn't valid for the current mode (e.g. 'unsaved'
  // lingering after a switch to keep-lost), snap it to that mode's
  // default — the first available option.
  $: showOptions = availableShowFilters($retainMode);
  $: if (!showOptions.includes($filterShow)) filterShow.set(showOptions[0]);

  function showFilterLabel(f: ShowFilter): string {
    switch (f) {
      case 'synced':
        return 'Bluesky saves';
      case 'lost':
        return 'Deleted or blocked by poster';
      case 'unsaved':
        return 'Unsaved';
      case 'all':
        return 'All';
    }
  }

  $: sorted = sortByCreatedDesc(inventory.saves);
  $: visible = filterSaves(sorted, {
    query: $filterQuery,
    from: $filterFrom,
    to: $filterTo,
    show: $filterShow,
  });
</script>

<section class="library-view">
  <header class="library-view__filters">
    <SearchBar bind:value={$filterQuery} />
    {#if showOptions.length > 1}
      <label class="library-view__show">
        Show
        <select bind:value={$filterShow}>
          {#each showOptions as opt (opt)}
            <option value={opt}>{showFilterLabel(opt)}</option>
          {/each}
        </select>
      </label>
    {/if}
    <DateRangeFilter bind:from={$filterFrom} bind:to={$filterTo} />
  </header>

  {#if visible.length === 0}
    <p class="library-view__empty">No saved posts match your filters.</p>
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
    width: 100%;
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
  .library-view__show {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.7;
  }
  .library-view__show select {
    font: inherit;
    text-transform: none;
    letter-spacing: normal;
    opacity: 1;
    padding: 0.5rem 0.75rem;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
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

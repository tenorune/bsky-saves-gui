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
  import { panelCollapse, setFiltersCollapsed } from '../lib/panel-collapse-pref';
  import CollapsibleBlock from '../components/CollapsibleBlock.svelte';

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
  <!-- Filters block: collapsible, default collapsed on first use,
       preference persisted via panelCollapse. The .library-view__filters
       wrapper still owns the inner flex-row layout AND the :global
       descendant styling (see the <style> block), so the input/select/
       date controls keep their unified appearance whether the block is
       collapsed or expanded. -->
  <CollapsibleBlock
    label="Filters"
    expanded={!$panelCollapse.filters}
    onToggle={(next) => void setFiltersCollapsed(!next)}
  >
    <div class="library-view__filters">
      <SearchBar bind:value={$filterQuery} />
      {#if showOptions.length > 1}
        <label>
          <span>Show</span>
          <select bind:value={$filterShow}>
            {#each showOptions as opt (opt)}
              <option value={opt}>{showFilterLabel(opt)}</option>
            {/each}
          </select>
        </label>
      {/if}
      <DateRangeFilter bind:from={$filterFrom} bind:to={$filterTo} />
    </div>
  </CollapsibleBlock>

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
  /* Unified styling for every control in the filter row — Search input,
     Show select, From/To date inputs. Defined once via :global so child
     components (SearchBar, DateRangeFilter) don't each re-declare the
     same border / padding / radius and drift over time. The small
     uppercase label styling lives on the inner <span>, not the wrapping
     <label>, so the control itself doesn't inherit a 0.75rem font-size
     and trip iOS Safari's auto-zoom-on-focus heuristic (<16px). */
  :global(.library-view__filters label) {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  :global(.library-view__filters label > span) {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.7;
  }
  :global(.library-view__filters :is(input, select)) {
    font: inherit;
    font-size: 1rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
    box-sizing: border-box;
    line-height: 1.25;
  }
  /* Strip the native dropdown chrome and paint a caret via SVG so the
     <select> matches the inputs visually. Stroke color is a mid-grey
     that reads on both light and dark Canvas backgrounds; the dark-mode
     variant lightens it for contrast against a dark Canvas. */
  :global(.library-view__filters select) {
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6' fill='none' stroke='%23666' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M1 1l4 4 4-4'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.625rem center;
    background-size: 0.625rem 0.4rem;
    padding-right: 1.875rem;
  }
  @media (prefers-color-scheme: dark) {
    :global(.library-view__filters select) {
      background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6' fill='none' stroke='%23999' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M1 1l4 4 4-4'/%3E%3C/svg%3E");
    }
  }
  :global(.library-view__filters :is(input, select):focus-visible) {
    outline: 2px solid color-mix(in oklab, royalblue 60%, CanvasText);
    outline-offset: 1px;
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

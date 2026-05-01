<!-- app/src/reader/SearchBar.svelte -->
<script lang="ts">
  export let value = '';
  export let placeholder = 'Search posts and authors…';
</script>

<label class="search-bar">
  <span class="search-bar__label">Search</span>
  <input
    type="search"
    bind:value
    {placeholder}
    autocomplete="off"
    spellcheck="false"
  />
</label>

<style>
  .search-bar {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .search-bar__label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.7;
  }
  input {
    font: inherit;
    padding: 0.5rem 0.75rem;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
  }
</style>

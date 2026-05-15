<!-- app/src/reader/SearchBar.svelte -->
<script lang="ts">
  export let value = '';
  export let placeholder = 'Search posts and authors…';
</script>

<label>
  <span>Search</span>
  <input
    type="search"
    bind:value
    {placeholder}
    autocomplete="off"
    spellcheck="false"
  />
</label>

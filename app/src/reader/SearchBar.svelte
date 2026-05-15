<!-- app/src/reader/SearchBar.svelte -->
<script lang="ts">
  export let value = '';
</script>

<label>
  <span>Search</span>
  <input
    type="search"
    bind:value
    autocomplete="off"
    spellcheck="false"
  />
</label>

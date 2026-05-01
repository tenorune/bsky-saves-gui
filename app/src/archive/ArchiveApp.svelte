<script lang="ts">
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import { parseInventory, rkeyOf, type Inventory, type Save } from '../reader/inventory-shape';
  import LibraryView from '../reader/LibraryView.svelte';
  import PostFocus from '../reader/PostFocus.svelte';

  type View =
    | { name: 'loading' }
    | { name: 'error'; message: string }
    | { name: 'library'; inventory: Inventory }
    | { name: 'post'; inventory: Inventory; save: Save };

  const view = writable<View>({ name: 'loading' });
  let inventory: Inventory | null = null;

  function readInline(): Inventory {
    const el = document.getElementById('inventory');
    if (!el) throw new Error('No inline inventory script');
    return parseInventory(JSON.parse(el.textContent ?? '{}'));
  }

  function applyHash(): void {
    if (!inventory) return;
    const hash = window.location.hash;
    const m = /^#\/post\/(.+)$/.exec(hash);
    if (m) {
      const rkey = decodeURIComponent(m[1]);
      const save = inventory.saves.find((s) => rkeyOf(s.uri) === rkey);
      if (save) {
        view.set({ name: 'post', inventory, save });
        return;
      }
    }
    view.set({ name: 'library', inventory });
  }

  onMount(() => {
    try {
      inventory = readInline();
      applyHash();
      const handler = () => applyHash();
      window.addEventListener('hashchange', handler);
      return () => window.removeEventListener('hashchange', handler);
    } catch (e) {
      view.set({ name: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  });

  function open(save: Save): void {
    window.location.hash = `#/post/${rkeyOf(save.uri)}`;
  }
</script>

<main class="archive">
  {#if $view.name === 'loading'}
    <p>Loading…</p>
  {:else if $view.name === 'error'}
    <p class="error">Failed to load: {$view.message}</p>
  {:else if $view.name === 'library'}
    <LibraryView inventory={$view.inventory} onSelectPost={open} />
  {:else if $view.name === 'post'}
    <header><a href="#/library">← Library</a></header>
    <PostFocus save={$view.save} />
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: system-ui, -apple-system, sans-serif;
  }
  .archive {
    max-width: 50rem;
    margin: 0 auto;
    padding: 1.5rem;
  }
  .error {
    color: red;
  }
</style>

<script lang="ts">
  import { onMount } from 'svelte';
  import { config } from '$lib/config';
  import { currentRoute, startRouter, navigate } from '$lib/router';
  import ExportMenu from './components/ExportMenu.svelte';

  onMount(() => startRouter());
</script>

<div class="app">
  <header class="app-header">
    <button
      type="button"
      class="app-header__title"
      on:click={() => navigate('/')}
      aria-label="Go to sign-in"
    >
      {config.appName}
    </button>
    <nav class="app-header__nav">
      <a href="#/library">Library</a>
      <a href="#/settings">Settings</a>
      <a href="#/privacy">Privacy</a>
      <ExportMenu />
    </nav>
  </header>

  <main class="app-main">
    <svelte:component this={$currentRoute.def.component} />
  </main>

  <footer class="app-footer">
    <p>
      Operator: <code>@{config.operatorHandle}</code>
    </p>
    <p>
      <a href={config.repoUrl} target="_blank" rel="noopener noreferrer">Source</a>
      ·
      <a href="#/privacy">Privacy</a>
    </p>
  </footer>
</div>

<style>
  :global(html, body, #app) {
    height: 100%;
    margin: 0;
  }
  :global(body) {
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    background: Canvas;
    color: CanvasText;
  }
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid color-mix(in oklab, CanvasText 15%, transparent);
  }
  .app-header__title {
    background: none;
    border: none;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    color: inherit;
  }
  .app-header__nav a {
    margin-left: 1rem;
  }
  .app-main {
    flex: 1;
    padding: 1.5rem;
  }
  .app-footer {
    padding: 1rem 1.5rem;
    border-top: 1px solid color-mix(in oklab, CanvasText 15%, transparent);
    font-size: 0.875rem;
    opacity: 0.85;
  }
  .app-footer p {
    margin: 0.25rem 0;
  }
</style>

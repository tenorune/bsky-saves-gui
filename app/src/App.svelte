<script lang="ts">
  import { onMount } from 'svelte';
  import { config } from '$lib/config';
  import { currentRoute, startRouter, navigate } from '$lib/router';
  import { decideEntryRoute } from '$lib/return-visit';
  import ExportMenu from './components/ExportMenu.svelte';
  // import BeaconButton from './components/BeaconButton.svelte';
  import { BUILD_TIME, BUILD_BRANCH } from '$lib/build-info';
  import { lastSession } from '$lib/last-session';
  import { inventoryState } from '$lib/inventory-loader';
  import { inventoryPresent } from '$lib/inventory-presence';
  import { persistenceMode } from '$lib/persistence-mode';
  import { saveLibraryToDevice } from '$lib/save-library-to-device';
  import { startSessionHeartbeat } from '$lib/session-heartbeat';

  let savingToDevice = false;
  async function handleSaveToDevice() {
    if (savingToDevice) return;
    savingToDevice = true;
    try {
      await saveLibraryToDevice();
    } finally {
      savingToDevice = false;
    }
  }

  onMount(() => {
    const stop = startRouter();
    // Start the heartbeat so any session-only sessionStorage data the
    // browser might have restored (Continue-where-you-left-off) gets a
    // staleness check on the next read and so this session's data is
    // protected against the same on the next reopen.
    startSessionHeartbeat();
    // If user landed on the default `/` route and we have an inventory,
    // jump to library. The user didn't click anything to get here, so
    // suppress the slide animation — this should feel like a cold load
    // straight to /library, not an in-app navigation.
    if (window.location.hash === '' || window.location.hash === '#/') {
      void decideEntryRoute().then((target) => {
        if (target !== '/') navigate(target, { animate: false });
      });
    }
    return stop;
  });
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
      {#if $lastSession}
        <span class="app-header__handle" title="Active session">
          @{$lastSession.handle}
        </span>
      {/if}
      {#if $inventoryPresent}
        <a href="#/library">Library</a>
      {/if}
      {#if $inventoryState.status === 'ready'}
        <ExportMenu />
      {/if}
      <a href="#/settings">Settings</a>
    </nav>
  </header>

  {#if $persistenceMode === 'session-only'}
    <div class="session-only-banner" role="status">
      <span class="session-only-banner__msg">
        Session-only mode — closing this tab signs you out. Your saves
        won't follow you across a browser quit on most setups, though
        browsers that restore sessions may show them again briefly.
      </span>
      <button
        type="button"
        class="session-only-banner__action"
        on:click={handleSaveToDevice}
        disabled={savingToDevice}
      >{savingToDevice ? 'Saving…' : 'Save Library to this device'}</button>
    </div>
  {/if}

  <main class="app-main">
    <svelte:component this={$currentRoute.def.component} />
  </main>

  <footer class="app-footer">
    <p>Operator: <code>@{config.operatorHandle}</code></p>
    <!-- <p class="app-footer__row">
      <BeaconButton />
    </p> -->
    <p>
      <a href={config.repoUrl} target="_blank" rel="noopener noreferrer">Source</a>
      ·
      <a href="#/privacy">Privacy</a>
    </p>
    {#if BUILD_BRANCH !== 'main'}
      <p class="app-footer__build" title="Build timestamp and source branch">
        <code>build {BUILD_TIME} -- ({BUILD_BRANCH})</code>
      </p>
    {/if}
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
  .app-header__nav {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .app-header__handle {
    opacity: 0.7;
    font-size: 0.875rem;
    font-variant: small-caps;
  }
  .app-main {
    flex: 1;
    padding: 1.5rem;
  }
  .session-only-banner {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1rem;
    align-items: center;
    justify-content: space-between;
    padding: 0.625rem 1.5rem;
    background: color-mix(in oklab, Canvas 88%, orange 12%);
    border-bottom: 1px solid color-mix(in oklab, CanvasText 18%, transparent);
    font-size: 0.875rem;
  }
  .session-only-banner__msg {
    flex: 1;
    min-width: 16rem;
  }
  .session-only-banner__action {
    font: inherit;
  }
  .session-only-banner__action[disabled] {
    opacity: 0.6;
    cursor: progress;
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
  .app-footer__build {
    font-size: 0.75rem;
    opacity: 0.6;
  }
</style>

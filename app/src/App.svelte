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
  import { clearLibraryScroll } from '$lib/library-scroll';

  $: routeName = $currentRoute.name;

  function goToLibraryFromTopNav() {
    // Topnav "Library" link is rendered only when not on Library
    // (Library state turns into bold static text instead). Any
    // top-of-app click should land at the top of the feed, not at a
    // stale scroll position captured on a previous visit.
    clearLibraryScroll();
    navigate('/library');
  }

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
    // Cold-load gate: route the user to wherever they should actually
    // be given their data state. Covers root → /library on cached
    // visits, /library or /post → / when there's no inventory to back
    // those routes (the typical session-only-expired reproducer).
    void decideEntryRoute(window.location.hash).then((target) => {
      if (target !== null) navigate(target, { animate: false });
    });
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
      {#if $inventoryState.status === 'ready'}
        <ExportMenu />
      {/if}
      {#if $inventoryPresent}
        {#if routeName === 'library'}
          <strong class="app-header__current">Library</strong>
        {:else}
          <button
            type="button"
            class="app-header__navlink"
            on:click={goToLibraryFromTopNav}
          >Library</button>
        {/if}
      {/if}
      {#if routeName === 'settings'}
        <strong class="app-header__current">Settings</strong>
      {:else}
        <a class="app-header__navlink" href="#/settings">Settings</a>
      {/if}
    </nav>
  </header>

  {#if $persistenceMode === 'session-only'}
    <div class="session-only-banner" role="status">
      <span class="session-only-banner__msg">
        <strong>Session mode</strong> — closing this tab or quitting the browser will clear your library and sign you out
      </span>
      <button
        type="button"
        class="session-only-banner__action"
        on:click={handleSaveToDevice}
        disabled={savingToDevice}
      >{savingToDevice ? 'Saving…' : 'Keep my saves in this browser'}</button>
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
    /* Remove the user-agent default button padding (1px 6px in most
       browsers) so the title's text-start aligns with .app-main /
       .session-only-banner content edges at exactly 1.5rem. Without
       this, the title sits ~6px right of the banner below it. */
    padding: 0;
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
  /* Bold static text used in place of the link for the user's current
     route — same visual weight as a link's hover state, no pointer. */
  .app-header__current {
    font-weight: 700;
  }
  /* The Library topnav link is a button (so its on:click can clear the
     saved scroll before navigating), but visually it should match the
     surrounding <a> links. */
  .app-header__navlink {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-decoration: underline;
  }
  .app-header__navlink:hover {
    text-decoration: none;
  }
  .app-main {
    flex: 1;
    padding: 1.5rem;
  }
  .session-only-banner {
    /* Left edge aligns with .app-header's left padding (1.5rem) so the
       banner reads as a continuation of the header rather than a
       separately-positioned strip. message + action sit next to each
       other on the left rather than space-between'd — the action is
       a short inline link, not a separately-emphasized button. */
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    align-items: baseline;
    padding: 0.625rem 1.5rem;
    background: color-mix(in oklab, Canvas 88%, orange 12%);
    border-bottom: 1px solid color-mix(in oklab, CanvasText 18%, transparent);
    font-size: 0.875rem;
  }
  .session-only-banner__msg {
    /* Don't grow: keep the message its natural width so the action
       sits right next to it. flex-wrap on the parent handles the
       narrow-viewport overflow. */
    flex: 0 0 auto;
  }
  /* The "Keep my saves in this browser" affordance functions as a
     button (triggers a multi-step flush) but reads as a link in the
     banner — echoes the wording of the SignIn → Advanced checkbox. */
  .session-only-banner__action {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-decoration: underline;
  }
  .session-only-banner__action:hover {
    text-decoration: none;
  }
  .session-only-banner__action[disabled] {
    opacity: 0.6;
    cursor: progress;
    text-decoration: none;
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

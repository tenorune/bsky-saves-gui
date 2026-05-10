<script lang="ts">
  import { onMount } from 'svelte';
  import { config } from '$lib/config';
  import { currentRoute, startRouter, navigate } from '$lib/router';
  import { decideEntryRoute } from '$lib/return-visit';
  import ExportMenu from './components/ExportMenu.svelte';
  // import BeaconButton from './components/BeaconButton.svelte';
  import { BUILD_TIME, BUILD_BRANCH } from '$lib/build-info';
  import { lastSession } from '$lib/last-session';
  import { inventoryState, loadFromDb } from '$lib/inventory-loader';
  import { inventoryPresent } from '$lib/inventory-presence';
  import { persistenceMode } from '$lib/persistence-mode';
  import { saveLibraryToDevice } from '$lib/save-library-to-device';
  import { startSessionHeartbeat } from '$lib/session-heartbeat';
  import { clearLibraryScroll } from '$lib/library-scroll';
  import { loadAccount } from '$lib/account-store';

  $: routeName = $currentRoute.name;

  // The handle shown in the topnav represents the owner of the cached
  // Library, not the active sign-in. Same resolution order as
  // ExportMenu.resolveAccount: prefer the live session's handle (most
  // current), fall back to the stored account label (set at last
  // sign-in by saveAccount), null if neither. The handle is rendered
  // only when an inventory exists ($inventoryPresent), so it doesn't
  // appear pre-sign-in.
  let displayedHandle: string | null = null;
  $: void resolveDisplayedHandle($lastSession, $inventoryPresent);
  async function resolveDisplayedHandle(
    session: typeof $lastSession,
    _present: boolean,
  ): Promise<void> {
    if (session) {
      displayedHandle = session.handle;
      return;
    }
    displayedHandle = await loadAccount();
  }

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
    // Populate inventoryState from IDB on cold load so reactive
    // surfaces (Export button, Library link, etc.) work regardless
    // of which route the user lands on. Library / Post call
    // loadFromDb on their own mount too; calling here is idempotent
    // (loadFromDb skips the "loading" placeholder when state is
    // already 'ready'), and covers the case where the user is on
    // Settings (or any other route) when the page first loads —
    // typical reproducer is Sign Out → browser refresh, where
    // Settings has no Library mount to trigger the load.
    void loadFromDb();
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
    {#if displayedHandle && $inventoryPresent}
      <span class="app-header__handle app-header__item-handle" title="Library owner">
        @{displayedHandle}
      </span>
    {/if}
    {#if $inventoryState.status === 'ready'}
      <div class="app-header__item-export"><ExportMenu /></div>
    {/if}
    {#if $inventoryPresent}
      {#if routeName === 'library'}
        <strong class="app-header__current app-header__item-library">Library</strong>
      {:else}
        <button
          type="button"
          class="app-header__navlink app-header__item-library"
          on:click={goToLibraryFromTopNav}
        >Library</button>
      {/if}
    {/if}
    {#if routeName === 'settings'}
      <strong class="app-header__current app-header__item-settings">Settings</strong>
    {:else}
      <a class="app-header__navlink app-header__item-settings" href="#/settings">Settings</a>
    {/if}
  </header>

  {#if $persistenceMode === 'session-only'}
    <div class="session-only-banner" role="status">
      <span class="session-only-banner__msg">
        <strong>Session mode</strong> — closing this tab or quitting the browser will clear your Library{$lastSession ? ' and sign you out' : ''}.
      </span>
      <button
        type="button"
        class="session-only-banner__action"
        on:click={handleSaveToDevice}
        disabled={savingToDevice}
      >{savingToDevice ? 'Saving…' : 'Keep my saved posts in this browser'}</button>
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
    /* Wide: single row, title pushed left by margin-right: auto, the
       rest flush right via justify-content: flex-end. Source order
       (Title, Handle, Export, Library, Settings) determines wide
       visual order so there's no reorder cost at the common width.
       Narrow: a media query reorders so Library/Settings stay on
       row 1 and Handle/Export drop to row 2 via flex-wrap. */
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem 1rem;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid color-mix(in oklab, CanvasText 15%, transparent);
  }
  /* Wrap point: roughly when the title + four right-cluster items
     stop fitting on one line. Bluesky-handle widths vary, so 768px
     is the conservative cutoff. */
  @media (max-width: 768px) {
    .app-header__item-library { order: 1; }
    .app-header__item-settings { order: 2; }
    .app-header__item-handle { order: 3; }
    .app-header__item-export { order: 4; }
  }
  .app-header__title {
    /* Push self left of everything else in the flex row. */
    margin-right: auto;
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

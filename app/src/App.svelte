<script lang="ts">
  import { onMount } from 'svelte';
  import { slide, fly } from 'svelte/transition';
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

  // Route components are code-split via dynamic import in routes.ts so
  // the initial main bundle stays small. Load the resolved component
  // imperatively in a reactive statement (rather than {#await}) so
  // repeat navigations to a previously-loaded route hit the module
  // cache and render instantly — {#await} would re-await each
  // reactive tick.
  import type { ComponentType } from 'svelte';
  let CurrentRouteComponent: ComponentType | null = null;
  $: void loadRouteComponent($currentRoute);
  async function loadRouteComponent(route: typeof $currentRoute) {
    CurrentRouteComponent = await route.def.loadComponent();
  }

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

  // Account row: a second header row (Handle + ExportMenu) that slides
  // down under the topnav. The ONLY thing that opens or closes it is
  // the user tapping the "@" toggle. Open/closed is persisted across
  // reloads. First-ever appearance (no stored pref) is open.
  //
  // The row is conditionally rendered with $inventoryPresent so it
  // disappears automatically on sign-out without needing to mutate
  // state; the persisted preference survives the sign-out and applies
  // again on the next sign-in.
  const ACCOUNT_ROW_PREF_KEY = 'account-row:v2';
  function loadAccountRowOpen(): boolean {
    if (typeof localStorage === 'undefined') return true;
    try {
      return localStorage.getItem(ACCOUNT_ROW_PREF_KEY) !== 'closed';
    } catch {
      return true;
    }
  }
  function saveAccountRowOpen(open: boolean): void {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(ACCOUNT_ROW_PREF_KEY, open ? 'open' : 'closed'); }
    catch { /* best-effort */ }
  }
  let accountMenuOpen = loadAccountRowOpen();
  function toggleAccountMenu() {
    accountMenuOpen = !accountMenuOpen;
    saveAccountRowOpen(accountMenuOpen);
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
  <header
    class="app-header"
    class:app-header--account-open={accountMenuOpen && $inventoryPresent}
  >
    <button
      type="button"
      class="app-header__title"
      on:click={() => navigate('/')}
      aria-label="Go to sign-in"
    >
      {config.appName}
    </button>
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
      <a
        class="app-header__navlink app-header__item-settings"
        href="#/settings"
        on:click|preventDefault={() => navigate('/settings')}
      >Settings</a>
    {/if}
    {#if $inventoryPresent}
      <button
        type="button"
        class="app-header__navlink app-header__account-toggle"
        class:app-header__account-toggle--open={accountMenuOpen}
        on:click={toggleAccountMenu}
        aria-expanded={accountMenuOpen}
        aria-controls="app-header-account-row"
        aria-label="Account menu"
      >@</button>
    {/if}
  </header>

  {#if accountMenuOpen && $inventoryPresent}
    <div
      id="app-header-account-row"
      class="app-header__account-row"
      transition:slide={{ duration: 180 }}
    >
      <nav
        class="app-header__handle-export"
        aria-label="Library tools"
        in:fly|local={{ duration: 200, x: 80 }}
        out:fly|local={{ duration: 140, x: 80 }}
      >
        {#if displayedHandle}
          <span class="app-header__handle" title="Library owner">
            @{displayedHandle}
          </span>
        {/if}
        {#if $inventoryState.status === 'ready'}
          <ExportMenu />
        {/if}
      </nav>
    </div>
  {/if}

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
    {#if CurrentRouteComponent}
      <svelte:component this={CurrentRouteComponent} />
    {/if}
  </main>

  <footer class="app-footer">
    <p>Operator: <code>@{config.operatorHandle}</code></p>
    <!-- <p class="app-footer__row">
      <BeaconButton />
    </p> -->
    <p>
      <a href={config.repoUrl} target="_blank" rel="noopener noreferrer">Source</a>
      ·
      <a href="#/privacy" on:click|preventDefault={() => navigate('/privacy')}>Privacy</a>
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
  /* Suppress the translucent grey/blue overlay iOS Safari and Android
     Chrome paint over every tapped element. Interactive elements
     still get visible feedback via their own :active / :focus-visible
     styles. */
  :global(html) {
    -webkit-tap-highlight-color: transparent;
  }
  :global(body) {
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    background: Canvas;
    color: CanvasText;
    /* Floor the layout at 360px (smallest target in DevTools'
       common-device list). Below that the page horizontally scrolls
       rather than crushing the layout further. */
    min-width: 360px;
  }
  /* Force text-bearing form controls to >=16px so iOS Safari doesn't
     auto-zoom on focus. Default UA size is ~13px which trips the
     zoom heuristic; bumping to 1rem (16px at the default html size)
     keeps the page from rescaling when a user taps an input. */
  :global(input, textarea, select) {
    font-size: 1rem;
  }
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .app-header {
    /* Single row: Title — Library — Settings — @. Title pushed left by
       margin-right: auto; the rest sits flush right via
       justify-content: flex-end. Horizontal padding is 0.875rem
       (= 1.5rem - 10px), matching the .status-panel's outboard bleed
       so items in both narrow and wide viewports sit at the same
       0.875rem-from-the-edge column. */
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem 1rem;
    padding: 1rem 0.875rem;
    /* A thin underline sits below the topnav whenever the account row
       is closed. Rendered as a box-shadow (not border-bottom) so the
       line occupies zero layout space — when the row opens, the
       header sits flush against the account row with no residual gap.
       Color transitions: instant on open, delayed by 180ms on close
       to match the slide-up animation. */
    box-shadow: 0 1px 0 0 color-mix(in oklab, CanvasText 15%, transparent);
    transition: box-shadow 0ms 180ms;
  }
  .app-header--account-open {
    box-shadow: 0 1px 0 0 transparent;
    transition: box-shadow 0ms 0ms;
  }
  /* Chained selector (.app-header__navlink.app-header__account-toggle)
     so these rules win the cascade against .app-header__navlink, which
     is defined later in this stylesheet and would otherwise override
     padding / background / border. */
  .app-header__navlink.app-header__account-toggle {
    /* Closed state: padding-right is 0 so the @ glyph touches the
       button's right border (which sits at header-content-right =
       viewport-right - 0.875rem = column G, the same column as
       EXPORT's right edge below). Padding-left gives a tappable
       breathing area on the left and visually pads the glyph from
       the Settings link. */
    font-size: 1.1rem;
    line-height: 1;
    padding: 0.4rem 0 0.4rem 0.875rem;
    border: 0;
    border-radius: 0;
    transition: background-color 100ms ease;
  }
  .app-header__navlink.app-header__account-toggle--open {
    /* Open state: the painted box extends to viewport-right via
       margin-right: -0.875rem (eating the header's padding-right) and
       to viewport-top + account-row-top via the vertical margins.
       Symmetric 0.875rem horizontal padding centers the @ glyph in
       the box; the glyph's right edge stays at column G (= border-box
       right - padding-right = viewport-right - 0.875rem), so the glyph
       doesn't visually move from its closed-state position.
       Margin-box width equals the closed state (0.875rem + glyph wide
       in both, since border-box gains 0.875rem from padding-right and
       loses 0.875rem to margin-right), so Library / Settings stay put
       when the menu opens. */
    text-decoration: none;
    font-weight: 700;
    background: rgba(0, 0, 0, 0.06);
    margin-top: -1rem;
    margin-right: -0.875rem;
    margin-bottom: -1rem;
    padding: calc(0.4rem + 1rem) 0.875rem;
  }
  @media (prefers-color-scheme: dark) {
    .app-header__navlink.app-header__account-toggle--open {
      background: rgba(255, 255, 255, 0.08);
    }
  }
  .app-header__account-row {
    /* Drops below the header when accountMenuOpen is true. No
       overflow: hidden at rest — the ExportMenu's popover positions
       absolutely below its trigger and needs to extend past the
       row's bottom edge. Svelte's slide transition applies
       overflow: hidden only for the duration of the animation.
       Explicit rgba per color-scheme: color-mix() with the Canvas
       system color produced an imperceptible band on mobile dark
       mode (the system Canvas value renders nearly-identical to
       the page background at small percentage mixes). */
    display: flex;
    justify-content: flex-end;
    align-items: center;
    /* Same 0.875rem horizontal padding as .app-header so EXPORT's right
       edge sits at the same column as the @ glyph above. */
    padding: 0.625rem 0.875rem;
    background: rgba(0, 0, 0, 0.06);
    border-bottom: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
  }
  @media (prefers-color-scheme: dark) {
    .app-header__account-row {
      background: rgba(255, 255, 255, 0.08);
    }
  }
  .app-header__handle-export {
    display: flex;
    align-items: center;
    gap: 1rem;
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
    /* Pad vertically to match the EXPORT summary button's content
       box height (0.35rem padding + 1-line content). Without this,
       align-items: center on the row would center the handle's short
       text-box against the taller EXPORT button — visually correct
       per spec, but reads as "low" against the button's centered
       label. */
    opacity: 0.7;
    font-size: 0.875rem;
    font-variant: small-caps;
    padding: 0.35rem 0;
    line-height: 1;
  }
  /* Bold static text used in place of the link for the user's current
     route — same visual weight as a link's hover state, no pointer. */
  .app-header__current {
    font-weight: 700;
  }
  /* The Library topnav link is a button (so its on:click can clear the
     saved scroll before navigating), but visually it should match the
     surrounding <a> links. No underline; the hover affordance is the
     pointer cursor + the bold weight when the link's route is active. */
  .app-header__navlink {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
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
    /* Don't grow past natural width on wide viewports, but allow the
       message to shrink and wrap on narrow ones so the text doesn't
       overflow the container. `min-width: 0` defeats flex's implicit
       `min-width: auto` so the inner text can wrap. */
    flex: 0 1 auto;
    min-width: 0;
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
    /* Same 0.875rem horizontal as .app-header so the footer's left
       and right edges line up with the topnav columns. */
    padding: 1rem 0.875rem;
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

<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { inventoryState, loadFromDb } from '$lib/inventory-loader';
  import { lastSession } from '$lib/last-session';
  import { signInDraft } from '$lib/sign-in-draft';
  import { navigate } from '$lib/router';
  import { slideFromRight } from '$lib/slide-transition';
  import { startLibraryRefresh, stopLibraryRefresh, libraryRefreshState } from '$lib/library-refresh';
  import { cancelImageBackup } from '$lib/start-image-backup';
  import { cancelArticleBackup } from '$lib/start-article-backup';
  import { cancelThreadHydration } from '$lib/thread-hydrator';
  import { assetToggles } from '$lib/asset-toggles';
  import { capabilitySnapshot, initCapabilitySnapshot } from '$lib/capability-snapshot';
  import { computeDominantBackend } from '$lib/dominant-backend';
  import { imageHydration, articleHydration, threadProgress, fetchProgress } from '$lib/hydration-state';
  import LibraryView from '../reader/LibraryView.svelte';
  import LibraryStatusPanel from '../components/LibraryStatusPanel.svelte';
  import CollapsibleBlock from '../components/CollapsibleBlock.svelte';
  import CustomProxySetupModal from '../components/CustomProxySetupModal.svelte';
  import PairingModal from '../components/PairingModal.svelte';
  import BackupFailuresModal from '../components/BackupFailuresModal.svelte';
  import AuthErrorBanner from '../components/library-status/AuthErrorBanner.svelte';
  import OutdatedHelperBanner from '../components/library-status/OutdatedHelperBanner.svelte';
  import ProtocolMismatchBanner from '../components/library-status/ProtocolMismatchBanner.svelte';
  import PairingRequiredBanner from '../components/library-status/PairingRequiredBanner.svelte';
  import { panelCollapse, setBackupsCollapsed } from '$lib/panel-collapse-pref';
  import { pairingToken } from '$lib/pairing-token';
  import { setHelperOptOut } from '$lib/helper-opt-out';
  import { isHelperOutdated, isProtocolNewerThanKnown, MAX_KNOWN_PROTOCOL } from '$lib/min-helper-version';
  import { rkeyOf } from '../reader/inventory-shape';
  import type { Save } from '../reader/inventory-shape';
  import { restoreHydrationFromInventory } from '$lib/restore-hydration';
  import { saveLibraryScroll, consumeLibraryScroll } from '$lib/library-scroll';

  let setupOpen = false;
  let pairingOpen = false;
  let pairingAutoOpened = false;
  let failuresOpen: 'images' | 'articles' | 'threads' | null = null;
  let didRestoreScroll = false;

  onMount(async () => {
    if (get(inventoryState).status === 'loading') {
      await loadFromDb();
    }
    const s = get(inventoryState);
    if (s.status === 'ready') {
      await restoreHydrationFromInventory(s.inventory);
    }
  });

  // Always start the Library at the top, then optionally restore a
  // previously-saved scroll position (set when the user clicked into a
  // post). rAF defers to after layout so window.scrollTo isn't clamped
  // against a 0-height list. didRestoreScroll guards the reactive block
  // so a later store update (e.g., refresh completing) doesn't re-yank
  // scroll back to the saved position.
  $: if (!didRestoreScroll && $inventoryState.status === 'ready') {
    didRestoreScroll = true;
    const y = consumeLibraryScroll();
    requestAnimationFrame(() => {
      window.scrollTo(0, y !== null && y > 0 ? y : 0);
    });
  }

  function open(save: Save): void {
    saveLibraryScroll();
    navigate(`/post/${rkeyOf(save.uri)}`);
  }

  function refresh(): void {
    const draft = get(signInDraft);
    const session = get(lastSession);
    const toggles = get(assetToggles);

    // When a session is in-memory (set by SignIn's main-thread createSession,
    // updated by /fetch's rotated_credentials handling), thread it through as
    // preauthSession so:
    //  - helper path: hydrators switch to JWT-pair credentials → helper skips
    //    createSession per request, avoiding 429 from PDSes that rate-limit.
    //  - pyodide path: worker's create_session monkey-patch returns the
    //    pre-baked session, no PDS createSession from the worker either.
    const preauthSession = session
      ? {
          accessJwt: session.accessJwt,
          refreshJwt: session.refreshJwt,
          did: session.did,
          handle: session.handle,
        }
      : undefined;

    if (draft && draft.appPassword) {
      // Fresh sign-in path: keep app-password credentials so the Pyodide
      // path has a usable handle/appPassword/pds (Pyodide doesn't accept
      // JWT-pair). Helper path is unaffected; preauthSession steers it to
      // JWT-pair regardless.
      startLibraryRefresh({
        credentials: { handle: draft.handle, appPassword: draft.appPassword, pds: draft.pds },
        includeThreads: toggles.threads,
        preauthSession,
      });
    } else if (session) {
      // Session restore (no draft): JWT-pair credentials are the only thing
      // we have. Pyodide path won't work in this case — fetchHydrator
      // throws and the auth-error banner will prompt for a fresh sign-in.
      startLibraryRefresh({
        credentials: {
          accessJwt: session.accessJwt,
          refreshJwt: session.refreshJwt,
          did: session.did,
          pds: session.pds,
        },
        includeThreads: toggles.threads,
        preauthSession,
      });
    } else {
      navigate('/');
    }
  }

  function stop(): void {
    // Cancel whatever's active — orchestrator-driven refresh and any
    // independently-triggered asset hydration (e.g., started from Settings).
    stopLibraryRefresh();
    cancelImageBackup();
    cancelArticleBackup();
    cancelThreadHydration();
  }

  $: snap = $capabilitySnapshot;
  $: dominantBackend = computeDominantBackend(snap);
  $: postCount = $inventoryState.status === 'ready' ? $inventoryState.inventory.saves.length : 0;

  // Helper-relationship banners render above the Backups panel — they
  // need to be visible in every inventoryState (loading / empty /
  // error / ready), not just ready. Earlier these lived in
  // LibraryStatusPanel, which is gated on `status === 'ready'`. That
  // meant a first-time hosted-PWA user with a helper running but no
  // inventory could never see the PairingRequiredBanner: the helper
  // 401s their /fetch, the orchestrator surfaces an error, the user
  // sits on "First fetch in progress…" forever with no way to pair.
  $: helperVersion = snap.helper.detected ? snap.helper.version : '';
  $: outdated = snap.helper.detected && isHelperOutdated(snap.helper.version);
  $: helperProtocol = snap.helper.detected ? snap.helper.protocol : undefined;
  $: protocolMismatch = isProtocolNewerThanKnown(helperProtocol);
  // Both 'unpaired' (no token ever) and 'stale' (helper rejected the
  // token) show the banner identically — the user's next action is the
  // same in either case.
  $: needsPairing = snap.helper.detected && $pairingToken.state !== 'paired';
  $: refreshStateForBanner = $libraryRefreshState;

  // Auto-open the pairing modal the first time we land on Library with
  // a detected helper, no paired token, and no inventory yet (i.e., the
  // exact first-time-use shape where the user just signed in and the
  // initial /fetch 401'd). The banner explains the situation too, but
  // surfacing the modal directly saves a click and matches the user's
  // intent — they just signed in expecting backups to work. Guarded by
  // `pairingAutoOpened` so closing without pairing doesn't re-trigger
  // every reactive update; the user can re-open via the banner's Pair
  // button.
  $: if (
    needsPairing &&
    !pairingOpen &&
    !pairingAutoOpened &&
    $inventoryState.status === 'empty'
  ) {
    pairingAutoOpened = true;
    pairingOpen = true;
  }

  // When pairing succeeds (PairingModal dispatches 'change'), immediately
  // re-trigger the refresh. Without this, the user is left on the
  // Library with a stale error banner from the failed first /fetch and
  // has to click Refresh manually — confusing because they just paired
  // and would reasonably expect it to "just work" now.
  function onPairingSuccess(): void {
    pairingOpen = false;
    refresh();
  }

  // Escape hatch for users who don't want this browser to use the
  // local helper (Safari users for whom mixed-content blocks the
  // helper path anyway, paranoid users keeping hosted-GUI and helper
  // strictly isolated, etc.). Persists the preference, closes the
  // modal, and re-inits the capability snapshot so routing
  // immediately falls back to non-helper paths. Reversible from
  // Settings → Backups.
  async function onDeclinePairing(): Promise<void> {
    pairingOpen = false;
    pairingAutoOpened = true; // belt-and-suspenders against the next reactive cycle
    await setHelperOptOut(true);
    await initCapabilitySnapshot();
    // The snapshot re-init drops helper.detected to false, which makes
    // `needsPairing` false, which hides the banner. The next refresh
    // (manual or auto) will use Pyodide.
    refresh();
  }
  $: refreshing =
    $libraryRefreshState.status === 'running' ||
    $threadProgress.status === 'running' ||
    $threadProgress.status === 'cancelling' ||
    $imageHydration.status === 'running' ||
    $articleHydration.status === 'running';

  $: failureRows = failuresOpen === 'images'
    ? $imageHydration.failures.map((f) => ({ ...f, type: 'image' as const }))
    : failuresOpen === 'articles'
      ? $articleHydration.failures.map((f) => ({ ...f, type: 'article' as const }))
      : failuresOpen === 'threads'
        ? $threadProgress.failures.map((f) => ({ ...f, type: 'thread' as const }))
        : [];

  $: failuresTitle =
    failuresOpen === 'images'
      ? 'Image backup failures'
      : failuresOpen === 'articles'
        ? 'Article backup failures'
        : 'Thread backup failures';

  $: failuresInventory = $inventoryState.status === 'ready' ? $inventoryState.inventory : null;

  // Indeterminate progress bar under the Library title for the entire
  // "we're fetching" phase — from sign-in submit through to fetch
  // completion. This intentionally INCLUDES the Pyodide-load phase
  // (helper-absent first run takes ~10s to load WASM + bsky-saves before
  // the fetcher itself starts), so the user always sees an animated
  // signal that something's happening, not just "First fetch in
  // progress…" sitting still.
  $: fetchRunning =
    $libraryRefreshState.status === 'running' &&
    $fetchProgress.status !== 'done';
</script>

<section class="route route--library" use:slideFromRight>
  <div class="library-hub">
    <header class="route__header">
      <div class="route__title-row">
        <h2 class="route__title">
          Library
          {#if $inventoryState.status === 'ready'}
            <span class="route__count">— {postCount} posts</span>
          {/if}
        </h2>
        {#if dominantBackend}
          <span class="route__backend">via {dominantBackend}</span>
        {/if}
        {#if refreshing}
          <button type="button" class="route__refresh" on:click={stop}>Stop</button>
        {:else}
          <button type="button" class="route__refresh" on:click={refresh}>Refresh</button>
        {/if}
      </div>
      <!-- Always-rendered slot so the bar's appearance doesn't shift the
           header layout. Inner span is empty (hence invisible) when idle;
           when fetching, gets the indeterminate animation. -->
      <div
        class="progress-bar progress-bar--header"
        class:progress-bar--indeterminate={fetchRunning}
        aria-hidden={!fetchRunning}
        aria-label={fetchRunning ? 'Fetching posts' : ''}
        role={fetchRunning ? 'progressbar' : undefined}
      ><span></span></div>
    </header>

    <!-- Helper-relationship banners. Rendered here (not inside the
         Backups CollapsibleBlock, where they used to live) so they
         remain visible during empty/loading/error inventory states.
         The Backups panel is gated on `status === 'ready'`, so when
         a first-time hosted-PWA user lands with a helper running but
         no inventory, the pairing prompt has to live somewhere
         outside that gate or it's invisible at exactly the moment
         the user most needs to see it. -->
    {#if refreshStateForBanner.status === 'error' && !needsPairing}
      <!-- AuthErrorBanner is mutually exclusive with PairingRequired.
           A 401 from the helper when the GUI is unpaired surfaces as
           libraryRefreshState.status = 'error', but the user's real
           action is to Pair (not to re-sign-in — they're already
           signed in). Showing both banners gives competing prompts;
           PairingRequiredBanner wins because it points at the actual
           cause. AuthErrorBanner still fires for upstream auth
           failures (PDS createSession, JWT refresh) where pairing
           ISN'T the issue. -->
      <AuthErrorBanner message={refreshStateForBanner.error} />
    {/if}
    {#if outdated}
      <OutdatedHelperBanner version={helperVersion} />
    {/if}
    {#if protocolMismatch && helperProtocol}
      <ProtocolMismatchBanner helperProtocol={helperProtocol} maxKnownProtocol={MAX_KNOWN_PROTOCOL} />
    {/if}
    {#if needsPairing}
      <PairingRequiredBanner
        onPair={() => (pairingOpen = true)}
        onDecline={onDeclinePairing}
      />
    {/if}

    <!-- Backups panel: hidden during the first-ever fetch (status ===
         'empty') so the user isn't asked to think about backups before
         they have any posts to back up. Once inventory is loaded
         (status === 'ready'), the panel becomes a collapsible block —
         default collapsed on first use, preference persisted. -->
    {#if $inventoryState.status === 'ready'}
      <CollapsibleBlock
        label="Backups"
        expanded={!$panelCollapse.backups}
        onToggle={(next) => void setBackupsCollapsed(!next)}
      >
        <LibraryStatusPanel
          onSetupImages={() => (setupOpen = true)}
          onSetupArticles={() => (setupOpen = true)}
          onViewImageFailures={() => (failuresOpen = 'images')}
          onViewArticleFailures={() => (failuresOpen = 'articles')}
          onViewThreadFailures={() => (failuresOpen = 'threads')}
        />
      </CollapsibleBlock>
    {/if}
  </div>

  {#if $inventoryState.status === 'loading'}
    <p class="route__msg">Loading inventory…</p>
  {:else if $inventoryState.status === 'empty'}
    <!-- "First fetch in progress…" is honest only while a refresh is
         actually running. Once it errors (PairingRequired, AuthError, or
         a real upstream failure), the banners above explain the actual
         state and saying "in progress" here is a lie. Suppress in that
         case; the banner is the messaging. -->
    {#if refreshStateForBanner.status !== 'error' && !needsPairing}
      <p class="route__msg">First fetch in progress…</p>
    {/if}
  {:else if $inventoryState.status === 'error'}
    <p class="route__msg">Failed to load inventory: {$inventoryState.message}</p>
  {:else}
    <LibraryView inventory={$inventoryState.inventory} onSelectPost={open} />
  {/if}
</section>

<CustomProxySetupModal
  open={setupOpen}
  on:close={() => (setupOpen = false)}
  on:change={() => initCapabilitySnapshot()}
/>

<PairingModal
  open={pairingOpen}
  on:close={() => (pairingOpen = false)}
  on:change={onPairingSuccess}
/>

<BackupFailuresModal
  open={failuresOpen !== null}
  failures={failureRows}
  inventory={failuresInventory}
  title={failuresTitle}
  on:close={() => (failuresOpen = null)}
/>

<style>
  .route--library { display: flex; flex-direction: column; }
  /* width: 100% so flex column stretches us to the route's full width;
     max-width caps; margin auto centers within the cap. */
  .library-hub {
    width: 100%;
    max-width: 44rem;
    margin: 0 auto;
  }
  .route__header {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    /* No horizontal padding: align flush with .library-hub edges so
       the Library title sits under the topnav title at viewport
       padding 1.5rem, and the Refresh button sits under the topnav
       right edge. Search filter below also has no inset, completing
       the column. Bottom padding is 0.4rem (matching the gap above
       the progress bar) so the spacing below the title row collapses
       to fit just the progress indicator. */
    padding: 0.75rem 0 0.4rem;
  }
  /* Single-row layout for title + backend + Refresh button. align-items:
     end aligns each item's bottom edge so the button's bottom lines up
     with the title text's bottom, rather than centering against the
     title block (which would put the button under the title's midline).
     margin: 0 -10px extends the row 10px outboard on each side so the
     Library title aligns with status-panel-left and the Refresh button
     aligns with status-panel-right — same gridline as the topnav. */
  .route__title-row {
    display: flex;
    gap: 1rem;
    align-items: end;
    margin: 0 -10px;
  }
  .route__title-row .route__title {
    flex: 1;
  }
  .route__title { margin: 0; }
  .route__count { font-weight: 400; opacity: 0.7; }
  /* Indeterminate progress bar for posts fetch — same shape as AssetRow's.
     Always-rendered so its appearance doesn't shift the header layout;
     the inner span is invisible until the indeterminate modifier is added. */
  .progress-bar {
    height: 4px;
    background: color-mix(in oklab, CanvasText 12%, transparent);
    border-radius: 999px;
    overflow: hidden;
    position: relative;
  }
  .progress-bar--header {
    background: transparent;
    /* Match the title-row and status-panel outboard bleed so the
       indicator spans from the Library title's left edge to the
       Refresh button's right edge. */
    margin: 0 -10px;
  }
  .progress-bar--header.progress-bar--indeterminate {
    background: color-mix(in oklab, CanvasText 12%, transparent);
  }
  .progress-bar > span {
    display: block;
    height: 100%;
    background: color-mix(in oklab, royalblue 60%, CanvasText);
    border-radius: 999px;
    position: relative;
  }
  .progress-bar:not(.progress-bar--indeterminate) > span {
    background: transparent;
  }
  .progress-bar--indeterminate > span {
    width: 30%;
    animation: indeterminate 1.6s ease-in-out infinite;
  }
  @keyframes indeterminate {
    0%   { transform: translateX(-100%); }
    50%  { transform: translateX(200%); }
    100% { transform: translateX(-100%); }
  }
  .route__backend { font-size: 0.8rem; opacity: 0.7; margin-right: 0.5rem; }
  .route__refresh {
    font: inherit;
    font-size: 0.875rem;
    padding: 0.35rem 0.75rem;
    border: 1px solid color-mix(in oklab, CanvasText 25%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
  }
  .route__msg {
    padding: 1rem;
    max-width: 44rem;
    margin: 0 auto;
  }
</style>

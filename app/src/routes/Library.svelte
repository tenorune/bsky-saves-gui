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
  import CustomProxySetupModal from '../components/CustomProxySetupModal.svelte';
  import BackupFailuresModal from '../components/BackupFailuresModal.svelte';
  import { rkeyOf } from '../reader/inventory-shape';
  import type { Save } from '../reader/inventory-shape';
  import { restoreHydrationFromInventory } from '$lib/restore-hydration';
  import { saveLibraryScroll, consumeLibraryScroll } from '$lib/library-scroll';

  let setupOpen = false;
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
      <div class="route__title-block">
        <h2 class="route__title">
          Library
          {#if $inventoryState.status === 'ready'}
            <span class="route__count">— {postCount} posts</span>
          {/if}
        </h2>
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
      </div>
      {#if dominantBackend}
        <span class="route__backend">via {dominantBackend}</span>
      {/if}
      {#if refreshing}
        <button type="button" class="route__refresh" on:click={stop}>Stop</button>
      {:else}
        <button type="button" class="route__refresh" on:click={refresh}>Refresh</button>
      {/if}
    </header>

    <LibraryStatusPanel
      onSetupImages={() => (setupOpen = true)}
      onSetupArticles={() => (setupOpen = true)}
      onViewImageFailures={() => (failuresOpen = 'images')}
      onViewArticleFailures={() => (failuresOpen = 'articles')}
      onViewThreadFailures={() => (failuresOpen = 'threads')}
    />
  </div>

  {#if $inventoryState.status === 'loading'}
    <p class="route__msg">Loading inventory…</p>
  {:else if $inventoryState.status === 'empty'}
    <p class="route__msg">First fetch in progress…</p>
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
    padding-bottom: 1.5rem;
  }
  .route__header {
    display: flex;
    gap: 1rem;
    align-items: center;
    /* No horizontal padding: align flush with .library-hub edges so
       the Library title sits under the topnav title at viewport
       padding 1.5rem, and the Refresh button sits under the topnav
       right edge. Search filter below also has no inset, completing
       the column. */
    padding: 0.75rem 0;
    border-bottom: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
  }
  .route__title-block { flex: 1; display: flex; flex-direction: column; gap: 0.4rem; }
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

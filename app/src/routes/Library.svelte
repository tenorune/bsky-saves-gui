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
  import { assetToggles } from '$lib/asset-toggles';
  import { capabilitySnapshot } from '$lib/capability-snapshot';
  import { computeDominantBackend } from '$lib/dominant-backend';
  import { imageHydration, articleHydration, threadProgress } from '$lib/hydration-state';
  import LibraryView from '../reader/LibraryView.svelte';
  import LibraryStatusPanel from '../components/LibraryStatusPanel.svelte';
  import CustomProxySetupModal from '../components/CustomProxySetupModal.svelte';
  import BackupFailuresModal from '../components/BackupFailuresModal.svelte';
  import { rkeyOf } from '../reader/inventory-shape';
  import type { Save } from '../reader/inventory-shape';
  import { restoreHydrationFromInventory } from '$lib/restore-hydration';

  let setupOpen = false;
  let failuresOpen: 'images' | 'articles' | null = null;

  onMount(async () => {
    if (get(inventoryState).status === 'loading') {
      await loadFromDb();
    }
    const s = get(inventoryState);
    if (s.status === 'ready') {
      await restoreHydrationFromInventory(s.inventory);
    }
  });

  function open(save: Save): void {
    navigate(`/post/${rkeyOf(save.uri)}`);
  }

  function refresh(): void {
    const draft = get(signInDraft);
    const session = get(lastSession);
    const toggles = get(assetToggles);

    if (draft && draft.appPassword) {
      // Password mode (fresh sign-in)
      startLibraryRefresh({
        credentials: { handle: draft.handle, appPassword: draft.appPassword, pds: draft.pds },
        includeThreads: toggles.threads,
      });
    } else if (session) {
      // Session mode (JWT-pair restore)
      startLibraryRefresh({
        credentials: {
          accessJwt: session.accessJwt,
          refreshJwt: session.refreshJwt,
          did: session.did,
          pds: session.pds,
        },
        includeThreads: toggles.threads,
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
    // Threads hydration doesn't have a cancel API yet; the in-flight call
    // will complete naturally. The button at least flips back so the user
    // sees their click was acknowledged.
  }

  $: snap = $capabilitySnapshot;
  $: dominantBackend = computeDominantBackend(snap);
  $: postCount = $inventoryState.status === 'ready' ? $inventoryState.inventory.saves.length : 0;
  $: refreshing =
    $libraryRefreshState.status === 'running' ||
    $threadProgress.status === 'running' ||
    $imageHydration.status === 'running' ||
    $articleHydration.status === 'running';

  $: failureRows = failuresOpen === 'images'
    ? $imageHydration.failures.map((f) => ({ ...f, type: 'image' as const }))
    : failuresOpen === 'articles'
      ? $articleHydration.failures.map((f) => ({ ...f, type: 'article' as const }))
      : [];

  $: failuresInventory = $inventoryState.status === 'ready' ? $inventoryState.inventory : null;
</script>

<section class="route route--library" use:slideFromRight>
  <div class="library-hub">
    <header class="route__header">
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
    </header>

    <LibraryStatusPanel
      onSetupImages={() => (setupOpen = true)}
      onSetupArticles={() => (setupOpen = true)}
      onViewImageFailures={() => (failuresOpen = 'images')}
      onViewArticleFailures={() => (failuresOpen = 'articles')}
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

<CustomProxySetupModal open={setupOpen} on:close={() => (setupOpen = false)} />

<BackupFailuresModal
  open={failuresOpen !== null}
  failures={failureRows}
  inventory={failuresInventory}
  title={failuresOpen === 'images' ? 'Image backup failures' : 'Article backup failures'}
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
    padding: 0.75rem 1rem;
    border-bottom: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
  }
  .route__title { margin: 0; font-size: 1rem; flex: 1; }
  .route__count { font-weight: 400; opacity: 0.7; }
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

<script lang="ts">
  import { capabilitySnapshot } from '$lib/capability-snapshot';
  import { assetToggles } from '$lib/asset-toggles';
  import { installHintDismissed } from '$lib/install-hint-pref';
  import { libraryRefreshState } from '$lib/library-refresh';
  import { imageHydration, articleHydration, threadProgress } from '$lib/hydration-state';
  import { computeDominantBackend } from '$lib/dominant-backend';
  import { isHelperOutdated } from '$lib/min-helper-version';
  import AssetRow from './library-status/AssetRow.svelte';
  import AuthErrorBanner from './library-status/AuthErrorBanner.svelte';
  import OutdatedHelperBanner from './library-status/OutdatedHelperBanner.svelte';
  import InstallHelperHint from './library-status/InstallHelperHint.svelte';

  /** Optional callbacks the parent can pass; if undefined, the row hides the affordance. */
  export let onSetupImages: (() => void) | null = null;
  export let onSetupArticles: (() => void) | null = null;
  export let onViewImageFailures: (() => void) | null = null;
  export let onViewArticleFailures: (() => void) | null = null;
  export let onViewThreadFailures: (() => void) | null = null;

  $: snap = $capabilitySnapshot;
  $: toggles = $assetToggles;
  $: dominantBackend = computeDominantBackend(snap);

  // Per-row backend label: only when it differs from the dominant.
  function labelFor(kind: string): string | null {
    switch (kind) {
      case 'helper': return 'local helper';
      case 'user-worker': return 'your worker proxy';
      case 'operator-worker': return "operator's worker proxy";
      default: return null;
    }
  }
  function rowBackend(kind: string): string | null {
    const own = labelFor(kind);
    if (!own) return null;
    if (own === dominantBackend) return null;
    return own;
  }

  $: outdated = snap.helper.detected && isHelperOutdated(snap.helper.version);
  $: helperVersion = snap.helper.detected ? snap.helper.version : '';
  $: pyodideOnly = !snap.helper.detected;

  // Threads
  $: threadsTotal = $threadProgress.total || null;
  $: threadsFetched = $threadProgress.fetched || null;
  $: threadsFailed = $threadProgress.failed;
  $: threadsRunning = $threadProgress.status === 'running';
  $: threadsProgress =
    threadsRunning && threadsTotal && (threadsFetched ?? 0) > 0
      ? Math.min(1, ($threadProgress.fetched ?? 0) / threadsTotal)
      : threadsRunning
      ? 'indeterminate' as const
      : null;

  // Images. Display fetched+skipped as cumulative coverage so the count
  // doesn't reset to zero each refresh — skipped reflects images already
  // present in IDB from prior runs; fetched is this-run's newly-fetched.
  // Together they're the total hydrated.
  $: imagesTotal = $imageHydration.total || null;
  $: imagesHydrated = $imageHydration.fetched + $imageHydration.skipped;
  $: imagesFetched = imagesHydrated > 0 ? imagesHydrated : null;
  $: imagesFailed = $imageHydration.failed;
  $: imagesRunning = $imageHydration.status === 'running';
  $: imagesProgressFrac =
    imagesRunning && imagesTotal && imagesHydrated > 0
      ? Math.min(1, imagesHydrated / imagesTotal)
      : imagesRunning
      ? 'indeterminate' as const
      : null;

  // Articles — same treatment as images.
  $: articlesBackendAvailable = snap.articles.kind !== 'none';
  $: articlesTotal = $articleHydration.total || null;
  $: articlesHydrated = $articleHydration.fetched + $articleHydration.skipped;
  $: articlesFetched = articlesHydrated > 0 ? articlesHydrated : null;
  $: articlesFailed = $articleHydration.failed;
  $: articlesRunning = $articleHydration.status === 'running';
  $: articlesProgressFrac =
    articlesRunning && articlesTotal && articlesHydrated > 0
      ? Math.min(1, articlesHydrated / articlesTotal)
      : articlesRunning
      ? 'indeterminate' as const
      : null;

  $: refreshState = $libraryRefreshState;
</script>

<section class="status-panel" aria-label="Library status">
  {#if refreshState.status === 'error'}
    <AuthErrorBanner message={refreshState.error} />
  {/if}
  {#if outdated}
    <OutdatedHelperBanner version={helperVersion} />
  {/if}

  <AssetRow
    label="Threads"
    on={toggles.threads}
    backendAvailable={true}
    backendLabel={rowBackend(snap.threads.kind)}
    fetched={threadsFetched}
    total={threadsTotal}
    failed={threadsFailed}
    progress={threadsProgress}
    onViewFailures={onViewThreadFailures}
  />
  <AssetRow
    label="Images"
    on={toggles.images}
    backendAvailable={true}
    backendLabel={rowBackend(snap.images.kind)}
    fetched={imagesFetched}
    total={imagesTotal}
    failed={imagesFailed}
    progress={imagesProgressFrac}
    onSetup={onSetupImages}
    onViewFailures={onViewImageFailures}
  />
  <AssetRow
    label="Articles"
    on={toggles.articles}
    backendAvailable={articlesBackendAvailable}
    backendLabel={rowBackend(snap.articles.kind)}
    fetched={articlesFetched}
    total={articlesTotal}
    failed={articlesFailed}
    progress={articlesProgressFrac}
    onSetup={onSetupArticles}
    onViewFailures={onViewArticleFailures}
  />

  {#if pyodideOnly && !$installHintDismissed}
    <InstallHelperHint />
  {/if}
</section>

<style>
  .status-panel {
    padding: 0.6rem 1rem;
    background: color-mix(in oklab, CanvasText 4%, Canvas);
    font-size: 0.875rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
</style>

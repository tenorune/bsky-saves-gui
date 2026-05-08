<script lang="ts">
  import { capabilitySnapshot } from '$lib/capability-snapshot';
  import { assetToggles, setAssetToggle } from '$lib/asset-toggles';
  import { installHintDismissed } from '$lib/install-hint-pref';
  import { libraryRefreshState } from '$lib/library-refresh';
  import { imageHydration, articleHydration, threadProgress } from '$lib/hydration-state';
  import { computeDominantBackend, prospectiveBackendName } from '$lib/dominant-backend';
  import { isHelperOutdated } from '$lib/min-helper-version';
  import { triggerThreadHydration, triggerImageHydration, triggerArticleHydration } from '$lib/asset-trigger';
  import { disableOperatorProxy } from '$lib/disable-operator-proxy';
  import { cancelImageBackup } from '$lib/start-image-backup';
  import { cancelArticleBackup } from '$lib/start-article-backup';
  import { cancelThreadHydration } from '$lib/thread-hydrator';
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

  // Wire row badges to the same persistent state Settings's checkboxes use.
  // Off→on flip kicks off the matching hydrator over the existing inventory
  // (mirrors Settings's behavior); on→off cancels any in-flight hydration
  // for that asset so the user's intent ("don't back this up") takes effect
  // immediately rather than after the current loop drains.
  function toggleThreads(next: boolean) {
    if (!next) cancelThreadHydration();
    void setAssetToggle('threads', next, { onThreadsToggleOn: triggerThreadHydration });
  }
  function toggleImages(next: boolean) {
    if (!next) cancelImageBackup();
    void setAssetToggle('images', next, { onImagesToggleOn: triggerImageHydration });
  }
  function toggleArticles(next: boolean) {
    if (!next) cancelArticleBackup();
    void setAssetToggle('articles', next, { onArticlesToggleOn: triggerArticleHydration });
  }

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

  // Threads. Same cumulative-coverage shape as images/articles —
  // fetched is this-run's newly-hydrated count, skipped is saves that
  // already had thread_replies populated before this run started.
  // Together they're the total hydrated.
  $: threadsTotal = $threadProgress.total || null;
  $: threadsHydrated = $threadProgress.fetched + $threadProgress.skipped;
  $: threadsFetched = threadsHydrated > 0 ? threadsHydrated : null;
  $: threadsFailed = $threadProgress.failed;
  // 'cancelling' is the post-click window where Pyodide is still flushing
  // the inventory after a cancel; treat it like 'running' for the progress
  // bar so the UI keeps animating until the snapshot lands.
  $: threadsCancelling = $threadProgress.status === 'cancelling';
  $: threadsRunning = $threadProgress.status === 'running' || threadsCancelling;
  $: threadsStatusHint = threadsCancelling ? 'Saving partial progress…' : null;
  $: threadsProgress =
    threadsRunning && threadsTotal && threadsHydrated > 0
      ? Math.min(1, threadsHydrated / threadsTotal)
      : threadsRunning
      ? 'indeterminate' as const
      : null;

  // Images. Display fetched+skipped as cumulative coverage so the count
  // doesn't reset to zero each refresh — skipped reflects images already
  // present in IDB from prior runs; fetched is this-run's newly-fetched.
  // Together they're the total hydrated.
  $: imagesBackendAvailable = snap.images.kind !== 'none';
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

  // Tooltip text shown on the OFF badge: "would use {proxy}" for proxy
  // backends, or "no backend available" when articles routes to 'none'.
  // Null when the asset would route through helper or pyodide (those are
  // the implicit "just works" cases the user doesn't need to think about).
  function offTooltipFor(kind: string): string | null {
    if (kind === 'none') return 'no backend available';
    const name = prospectiveBackendName(kind);
    return name ? `would use ${name}` : null;
  }
  $: imagesOffTooltip = offTooltipFor(snap.images.kind);
  $: articlesOffTooltip = offTooltipFor(snap.articles.kind);

  // When images are routed (or would be routed) through the operator's
  // worker proxy, surface a one-click "Don't use" affordance — same
  // effect as the matching checkbox in Settings > Advanced.
  $: imagesProxyOptOut =
    snap.images.kind === 'operator-worker'
      ? { name: "operator's worker proxy", onDisable: () => void disableOperatorProxy() }
      : null;
  // Threads only ever routes through helper or pyodide — no proxy info to surface.
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
    statusHint={threadsStatusHint}
    onViewFailures={onViewThreadFailures}
    onToggle={toggleThreads}
  />
  <AssetRow
    label="Images"
    on={toggles.images}
    backendAvailable={imagesBackendAvailable}
    backendLabel={rowBackend(snap.images.kind)}
    fetched={imagesFetched}
    total={imagesTotal}
    failed={imagesFailed}
    progress={imagesProgressFrac}
    onSetup={onSetupImages}
    onViewFailures={onViewImageFailures}
    onToggle={toggleImages}
    offTooltip={imagesOffTooltip}
    proxyOptOut={imagesProxyOptOut}
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
    onToggle={toggleArticles}
    offTooltip={articlesOffTooltip}
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

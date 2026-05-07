<script lang="ts">
  /** Display label, e.g. "Threads". */
  export let label: string;
  /** Whether the asset toggle is on. */
  export let on: boolean;
  /** Whether a backend is available for this asset (false → "no backend available"). */
  export let backendAvailable: boolean;
  /** Per-row backend label, only rendered when it differs from the dominant. */
  export let backendLabel: string | null = null;
  /** Counts. total=null means "no count to show yet" (e.g., posts pre-fetch). */
  export let fetched: number | null = null;
  export let total: number | null = null;
  export let failed: number | null = null;
  /** Optional progress fraction 0..1 for the active phase. null = no progress bar. */
  export let progress: number | null = null;
  /** Set up callback shown when on && !backendAvailable. */
  export let onSetup: (() => void) | null = null;
  /** View failures callback shown when failed > 0. */
  export let onViewFailures: (() => void) | null = null;
</script>

<div class="row">
  <span class="label">{label}</span>
  {#if !on}
    <span class="badge badge--off">off</span>
  {:else if !backendAvailable}
    <span class="needs-setup">no backend available</span>
    {#if onSetup}
      <button type="button" class="action-link" on:click={onSetup}>Set up</button>
    {/if}
  {:else}
    <span class="badge badge--on">on</span>
    {#if total !== null && fetched !== null}
      <span>
        {fetched} of {total}
        {#if failed && failed > 0}
          <span class="muted">(<span class="inline-error">{failed} failed</span>{#if onViewFailures} · <button type="button" class="action-link" on:click={onViewFailures}>view</button>{/if})</span>
        {/if}
      </span>
    {/if}
    {#if backendLabel}
      <span class="backend">via {backendLabel}</span>
    {/if}
    {#if progress !== null}
      <div class="progress-bar"><span style="width: {Math.round(progress * 100)}%"></span></div>
    {/if}
  {/if}
</div>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    align-items: baseline;
  }
  .label { font-weight: 600; min-width: 4.5rem; display: inline-block; }
  .muted { opacity: 0.7; }
  .badge {
    font-size: 0.75rem;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    border: 1px solid color-mix(in oklab, CanvasText 25%, transparent);
    color: color-mix(in oklab, CanvasText 75%, Canvas);
  }
  .badge--on {
    background: color-mix(in oklab, mediumseagreen 18%, Canvas);
    border-color: color-mix(in oklab, mediumseagreen 35%, transparent);
  }
  .badge--off { opacity: 0.55; }
  .progress-bar {
    flex-basis: 100%;
    height: 4px;
    margin-top: 0.35rem;
    background: color-mix(in oklab, CanvasText 12%, transparent);
    border-radius: 999px;
    overflow: hidden;
  }
  .progress-bar > span {
    display: block;
    height: 100%;
    background: color-mix(in oklab, royalblue 60%, CanvasText);
    border-radius: 999px;
  }
  .backend { font-size: 0.8rem; opacity: 0.7; }
  .needs-setup {
    color: color-mix(in oklab, CanvasText 65%, Canvas);
    font-style: italic;
  }
  .inline-error { color: color-mix(in oklab, red 75%, CanvasText); }
  .action-link {
    font: inherit;
    font-size: 0.8rem;
    background: none;
    border: 0;
    padding: 0.1rem 0.25rem;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
</style>

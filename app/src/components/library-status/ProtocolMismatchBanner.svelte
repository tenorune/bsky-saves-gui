<script lang="ts">
  /**
   * Helper's reported protocol value. Surfaced in the banner copy so
   * the user can see the mismatch (helper protocol vs what their GUI
   * supports) without opening DevTools.
   */
  export let helperProtocol: string;
  /** Protocol the GUI is built to talk to (the constant from min-helper-version.ts). */
  export let maxKnownProtocol: string;
</script>

<div class="protocol-mismatch" role="alert">
  <span>
    Your helper is newer than this GUI knows how to use (helper protocol {helperProtocol}, GUI supports up to {maxKnownProtocol}). Some features may not work.
  </span>
  <button type="button" class="protocol-mismatch__action" on:click={() => location.reload()}>
    Reload to update
  </button>
</div>

<style>
  /* Same gold-tinted family as OutdatedHelperBanner and
     PairingRequiredBanner — all three are "your helper relationship
     needs attention" variants of one visual treatment. */
  .protocol-mismatch {
    /* -10px left/right matches .route__title-row and .progress-bar--header
       in Library.svelte so the banner spans from the Library title's left
       edge to the Refresh button's right edge. */
    margin: 0 -10px 0.6rem;
    padding: 0.5rem 0.7rem;
    border-radius: 6px;
    background: color-mix(in oklab, gold 18%, Canvas);
    border: 1px solid color-mix(in oklab, gold 40%, transparent);
    font-size: 0.875rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }
  .protocol-mismatch__action {
    margin-left: auto;
    font: inherit;
    font-size: 0.8rem;
    padding: 0.25rem 0.6rem;
    border: 1px solid color-mix(in oklab, CanvasText 25%, transparent);
    border-radius: 4px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
  }
</style>

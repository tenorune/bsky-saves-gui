<script lang="ts">
  /**
   * Click handler for the primary "Pair" action. Opens whatever
   * pairing UI the parent has wired up (typically PairingModal).
   * Required because there's no point rendering the banner without
   * a way to act on it.
   */
  export let onPair: () => void;
  /**
   * Click handler for the secondary "Don't pair" action. Persists a
   * "skip the helper from this browser" preference; parent should
   * also dismiss the modal (if open) and re-init the capability
   * snapshot so the GUI routes through Pyodide / worker paths.
   */
  export let onDecline: () => void;
</script>

<div class="pairing-required" role="alert">
  <span class="pairing-required__text">
    Local helper detected — pair to enable backups.
  </span>
  <button type="button" class="pairing-required__action" on:click={onPair}>
    Pair
  </button>
  <button type="button" class="pairing-required__decline" on:click={onDecline}>
    Don't pair
  </button>
</div>

<style>
  /* Same gold-tinted family as OutdatedHelperBanner and
     ProtocolMismatchBanner — all three are "your helper relationship
     needs attention" variants of one visual treatment. */
  .pairing-required {
    /* -10px left/right matches .route__title-row and .progress-bar--header
       in Library.svelte so the banner spans from the Library title's left
       edge to the Refresh button's right edge, instead of narrowing in to
       the inner .library-hub width. */
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
  .pairing-required__text { flex: 1 1 18rem; }
  .pairing-required__action {
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
  /* Decline is intentionally subtler — text-link styling, no border,
     so the visual weight clearly favours "Pair" as the primary action. */
  .pairing-required__decline {
    font: inherit;
    font-size: 0.8rem;
    padding: 0.25rem 0.3rem;
    background: none;
    border: 0;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
    opacity: 0.7;
  }
  .pairing-required__decline:hover { opacity: 1; }
</style>

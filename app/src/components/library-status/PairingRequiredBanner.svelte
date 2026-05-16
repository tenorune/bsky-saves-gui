<script lang="ts">
  /**
   * Click handler for the "Pair" action. The button opens whatever
   * pairing UI the parent route has wired up — typically the
   * PairingModal. Required (not nullable) because there's no point
   * rendering the banner without a way to act on it.
   */
  export let onPair: () => void;
</script>

<div class="pairing-required" role="alert">
  <span>
    Local helper detected — pair to enable backups.
  </span>
  <button type="button" class="pairing-required__action" on:click={onPair}>
    Pair
  </button>
</div>

<style>
  /* Same gold-tinted background as OutdatedHelperBanner — the two are
     in the same "your helper needs attention" family and should read
     as variants of one visual treatment rather than two unrelated
     notifications. */
  .pairing-required {
    margin: 0 0 0.6rem;
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
</style>

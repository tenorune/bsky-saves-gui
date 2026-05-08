<script lang="ts">
  import { dismissInstallHint } from '$lib/install-hint-pref';

  /** When false, render only the tip text + "How to install" link (no dismiss). */
  export let showDismiss: boolean = true;
</script>

<div class="install-hint" class:install-hint--compact={!showDismiss}>
  <span>
    Tip: install <code>bsky-saves</code> locally for faster fetch and built-in image &amp; article backup.
  </span>
  <a class="install-hint__link" href="https://github.com/tenorune/bsky-saves#install" target="_blank" rel="noopener noreferrer">How to install</a>
  {#if showDismiss}
    <button type="button" class="install-hint__dismiss" on:click={dismissInstallHint}>Dismiss</button>
  {/if}
</div>

<style>
  .install-hint {
    margin-top: 0.6rem;
    margin-bottom: 0.6rem;
    padding-top: 0.5rem;
    border-top: 1px solid color-mix(in oklab, CanvasText 10%, transparent);
    font-size: 0.85rem;
    opacity: 0.75;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: baseline;
  }
  /* Compact variant for Settings: tighter top spacing but keep the symmetric
     borders so the tip is bracketed by thin lines top and bottom. */
  .install-hint--compact {
    margin-top: 0.25rem;
    padding-top: 0.5rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid color-mix(in oklab, CanvasText 10%, transparent);
  }
  .install-hint__link, .install-hint__dismiss {
    font: inherit;
    font-size: 0.8rem;
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .install-hint__dismiss { margin-left: auto; }
</style>

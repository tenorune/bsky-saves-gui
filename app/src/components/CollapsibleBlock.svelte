<script lang="ts">
  export let label: string;
  export let expanded: boolean;
  export let onToggle: (next: boolean) => void;
  /**
   * When true (default), the block bleeds 10px outboard on each side
   * via negative margin — matches the Library hub's panel alignment.
   * Set to false in narrower in-form contexts (SignIn "Advanced",
   * Settings "Advanced backup options") where the block should sit at
   * the surrounding content's edges, not past them.
   */
  export let bleed: boolean = true;

  // ARIA pairing: the trigger's aria-controls + the body's id, so screen
  // readers announce which region the button expands.
  let bodyId = `collapsible-${Math.random().toString(36).slice(2, 9)}`;
</script>

<section
  class="collapsible"
  class:collapsible--expanded={expanded}
  class:collapsible--bleed={bleed}
>
  <button
    type="button"
    class="collapsible__header"
    aria-expanded={expanded}
    aria-controls={bodyId}
    on:click={() => onToggle(!expanded)}
  >
    <span class="collapsible__caret" aria-hidden="true"></span>
    <span class="collapsible__label">{label}</span>
  </button>
  {#if expanded}
    <div class="collapsible__body" id={bodyId}>
      <slot />
    </div>
  {/if}
</section>

<style>
  /* overflow: hidden so the header/body backgrounds get clipped by the
     block's rounded corners, instead of either child painting past the
     curve. */
  .collapsible {
    margin: 0 0 0.4rem;
    border-radius: 6px;
    overflow: hidden;
  }
  /* Bleed 10px outboard on each side via negative margin — matches the
     Library hub's existing pattern so collapsed headers align with the
     topnav title and Refresh-button column. */
  .collapsible--bleed {
    margin-left: -10px;
    margin-right: -10px;
  }
  /* Header is the full-width trigger. When collapsed it IS the block.
     Background sits a notch darker (in light mode) / lighter (in dark
     mode) than the body so the two read as visually distinct rows. */
  .collapsible__header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 10px;
    background: rgba(0, 0, 0, 0.10);
    border: 0;
    color: inherit;
    font: inherit;
    font-size: 0.875rem;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }
  @media (prefers-color-scheme: dark) {
    .collapsible__header {
      background: rgba(255, 255, 255, 0.14);
    }
  }
  .collapsible__header:focus-visible {
    outline: 2px solid color-mix(in oklab, royalblue 60%, CanvasText);
    outline-offset: -2px;
  }
  /* Caret painted from two borders — points right when collapsed, down
     when expanded. currentColor so it tracks the theme automatically. */
  .collapsible__caret {
    width: 0.5rem;
    height: 0.5rem;
    border-right: 2px solid currentColor;
    border-bottom: 2px solid currentColor;
    transform: rotate(-45deg);
    transition: transform 150ms ease;
    opacity: 0.7;
    flex: 0 0 auto;
  }
  .collapsible--expanded .collapsible__caret {
    transform: rotate(45deg);
  }
  /* Body sits a notch lighter than the header in light mode (and
     conversely a notch darker than the header in dark mode). Padding-top
     gives clear separation between the header row and the first content
     item; padding-bottom mirrors it so content doesn't crowd the bottom
     edge of the block. */
  .collapsible__body {
    padding: 0.75rem 10px;
    background: rgba(0, 0, 0, 0.05);
  }
  @media (prefers-color-scheme: dark) {
    .collapsible__body {
      background: rgba(255, 255, 255, 0.07);
    }
  }
</style>

<script lang="ts">
  export let label: string;
  export let expanded: boolean;
  export let onToggle: (next: boolean) => void;

  // ARIA pairing: the trigger's aria-controls + the body's id, so screen
  // readers announce which region the button expands.
  let bodyId = `collapsible-${Math.random().toString(36).slice(2, 9)}`;
</script>

<section class="collapsible" class:collapsible--expanded={expanded}>
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
  /* Bleed 10px outboard on each side via negative margin (matching the
     status-panel's existing pattern) so collapsed headers align with
     the topnav and the Library title column. */
  .collapsible {
    margin: 0 -10px 0.4rem;
    background: rgba(0, 0, 0, 0.06);
    border-radius: 6px;
  }
  @media (prefers-color-scheme: dark) {
    .collapsible {
      background: rgba(255, 255, 255, 0.08);
    }
  }
  /* Header is the full-width trigger. When collapsed it IS the block. */
  .collapsible__header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 10px;
    background: transparent;
    border: 0;
    border-radius: 6px;
    color: inherit;
    font: inherit;
    font-size: 0.875rem;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }
  .collapsible__header:focus-visible {
    outline: 2px solid color-mix(in oklab, royalblue 60%, CanvasText);
    outline-offset: -2px;
  }
  /* Caret painted from two borders — points right when collapsed, down
     when expanded. Currents-color so it tracks the theme automatically. */
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
  .collapsible__body {
    padding: 0 10px 0.6rem;
  }
</style>

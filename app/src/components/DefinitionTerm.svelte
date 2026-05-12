<!--
  Carbon-style definition tooltip: a term with a dotted underline that
  reveals an inline help bubble on hover, focus, or tap. The bubble is
  always present in the DOM (referenced by aria-describedby on the term
  button) so screen readers announce the help when the term receives
  focus, regardless of whether it's visually shown.

  Usage:
    <DefinitionTerm>
      <span slot="term">App password</span>
      Don't use your real Bluesky password. Make an app password in…
    </DefinitionTerm>

  Visual reveal: CSS :hover / :focus-within on the wrapper. No JS
  toggling — moving the cursor onto the bubble keeps it open because
  the bubble is a child of the wrapper.
-->
<script lang="ts">
  // Stable id for aria-describedby ↔ tooltip body pairing. Math.random
  // collision odds are vanishingly low across one page; no need for
  // crypto.randomUUID.
  const bubbleId = `dt-${Math.random().toString(36).slice(2, 9)}`;
</script>

<span class="dt">
  <button type="button" class="dt__term" aria-describedby={bubbleId}>
    <slot name="term" />
  </button>
  <span class="dt__bubble" id={bubbleId} role="tooltip">
    <slot />
  </span>
</span>

<style>
  .dt {
    position: relative;
    display: inline-block;
  }
  .dt__term {
    font: inherit;
    color: inherit;
    background: none;
    border: 0;
    padding: 0;
    cursor: help;
    text-decoration: underline dotted;
    text-underline-offset: 0.2em;
  }
  .dt__term:focus-visible {
    outline: 2px solid color-mix(in oklab, royalblue 70%, transparent);
    outline-offset: 2px;
    border-radius: 2px;
  }
  .dt__bubble {
    position: absolute;
    top: calc(100% + 0.35rem);
    left: 0;
    z-index: 100;
    min-width: 16rem;
    max-width: min(28rem, 92vw);
    padding: 0.625rem 0.75rem;
    background: Canvas;
    color: CanvasText;
    border: 1px solid color-mix(in oklab, CanvasText 25%, transparent);
    border-radius: 6px;
    box-shadow: 0 4px 12px color-mix(in oklab, CanvasText 15%, transparent);
    font-size: 0.875rem;
    font-weight: normal;
    line-height: 1.4;
    text-align: left;
    opacity: 0;
    pointer-events: none;
    transition: opacity 100ms ease;
  }
  .dt:hover .dt__bubble,
  .dt:focus-within .dt__bubble {
    opacity: 1;
    pointer-events: auto;
  }
</style>

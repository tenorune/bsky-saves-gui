<script lang="ts">
  export let from: string | null = null;
  export let to: string | null = null;

  function fromInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    from = v.length > 0 ? v : null;
  }
  function toInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    to = v.length > 0 ? v : null;
  }
</script>

<div class="date-range" role="group" aria-label="Date range">
  <label>
    <span>From</span>
    <!-- Empty-state hint: iOS Safari renders <input type="date"> with no
         placeholder, so without an overlay there's no visual cue the
         empty box is a date picker. Other browsers DO render a native
         placeholder (Chrome shows "dd.mm.yyyy"; Safari Desktop previews
         today's date). To avoid two hints stacking, the empty input
         itself is rendered with color: transparent — the native
         placeholder vanishes and our overlay is the only visible hint.
         On :focus the input's text color reverts and the overlay hides,
         so the user sees the native picker UI cleanly. -->
    <span class="date-range__input">
      <input
        type="date"
        value={from ?? ''}
        on:input={fromInput}
        class:date-range__field--empty={!from}
      />
      {#if !from}<span class="date-range__placeholder">dd.mm.yyyy</span>{/if}
    </span>
  </label>
  <label>
    <span>To</span>
    <span class="date-range__input">
      <input
        type="date"
        value={to ?? ''}
        on:input={toInput}
        class:date-range__field--empty={!to}
      />
      {#if !to}<span class="date-range__placeholder">dd.mm.yyyy</span>{/if}
    </span>
  </label>
</div>

<style>
  .date-range {
    display: flex;
    gap: 0.75rem;
    align-items: end;
  }
  .date-range__input {
    position: relative;
    display: block;
  }
  /* Suppress the native empty-state display (placeholder text in Chrome,
     today's-date preview in Safari Desktop) by setting the input text
     transparent while empty. Reverts on focus so the picker UI's text
     is visible when the user is actively choosing. */
  .date-range__input input.date-range__field--empty {
    color: transparent;
  }
  .date-range__input input.date-range__field--empty:focus {
    color: CanvasText;
  }
  .date-range__placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    padding: 0 0.75rem;
    pointer-events: none;
    opacity: 0.5;
    font-size: 1rem;
    line-height: 1.25;
  }
  /* Hide our overlay while the user is interacting with the input so
     the native picker UI (calendar icon, opened picker dropdown) has
     a clean field to paint into. */
  .date-range__input input:focus + .date-range__placeholder {
    display: none;
  }
</style>

<script lang="ts">
  export let from: string | null = null;
  export let to: string | null = null;

  // Safari quirk: on focus of an empty <input type="date">, Safari
  // pre-fills today's date as an editing template (Desktop in US
  // mm/dd/yyyy slashes, regardless of locale; iOS doesn't show it
  // because the picker modal takes over). With our color: transparent
  // rule for the empty state, that template appears the moment focus
  // lands. Chrome and Firefox instead show a stable "dd.mm.yyyy"
  // placeholder that the user can type over — the behaviour we want.
  // So: detect Safari at module load and keep the input transparent +
  // overlay visible through focus on Safari only, leaving the
  // non-Safari typing experience intact.
  const IS_SAFARI =
    typeof navigator !== 'undefined' &&
    /Safari/.test(navigator.userAgent) &&
    !/Chrome|Chromium|Edg/.test(navigator.userAgent);

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
    <span class="date-range__input">
      <input
        type="date"
        value={from ?? ''}
        on:input={fromInput}
        class:date-range__field--empty={!from}
        class:date-range__field--safari-empty={!from && IS_SAFARI}
      />
      {#if !from}
        <span
          class="date-range__placeholder"
          class:date-range__placeholder--safari={IS_SAFARI}
        >dd.mm.yyyy</span>
      {/if}
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
        class:date-range__field--safari-empty={!to && IS_SAFARI}
      />
      {#if !to}
        <span
          class="date-range__placeholder"
          class:date-range__placeholder--safari={IS_SAFARI}
        >dd.mm.yyyy</span>
      {/if}
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
  /* Empty + unfocused: suppress the native preview on all browsers
     (Chrome's "dd.mm.yyyy", Safari's today's-date in US slashes) so
     our overlay is the single visible hint. */
  .date-range__input input.date-range__field--empty {
    color: transparent;
  }
  /* On focus, reveal the native editing UI so typing works — except
     on Safari, where focus would unmask today's date. The Safari
     branch keeps the input transparent; the user uses the picker
     dropdown to commit a value. */
  .date-range__input input.date-range__field--empty:focus {
    color: CanvasText;
  }
  .date-range__input input.date-range__field--safari-empty:focus {
    color: transparent;
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
  /* Non-Safari: hide the overlay on focus so it doesn't sit on top of
     the native editing UI. Safari: keep it visible — the input itself
     is transparent on focus, and the picker dropdown is the input
     surface, so the hint stays useful. */
  .date-range__input input:focus + .date-range__placeholder:not(.date-range__placeholder--safari) {
    display: none;
  }
</style>

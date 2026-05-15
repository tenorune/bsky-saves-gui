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
    <!-- The placeholder span overlays the input's text area when empty.
         iOS Safari doesn't render a placeholder on <input type="date">,
         so without this there's no visual hint that the field is a date
         picker (just an empty box). Pointer-events: none lets taps fall
         through to the input. -->
    <span class="date-range__input">
      <input type="date" value={from ?? ''} on:input={fromInput} />
      {#if !from}<span class="date-range__placeholder">dd.mm.yyyy</span>{/if}
    </span>
  </label>
  <label>
    <span>To</span>
    <span class="date-range__input">
      <input type="date" value={to ?? ''} on:input={toInput} />
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
</style>

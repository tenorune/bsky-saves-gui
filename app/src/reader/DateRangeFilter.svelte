<!-- app/src/reader/DateRangeFilter.svelte -->
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

<fieldset class="date-range">
  <legend>Date range</legend>
  <label>
    From
    <input type="date" value={from ?? ''} on:input={fromInput} />
  </label>
  <label>
    To
    <input type="date" value={to ?? ''} on:input={toInput} />
  </label>
</fieldset>

<style>
  .date-range {
    border: 0;
    padding: 0;
    margin: 0;
    display: flex;
    gap: 0.75rem;
    align-items: end;
  }
  .date-range legend {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.7;
    padding: 0;
    margin-bottom: 0.25rem;
  }
  .date-range label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  input {
    font: inherit;
    padding: 0.5rem 0.75rem;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
  }
</style>

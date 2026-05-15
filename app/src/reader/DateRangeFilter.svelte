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
    <input type="date" value={from ?? ''} on:input={fromInput} />
  </label>
  <label>
    <span>To</span>
    <input type="date" value={to ?? ''} on:input={toInput} />
  </label>
</div>

<style>
  .date-range {
    display: flex;
    gap: 0.75rem;
    align-items: end;
  }
</style>

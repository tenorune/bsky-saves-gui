<script lang="ts">
  /** The text to copy to the clipboard. */
  export let text: string;
  /** Optional accessible label. Default: "Copy". */
  export let label: string = 'Copy';

  let copied = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        copied = false;
        timeoutId = null;
      }, 1500);
    } catch {
      // Older browsers without clipboard API; ignore.
    }
  }
</script>

<button
  type="button"
  class="copy-button"
  on:click={handleClick}
  aria-label={copied ? 'Copied' : label}
  title={copied ? 'Copied' : label}
>
  {#if copied}
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  {:else}
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  {/if}
</button>

<style>
  .copy-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    padding: 0;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 4px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.15s ease;
  }
  .copy-button:hover,
  .copy-button:focus-visible {
    opacity: 1;
  }
</style>

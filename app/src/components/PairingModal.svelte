<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { setPairingToken, isValidTokenShape } from '$lib/pairing-token';
  import { probePairingToken } from '$lib/helper-client';
  import { config } from '$lib/config';

  export let open = false;

  const dispatch = createEventDispatcher<{ close: void; change: void }>();

  let pastedToken = '';
  let status: 'idle' | 'verifying' = 'idle';
  let errorMessage = '';

  function reset(): void {
    pastedToken = '';
    status = 'idle';
    errorMessage = '';
  }

  function close(): void {
    reset();
    dispatch('close');
  }

  // Reset every time the modal opens so a previous failed attempt
  // doesn't surface its error against a fresh open. The reactive
  // statement runs whenever `open` flips, including from false→true.
  $: if (open) {
    /* deliberately empty; the reset happens on close() so the field
       isn't yanked from under a user mid-typing. */
  }

  async function handlePair(): Promise<void> {
    const trimmed = pastedToken.trim();
    if (!isValidTokenShape(trimmed)) {
      errorMessage =
        'That doesn’t look like a pairing token. Run `bsky-saves token` in a terminal to print yours.';
      return;
    }
    status = 'verifying';
    errorMessage = '';
    const result = await probePairingToken(config.helperOrigin, trimmed);
    status = 'idle';
    if (result === 'valid') {
      setPairingToken(trimmed);
      dispatch('change');
      close();
      return;
    }
    if (result === 'rejected') {
      errorMessage =
        'The helper didn’t accept that token. Double-check that you copied the full output of `bsky-saves token`.';
      return;
    }
    errorMessage =
      'Couldn’t reach the helper. Make sure `bsky-saves serve` is running on this machine, then try again.';
  }

  function onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) close();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (open && event.key === 'Escape') close();
  }
</script>

<svelte:window on:keydown={onKeyDown} />

{#if open}
  <div
    class="modal-backdrop"
    on:click={onBackdropClick}
    on:keydown|self
    role="presentation"
  >
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="pair-modal-title">
      <header class="modal__header">
        <h3 id="pair-modal-title" class="modal__title">Pair with your local helper</h3>
        <button type="button" class="modal__close" on:click={close} aria-label="Close">
          ✕
        </button>
      </header>
      <p class="modal__body">
        The pairing token is printed by <code>bsky-saves serve</code> on its
        first run on this machine. If you missed it or the token has already
        been generated, run <code>bsky-saves token</code> to print it again.
        Paste it below. The token is stored only in this browser and is sent
        to your local helper to authorize image, article, and thread backups.
      </p>
      <label class="modal__field">
        <span>Pairing token</span>
        <input
          type="text"
          bind:value={pastedToken}
          autocomplete="off"
          spellcheck="false"
          placeholder="from `bsky-saves serve` (first run) / `bsky-saves token`"
          disabled={status === 'verifying'}
        />
      </label>
      {#if errorMessage}
        <p class="modal__error" role="alert">{errorMessage}</p>
      {/if}
      <div class="modal__actions">
        <button type="button" class="modal__cancel" on:click={close}>Cancel</button>
        <button
          type="button"
          class="modal__primary"
          on:click={handlePair}
          disabled={status === 'verifying' || pastedToken.trim().length === 0}
        >
          {status === 'verifying' ? 'Verifying…' : 'Pair'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    z-index: 100;
  }
  .modal {
    background: Canvas;
    color: CanvasText;
    border-radius: 8px;
    padding: 1.25rem 1.5rem;
    max-width: 32rem;
    width: 100%;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .modal__header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .modal__title {
    margin: 0;
    flex: 1;
    font-size: 1.05rem;
  }
  .modal__close {
    font: inherit;
    font-size: 1rem;
    padding: 0.2rem 0.5rem;
    background: none;
    border: 0;
    color: inherit;
    cursor: pointer;
    opacity: 0.7;
  }
  .modal__close:hover { opacity: 1; }
  .modal__body {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.4;
  }
  .modal__body code {
    background: color-mix(in oklab, CanvasText 8%, Canvas);
    padding: 0.05em 0.35em;
    border-radius: 3px;
    font-size: 0.9em;
  }
  .modal__field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.875rem;
  }
  .modal__field input {
    font: inherit;
    padding: 0.45rem 0.6rem;
    border: 1px solid color-mix(in oklab, CanvasText 25%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    /* Long base64url tokens; wrap visually so the user can audit what
       they pasted. */
    word-break: break-all;
  }
  .modal__error {
    margin: 0;
    padding: 0.5rem 0.7rem;
    border-radius: 6px;
    background: color-mix(in oklab, red 10%, Canvas);
    border: 1px solid color-mix(in oklab, red 35%, transparent);
    font-size: 0.85rem;
  }
  .modal__actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }
  .modal__actions button {
    font: inherit;
    font-size: 0.875rem;
    padding: 0.4rem 0.9rem;
    border-radius: 6px;
    cursor: pointer;
  }
  .modal__cancel {
    background: Canvas;
    color: CanvasText;
    border: 1px solid color-mix(in oklab, CanvasText 25%, transparent);
  }
  .modal__primary {
    background: color-mix(in oklab, royalblue 25%, Canvas);
    color: CanvasText;
    border: 1px solid color-mix(in oklab, royalblue 50%, transparent);
  }
  .modal__primary:disabled,
  .modal__cancel:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>

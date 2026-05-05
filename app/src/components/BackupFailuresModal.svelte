<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { findSaveByAssetUrl } from '$lib/find-save-by-asset-url';
  import { bskyPostUrl } from '$lib/bsky-permalink';

  type FailureRow = {
    readonly url: string;
    readonly reason: string;
    readonly type: 'image' | 'article';
  };

  export let open = false;
  export let failures: ReadonlyArray<FailureRow> = [];
  export let inventory: unknown = null;
  export let title = 'Backup failures';

  const dispatch = createEventDispatcher<{ close: void }>();

  function close() {
    dispatch('close');
  }

  function onBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) close();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (open && event.key === 'Escape') close();
  }

  function permalinkFor(url: string): string | null {
    const save = findSaveByAssetUrl(inventory, url);
    if (!save) return null;
    return bskyPostUrl(save);
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
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="failures-modal-title">
      <header class="modal__header">
        <h3 id="failures-modal-title" class="modal__title">
          {title} ({failures.length})
        </h3>
        <button type="button" class="modal__close" on:click={close} aria-label="Close">
          ✕
        </button>
      </header>

      {#if failures.length === 0}
        <p class="modal__empty">No failures.</p>
      {:else}
        <ul class="modal__list">
          {#each failures as f (f.url + ':' + f.type)}
            <li class="modal__row">
              <div class="modal__row-head">
                <span class="modal__type modal__type--{f.type}">{f.type === 'image' ? 'IMG' : 'ARTICLE'}</span>
                <span class="modal__reason">{f.reason}</span>
              </div>
              <div class="modal__url" title={f.url}>{f.url}</div>
              {#if permalinkFor(f.url)}
                <a
                  class="modal__permalink"
                  href={permalinkFor(f.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                >View source post</a>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      <footer class="modal__footer">
        <button type="button" on:click={close}>Close</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    z-index: 100;
  }
  .modal {
    max-width: 40rem;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    background: Canvas;
    color: CanvasText;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    padding: 1rem 1.25rem 1.25rem;
  }
  .modal__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }
  .modal__title {
    margin: 0;
    font-size: 1.05rem;
  }
  .modal__close {
    background: none;
    border: 0;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
    font-size: 1.1rem;
    color: inherit;
    opacity: 0.6;
  }
  .modal__close:hover {
    opacity: 1;
  }
  .modal__empty {
    margin: 0 0 0.5rem;
    opacity: 0.7;
    font-size: 0.9rem;
  }
  .modal__list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .modal__row {
    padding: 0.6rem 0;
    border-bottom: 1px solid color-mix(in oklab, CanvasText 10%, transparent);
  }
  .modal__row:last-child {
    border-bottom: 0;
  }
  .modal__row-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }
  .modal__type {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    background: color-mix(in oklab, CanvasText 12%, Canvas);
  }
  .modal__reason {
    color: color-mix(in oklab, red 70%, CanvasText);
    font-size: 0.9rem;
  }
  .modal__url {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.78rem;
    opacity: 0.75;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .modal__permalink {
    display: inline-block;
    margin-top: 0.25rem;
    font-size: 0.8rem;
    color: inherit;
    text-decoration: underline;
  }
  .modal__footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.75rem;
  }
  .modal__footer button {
    font: inherit;
    padding: 0.4rem 1rem;
    border: 1px solid color-mix(in oklab, CanvasText 25%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
  }
</style>

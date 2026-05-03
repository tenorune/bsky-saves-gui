<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { navigate } from '$lib/router';
  import { signInDraft } from '$lib/sign-in-draft';
  import { lastSession } from '$lib/last-session';
  import { slideFromRight } from '$lib/slide-transition';

  let enrich = true;
  let threads = false;
  let handle = '';
  let canRefresh = false;

  onMount(() => {
    const draft = get(signInDraft);
    const session = get(lastSession);
    if (draft) {
      enrich = draft.enrich;
      threads = draft.threads;
      handle = draft.handle;
      canRefresh = true;
    } else if (session) {
      handle = session.handle;
      canRefresh = true;
    }
  });

  function refreshNow() {
    if (!canRefresh) {
      navigate('/');
      return;
    }
    // Persist the toggle choices so Run.svelte reads the right ones. If we're
    // refreshing from a session-only state (no draft), create a minimal draft
    // carrying just the toggles — Run.svelte falls back to the session for
    // credentials.
    signInDraft.update((d) =>
      d
        ? { ...d, enrich, threads }
        : {
            handle,
            appPassword: '',
            pds: '',
            enrich,
            threads,
            saveInventory: false,
            saveCredentials: false,
            passphrase: '',
          },
    );
    navigate('/run');
  }

  function cancel() {
    navigate('/library');
  }

  function reSignIn() {
    navigate('/');
  }
</script>

<section class="route route--refresh" use:slideFromRight>
  <header class="route__header">
    <h2 class="route__title">Refresh</h2>
  </header>

  {#if canRefresh}
    <p class="status">
      Signed in as <code>@{handle}</code>
    </p>

    <div class="card">
      <p class="help">Choose what to fetch and re-hydrate. <code>bsky-saves</code> is idempotent: existing saves are kept, only new ones are pulled.</p>

      <label class="checkbox">
        <input type="checkbox" bind:checked={enrich} />
        <span>Enrich (decode timestamps)</span>
      </label>

      <label class="checkbox">
        <input type="checkbox" bind:checked={threads} />
        <span>Hydrate threads (self-thread replies from the public AppView)</span>
      </label>

      <div class="actions">
        <button type="button" class="primary" on:click={refreshNow}>Refresh now</button>
        <button type="button" on:click={cancel}>Cancel</button>
      </div>
    </div>
  {:else}
    {#if handle}
      <p class="status">
        Last signed in as <code>@{handle}</code>, but the session was cleared by a page reload.
      </p>
    {:else}
      <p class="status">No active session.</p>
    {/if}
    <div class="actions">
      <button type="button" class="primary" on:click={reSignIn}>Sign in to refresh</button>
      <button type="button" on:click={cancel}>Back to library</button>
    </div>
  {/if}
</section>

<style>
  .route--refresh {
    max-width: 44rem;
    margin: 0 auto;
  }
  .route__header {
    margin-bottom: 1rem;
  }
  .route__title {
    margin: 0;
  }
  .status {
    margin: 0 0 1rem;
  }
  code {
    background: color-mix(in oklab, CanvasText 5%, Canvas);
    padding: 0.1em 0.3em;
    border-radius: 3px;
    font-size: 0.9em;
  }
  .card {
    border: 1px solid color-mix(in oklab, CanvasText 15%, transparent);
    border-radius: 8px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .help {
    font-size: 0.875rem;
    opacity: 0.8;
    margin: 0;
  }
  .checkbox {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 500;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.5rem;
  }
  .actions button {
    font: inherit;
    line-height: 1.25;
    padding: 0.5rem 0.75rem;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
  }
  .actions .primary {
    font-weight: 600;
    background: color-mix(in oklab, CanvasText 8%, Canvas);
  }
</style>

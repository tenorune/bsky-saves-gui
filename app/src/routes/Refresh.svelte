<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { navigate } from '$lib/router';
  import { signInDraft } from '$lib/sign-in-draft';
  import { lastSession } from '$lib/last-session';
  import { slideFromRight } from '$lib/slide-transition';

  let fetchNew = true;
  let enrich = false;
  let threads = false;
  let images = false;
  let handle = '';
  let canRefresh = false;

  $: canUpdate = canRefresh && (fetchNew || enrich || threads || images);

  onMount(() => {
    const draft = get(signInDraft);
    const session = get(lastSession);
    if (draft) {
      handle = draft.handle;
      canRefresh = true;
    } else if (session) {
      handle = session.handle;
      canRefresh = true;
    }
  });

  function updateNow() {
    if (!canUpdate) {
      if (!canRefresh) navigate('/');
      return;
    }
    // Persist the toggle choices so Run.svelte reads the right ones. If we're
    // updating from a session-only state (no draft), create a minimal draft
    // carrying just the toggles — Run.svelte falls back to the session for
    // credentials.
    signInDraft.update((d) =>
      d
        ? { ...d, fetch: fetchNew, enrich, threads, images }
        : {
            handle,
            appPassword: '',
            pds: '',
            fetch: fetchNew,
            enrich,
            threads,
            images,
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
    <h2 class="route__title">Update your library</h2>
  </header>

  {#if canRefresh}
    <p class="status">
      Signed in as <code>@{handle}</code>
    </p>

    <div class="card">
      <p class="help">
        Each step only runs on posts that need it. Re-running is safe.
      </p>

      <label class="checkbox">
        <input type="checkbox" bind:checked={fetchNew} />
        <span>Pull in any newly saved posts</span>
      </label>

      <label class="checkbox">
        <input type="checkbox" bind:checked={enrich} />
        <span>Add precise dates to posts that don't have them</span>
      </label>

      <label class="checkbox">
        <input type="checkbox" bind:checked={threads} />
        <span>Save same-author thread replies for posts that don't have them</span>
      </label>

      <label class="checkbox">
        <input type="checkbox" bind:checked={images} />
        <span>Save images on this device for posts that don't have them</span>
      </label>

      <div class="actions">
        <button type="button" class="primary" on:click={updateNow} disabled={!canUpdate}>Update now</button>
        <button type="button" on:click={cancel}>Cancel</button>
      </div>
    </div>
  {:else}
    {#if handle}
      <p class="status">
        You were signed in as <code>@{handle}</code>, but reloading the page
        ended that session.
      </p>
    {:else}
      <p class="status">You're not signed in.</p>
    {/if}
    <div class="actions">
      <button type="button" class="primary" on:click={reSignIn}>Sign in to update</button>
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
  .actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>

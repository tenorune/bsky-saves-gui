<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { config } from '$lib/config';
  import { navigate } from '$lib/router';
  import { signInDraft } from '$lib/sign-in-draft';
  import { markSessionOnly, clearSessionOnlyMarker, persistenceMode } from '$lib/persistence-mode';
  import { hasCredentials, loadCredentials, saveCredentials as persistCredentials } from '$lib/credentials-store';
  import { DecryptError } from '$lib/crypto';
  import { startLibraryRefresh } from '$lib/library-refresh';
  import { assetToggles, setAssetToggle, loadAssetToggles } from '$lib/asset-toggles';
  import { createSession, InvalidCredentialsError } from '$lib/atproto';
  import { setLastSession } from '$lib/last-session';
  import { saveAccount } from '$lib/account-store';
  import { clearInventory } from '$lib/inventory-store';
  import { clearImageBlobs } from '$lib/image-store';
  import DefinitionTerm from '../components/DefinitionTerm.svelte';
  import { clearFailures } from '$lib/failure-store';
  import { slideRoute } from '$lib/slide-transition';

  let savedPresent = false;
  let useDifferentAccount = false;
  let unlockPassphrase = '';
  let unlockError = '';

  $: showForm = !savedPresent || useDifferentAccount;

  onMount(async () => {
    savedPresent = await hasCredentials();
    await loadAssetToggles();
    // Reflect the current persistence-mode marker into the form so a
    // user already in session-only mode sees "Keep my saves in this
    // browser" unchecked by default (matching their prior choice).
    // Without this, the form's default saveInventory=true would
    // override the marker on submit and silently flip them to persist.
    saveInventory = get(persistenceMode) !== 'session-only';
  });

  async function unlockSaved() {
    unlockError = '';
    try {
      const creds = await loadCredentials(unlockPassphrase);
      if (!creds) {
        unlockError = 'No saved credentials.';
        return;
      }
      handle = creds.handle;
      appPassword = creds.appPassword;
      pds = creds.pds;
      // Preserve the prior session-only choice when unlocking. The
      // form's saveInventory local defaults to true (the natural
      // default for a fresh sign-in), but if the user was already in
      // session-only mode — sessionStorage marker is still set —
      // submitting with saveInventory=true would clear the marker
      // and silently flip them to persist mode. Reflect the mode
      // marker into the form so the user's prior intent survives the
      // passphrase unlock.
      saveInventory = get(persistenceMode) !== 'session-only';
      submit();
    } catch (e) {
      if (e instanceof DecryptError) {
        unlockError = 'Wrong passphrase.';
      } else {
        unlockError = e instanceof Error ? e.message : String(e);
      }
    }
  }

  let handle = '';
  let appPassword = '';
  let pds = config.defaultPds;
  let saveInventory = true;
  let saveCredentials = false;
  let passphrase = '';
  let error = '';

  async function submit() {
    error = '';
    if (!handle) {
      error = 'Handle is required.';
      return;
    }
    if (!appPassword) {
      error = 'App password is required.';
      return;
    }
    if (saveCredentials && passphrase.length < 8) {
      error = 'Passphrase must be at least 8 characters to save credentials.';
      return;
    }

    let session;
    try {
      session = await createSession({ pds, identifier: handle, password: appPassword });
    } catch (e) {
      error = e instanceof InvalidCredentialsError
        ? 'Wrong handle or app password.'
        : e instanceof Error ? e.message : String(e);
      return;
    }

    // Set the draft FIRST so persistence-mode checks during
    // setLastSession / startLibraryRefresh see the user's choice.
    // Note: threads-on/off is NOT carried on the draft — the SignIn
    // form's threads checkbox writes to assetToggles directly via
    // setAssetToggle, and consumers (Library.svelte, library-refresh,
    // asset-trigger) read from assetToggles. Same for the implicit
    // "always fetch on sign-in" behavior — there's no opt-out, so
    // there's nothing to record on the draft.
    signInDraft.set({
      handle,
      appPassword,
      pds,
      saveInventory,
      saveCredentials,
      passphrase,
    });

    // Promote the user's choice to a sessionStorage marker so it survives
    // refresh — without this, the persistenceMode banner disappears and
    // (worse) every persistence gate flips back to "persist," leaking
    // session-only data to disk on the next write. Always write
    // explicitly (mark or clear) so a fresh sign-in overrides any marker
    // left over from a previous session-only sign-in on this tab.
    if (saveInventory) {
      clearSessionOnlyMarker();
    } else {
      markSessionOnly();
    }

    // If the user opted out of persistence, wipe any pre-existing
    // disk-backed library data so the fresh session-only session truly
    // starts clean. Without this, an old persisted inventory from a
    // previous (checked) sign-in would still be on disk and would
    // reappear on next persist-mode load.
    if (!saveInventory) {
      await Promise.all([clearInventory(), clearImageBlobs(), clearFailures()]);
    }

    setLastSession({
      pds,
      accessJwt: session.accessJwt,
      refreshJwt: session.refreshJwt,
      did: session.did,
      handle: session.handle,
    });

    // Persist the account label so the cached library remains attributed
    // to its source account even after Sign Out (when lastSession is gone
    // but the inventory and credentials may still be on the device).
    // Reads the resolved handle from the createSession response, not the
    // user-typed input — handles get canonicalized server-side.
    void saveAccount(session.handle);

    // Honor the "Remember my app password on this device" checkbox.
    // Without this call, hasCredentials() never flips to true and the
    // Welcome-back passphrase prompt never appears on subsequent
    // visits. Use the canonicalized handle from the session response
    // so a future loadCredentials() returns the same shape.
    if (saveCredentials) {
      try {
        await persistCredentials(
          { handle: session.handle, appPassword, pds },
          passphrase,
        );
      } catch (e) {
        // Don't fail the whole sign-in over a credential-save error;
        // surface it inline and let the user proceed without saved
        // credentials.
        error = `Saved credentials failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    startLibraryRefresh({
      credentials: { handle, appPassword, pds },
      includeThreads: get(assetToggles).threads,
      preauthSession: {
        accessJwt: session.accessJwt,
        refreshJwt: session.refreshJwt,
        did: session.did,
        handle: session.handle,
      },
    });

    navigate('/library');
  }
</script>

<section class="route route--sign-in" use:slideRoute>
  <p class="intro">
    {config.appName} exports your Bluesky saved posts as JSON, Markdown, or a
    self-contained HTML archive. Everything runs in your browser — your handle,
    app password, and saved data never leave this device.
    <a href="#/privacy" class="intro__more" on:click|preventDefault={() => navigate('/privacy')}>Read more &rsaquo;</a>
  </p>

  {#if showForm}
    <h2>Sign in to Bluesky</h2>
  {/if}

  {#if savedPresent && !useDifferentAccount}
    <section class="card saved-creds" aria-label="Saved credentials">
      <h3>Welcome back</h3>
      <p class="help">Type your passphrase to unlock your saved app password.</p>
      <label class="card__field">
        Passphrase
        <input type="password" bind:value={unlockPassphrase} />
      </label>
      <button type="button" class="card__action" on:click={unlockSaved}>Unlock and sign in</button>
      {#if unlockError}
        <p class="error" role="alert">{unlockError}</p>
      {/if}
      <button
        type="button"
        class="card__link"
        on:click={() => (useDifferentAccount = true)}
      >Use a different account</button>
    </section>
  {/if}

  {#if showForm}
    <form on:submit|preventDefault={submit}>
    <label>
      Handle
      <input
        type="text"
        autocomplete="username"
        placeholder="alice.bsky.social"
        maxlength="253"
        bind:value={handle}
        required
      />
    </label>

    <label>
      <DefinitionTerm>
        <span slot="term">App password</span>
        Don't use your real Bluesky password. Make an
        <a
          href="https://bsky.app/settings/app-passwords"
          target="_blank"
          rel="noopener noreferrer"
        >app password</a>
        in Bluesky's settings — it's a temporary password just for tools like
        this one, and you can revoke it anytime.
      </DefinitionTerm>
      <input
        type="password"
        autocomplete="current-password"
        maxlength="19"
        placeholder="xxxx-xxxx-xxxx-xxxx"
        bind:value={appPassword}
        required
      />
    </label>

    <details class="advanced-toggle">
      <summary>Advanced</summary>

      <div class="card advanced">
        <label class="card__field">
          <DefinitionTerm>
            <span slot="term">Server address</span>
            Where your Bluesky account lives. The default works for most people;
            only change this if you know your account is on a different server.
          </DefinitionTerm>
          <input type="url" bind:value={pds} />
        </label>

        <label class="checkbox">
          <input
            type="checkbox"
            checked={$assetToggles.threads}
            on:change={(e) => setAssetToggle('threads', e.currentTarget.checked)}
          />
          <span>Include threads</span>
        </label>

        <label class="checkbox">
          <input type="checkbox" bind:checked={saveInventory} />
          <span>Keep my saved posts on this device</span>
        </label>

        <label class="checkbox">
          <input type="checkbox" bind:checked={saveCredentials} />
          <span>Remember my app password on this device</span>
        </label>
        {#if saveCredentials}
          <label class="card__field">
            <DefinitionTerm>
              <span slot="term">Passphrase</span>
              Your app password gets locked with this passphrase and stored only
              in this browser. If you forget the passphrase, you'll just need to
              type your app password again next time.
            </DefinitionTerm>
            <input type="password" bind:value={passphrase} minlength="8" />
          </label>
        {/if}
      </div>
    </details>

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}

    <button type="submit">Sign in</button>
  </form>
  {/if}
</section>

<style>
  .route--sign-in {
    max-width: 44rem;
    margin: 0 auto;
  }
  .intro {
    font-size: 1rem;
    line-height: 1.5;
    margin: 0 0 1.5rem;
  }
  .intro__more {
    /* No margin-left: rely on the natural inter-word space inside the
       paragraph. With a margin, a wrapped "Read more ›" would land at
       0.25rem inset from the line start instead of flush-left, which
       reads as a stray indent. */
    white-space: nowrap;
  }
  .help {
    font-size: 0.875rem;
    opacity: 0.8;
    margin: 0;
  }
  .card {
    border: 1px solid color-mix(in oklab, CanvasText 15%, transparent);
    border-radius: 8px;
    padding: 1.25rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .card h3 {
    margin: 0;
  }
  .card__field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.25rem;
  }
  /* Don't double up the card's top padding with this field's margin-top
     when the field is the first child — keeps the visible top space
     equal to the card's bottom padding (1.25rem). */
  .card > .card__field:first-child {
    margin-top: 0;
  }
  .card__action {
    align-self: flex-start;
    margin-top: 0.5rem;
    padding: 0.5rem 1rem;
    font: inherit;
    cursor: pointer;
  }
  .card__link {
    align-self: flex-start;
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
    opacity: 0.85;
  }
  .card__link:hover {
    opacity: 1;
  }
  .advanced-toggle {
    margin: 0.25rem 0;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-weight: 500;
  }
  label.checkbox {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
    font-weight: 500;
  }
  .error {
    color: color-mix(in oklab, red 70%, CanvasText);
    font-weight: 500;
  }
  details summary {
    cursor: pointer;
    margin: 0.5rem 0;
  }
  button[type='submit'] {
    align-self: flex-start;
    padding: 0.5rem 1rem;
    font: inherit;
    cursor: pointer;
  }
  .saved-creds {
    margin-bottom: 1.5rem;
  }
</style>

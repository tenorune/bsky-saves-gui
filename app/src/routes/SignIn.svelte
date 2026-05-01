<script lang="ts">
  import { onMount } from 'svelte';
  import { config } from '$lib/config';
  import { navigate } from '$lib/router';
  import { signInDraft } from '$lib/sign-in-draft';
  import { hasCredentials, loadCredentials } from '$lib/credentials-store';
  import { DecryptError } from '$lib/crypto';

  let savedPresent = false;
  let unlockPassphrase = '';
  let unlockError = '';

  onMount(async () => {
    savedPresent = await hasCredentials();
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
      // Auto-submit the form.
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
  let enrich = true;
  let error = '';

  function submit() {
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
    signInDraft.set({
      handle,
      appPassword,
      pds,
      enrich,
      saveInventory,
      saveCredentials,
      passphrase,
    });
    navigate('/run');
  }
</script>

<section class="route route--sign-in">
  <h2>Sign in to Bluesky</h2>

  {#if savedPresent}
    <section class="saved-creds" aria-label="Saved credentials">
      <h3>Saved credentials detected</h3>
      <p class="help">Enter your passphrase to unlock your saved app password.</p>
      <label>
        Passphrase
        <input type="password" bind:value={unlockPassphrase} />
      </label>
      <button type="button" on:click={unlockSaved}>Unlock and sign in</button>
      {#if unlockError}
        <p class="error" role="alert">{unlockError}</p>
      {/if}
      <details>
        <summary>Use a different account</summary>
        <p>The form below is editable — fill it in to override your saved credentials.</p>
      </details>
    </section>
  {/if}

  <p class="help">
    Your handle and app password are sent only to your Bluesky server.
    Nothing is uploaded to <code>{config.appDomain}</code>; the page is static.
  </p>

  <form on:submit|preventDefault={submit}>
    <label>
      Handle
      <input
        type="text"
        autocomplete="username"
        placeholder="alice.bsky.social"
        bind:value={handle}
        required
      />
    </label>

    <label>
      App password
      <input type="password" autocomplete="current-password" bind:value={appPassword} required />
    </label>
    <p class="help">
      Use a Bluesky <strong>app password</strong>, not your main password — see Settings → App
      Passwords on the Bluesky web app.
    </p>

    <details>
      <summary>Advanced</summary>

      <label>
        PDS
        <input type="url" bind:value={pds} />
      </label>
      <p class="help">Defaults to Bluesky's main PDS. Change for third-party AT Proto servers.</p>

      <label>
        <input type="checkbox" bind:checked={enrich} />
        Enrich (decode timestamps)
      </label>
      <p class="help">On by default. Adds derived timestamps from the post metadata.</p>

      <label>
        <input type="checkbox" bind:checked={saveInventory} />
        Save inventory on this device
      </label>
      <p class="help">
        So you can come back and read or re-sync without re-fetching everything. Stored in this
        browser's IndexedDB.
      </p>

      <label>
        <input type="checkbox" bind:checked={saveCredentials} />
        Save app password on this device (encrypted)
      </label>
      {#if saveCredentials}
        <label>
          Passphrase
          <input type="password" bind:value={passphrase} minlength="8" />
        </label>
        <p class="help">
          Encrypts your app password with this passphrase. Only this browser, on this device, can
          read it. Forget the passphrase = re-enter the app password.
        </p>
      {/if}
    </details>

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}

    <button type="submit">Sign in</button>
  </form>
</section>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-width: 32rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-weight: 500;
  }
  label input[type='checkbox'] {
    margin-right: 0.5rem;
  }
  .help {
    font-size: 0.875rem;
    opacity: 0.8;
    margin: 0;
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
    border: 1px solid color-mix(in oklab, CanvasText 15%, transparent);
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1.5rem;
    max-width: 32rem;
  }
  .saved-creds h3 {
    margin: 0 0 0.5rem;
  }
</style>

<script lang="ts">
  import { onMount } from 'svelte';
  import { config } from '$lib/config';
  import { navigate } from '$lib/router';
  import { signInDraft } from '$lib/sign-in-draft';
  import { hasCredentials, loadCredentials } from '$lib/credentials-store';
  import { DecryptError } from '$lib/crypto';

  let savedPresent = false;
  let useDifferentAccount = false;
  let unlockPassphrase = '';
  let unlockError = '';

  $: showForm = !savedPresent || useDifferentAccount;

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
  let threads = false;
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
      threads,
      saveInventory,
      saveCredentials,
      passphrase,
    });
    navigate('/run');
  }
</script>

<section class="route route--sign-in">
  <p class="intro">
    {config.appName} exports your Bluesky saved posts as JSON, Markdown, or a
    self-contained HTML archive. Everything runs in your browser — your handle,
    app password, and saved data never leave this device.
    <a href="#/privacy" class="intro__more">Read more &rsaquo;</a>
  </p>

  {#if showForm}
    <h2>Sign in to Bluesky</h2>
  {/if}

  {#if savedPresent && !useDifferentAccount}
    <section class="card saved-creds" aria-label="Saved credentials">
      <h3>Saved credentials detected</h3>
      <p class="help">Enter your passphrase to unlock your saved app password.</p>
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
    <p class="help intro-help">
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
        maxlength="253"
        bind:value={handle}
        required
      />
    </label>

    <label>
      App password
      <input
        type="password"
        autocomplete="current-password"
        maxlength="19"
        placeholder="xxxx-xxxx-xxxx-xxxx"
        bind:value={appPassword}
        required
      />
    </label>
    <p class="help">
      Use a Bluesky <strong>app password</strong>, not your main password — see
      <a
        href="https://bsky.app/settings/app-passwords"
        target="_blank"
        rel="noopener noreferrer"
      >Settings → Privacy and Security → App Passwords</a>
      on Bluesky.
    </p>

    <details class="advanced-toggle">
      <summary>Advanced</summary>

      <div class="card advanced">
        <label class="card__field">
          PDS
          <input type="url" bind:value={pds} />
        </label>
        <p class="help">Defaults to Bluesky's PDS. Change for third-party AT Proto servers.</p>

        <label class="checkbox">
          <input type="checkbox" bind:checked={enrich} />
          <span>Enrich (decode timestamps)</span>
        </label>
        <p class="help">Adds derived timestamps from the post metadata.</p>

        <label class="checkbox">
          <input type="checkbox" bind:checked={threads} />
          <span>Hydrate threads</span>
        </label>
        <p class="help">
          Fetch self-thread replies (replies the original poster wrote to their own post)
          and store them with each save. Adds extra requests to the public Bluesky AppView.
        </p>

        <label class="checkbox">
          <input type="checkbox" bind:checked={saveInventory} />
          <span>Save inventory on this device</span>
        </label>
        <p class="help">
          Come back and read or re-sync without re-fetching everything. Stored in this
          browser's IndexedDB.
        </p>

        <label class="checkbox">
          <input type="checkbox" bind:checked={saveCredentials} />
          <span>Save app password on this device (encrypted)</span>
        </label>
        {#if saveCredentials}
          <label class="card__field">
            Passphrase
            <input type="password" bind:value={passphrase} minlength="8" />
          </label>
          <p class="help">
            Encrypts your app password with this passphrase. Only this browser, on this device, can
            read it. Forget the passphrase = re-enter the app password.
          </p>
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
    margin-left: 0.25rem;
    white-space: nowrap;
  }
  .help {
    font-size: 0.875rem;
    opacity: 0.8;
    margin: 0;
  }
  .help.intro-help {
    margin-bottom: 2rem;
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

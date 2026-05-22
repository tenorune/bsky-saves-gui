<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { inventoryState, loadFromDb } from '$lib/inventory-loader';
  import { clearInventory, loadInventory, saveInventory } from '$lib/inventory-store';
  import { applyRetainMode } from '$lib/library-refresh';
  import { triggerThreadHydration, triggerImageHydration, triggerArticleHydration } from '$lib/asset-trigger';
  import { clearCredentials, hasCredentials, saveCredentials as persistCredentials } from '$lib/credentials-store';
  import { clearAccount } from '$lib/account-store';
  import { lastSession, clearLastSession } from '$lib/last-session';
  import { signInDraft } from '$lib/sign-in-draft';
  import { persistenceMode } from '$lib/persistence-mode';
  import { clearSessionHeartbeat } from '$lib/session-heartbeat';
  import { clearBeaconSent } from '$lib/beacon';
  import { loadProxyConfig, clearProxyConfig } from '$lib/proxy-config';
  import { disableOperatorProxy } from '$lib/disable-operator-proxy';
  import {
    loadOperatorProxyOptOut,
    setOperatorProxyOptOut,
    clearOperatorProxyOptOut,
  } from '$lib/operator-proxy-opt-out';
  import {
    loadHelperOptOut,
    setHelperOptOut,
    clearHelperOptOut,
  } from '$lib/helper-opt-out';
  import { config } from '$lib/config';
  import { cancelImageBackup } from '$lib/start-image-backup';
  import { cancelArticleBackup } from '$lib/start-article-backup';
  import { cancelThreadHydration } from '$lib/thread-hydrator';
  import { clearImageBlobs } from '$lib/image-store';
  import { terminateSharedDriver } from '$lib/pyodide-worker-driver';
  import { clearFailures } from '$lib/failure-store';
  import { resetAllHydrationProgress } from '$lib/hydration-state';
  import { isMobileOs } from '$lib/is-mobile';
  import { resetLibraryFilters } from '$lib/library-filters';
  import { exportJson } from '../exporters/json-exporter';
  import { downloadFile } from '../exporters/file-download';
  import { parseInventory } from '../reader/inventory-shape';
  import { navigate } from '$lib/router';
  import CustomProxySetupModal from '../components/CustomProxySetupModal.svelte';
  import { assetToggles, setAssetToggle, loadAssetToggles, clearAssetToggles } from '$lib/asset-toggles';
  import { installHintDismissed, loadInstallHintPref, clearInstallHintPref } from '$lib/install-hint-pref';
  import { clearPanelCollapse } from '$lib/panel-collapse-pref';
  import { clearPairingToken } from '$lib/pairing-token';
  import { deleteStatus } from '$lib/status-pusher';
  import { clearLastActivity } from '$lib/last-activity-persist';
  import {
    retainMode,
    loadRetainMode,
    setRetainMode,
    clearRetainMode,
    isRetainNarrowing,
    type RetainMode,
  } from '$lib/retain-mode';
  import InstallHelperHint from '../components/library-status/InstallHelperHint.svelte';
  import DefinitionTerm from '../components/DefinitionTerm.svelte';
  import { capabilitySnapshot, initCapabilitySnapshot } from '$lib/capability-snapshot';
  import { prospectiveBackendName } from '$lib/dominant-backend';

  let status = '';
  let error = '';
  let importInputEl: HTMLInputElement | undefined;

  let operatorProxyOptOut = false;
  let helperOptOut = false;
  // Mobile devices can't run the local helper (no Python, no port binding),
  // so the toggle is noise there. Computed once at mount; the resolution
  // doesn't change inside a session.
  const hideHelperControls = isMobileOs();
  let backupAdvancedOpen = false;
  let setupModalOpen = false;
  let customProxyConfigured = false;
  let savedCredentialsPresent = false;

  // Settings → "Remember my app password" form state. Mirrors the
  // SignIn → Advanced section: checkbox reveals passphrase + Save
  // button. Lets a user who forgot to check the box at sign-in time
  // (or who just signed in fresh) save credentials post-hoc, without
  // having to sign out and back in.
  let rememberCredsChecked = false;
  let rememberPassphrase = '';
  let rememberCredsStatus = '';
  let rememberCredsError = '';

  async function handleSaveCredentialsFromSettings(): Promise<void> {
    rememberCredsError = '';
    rememberCredsStatus = '';
    if (rememberPassphrase.length < 8) {
      rememberCredsError = 'Passphrase must be at least 8 characters.';
      return;
    }
    // We need the plaintext app password to encrypt — it only lives
    // on signInDraft (in-memory svelte store, populated by
    // SignIn.submit, cleared by signOut). If the user signed in on
    // this page life it's available. If they refreshed since signing
    // in, it isn't — they'd need to sign in again.
    const draft = get(signInDraft);
    if (!draft || !draft.appPassword) {
      rememberCredsError =
        "Your app password isn't in memory. Sign out and sign in again to save it.";
      return;
    }
    const session = get(lastSession);
    if (!session) {
      rememberCredsError = 'Not signed in.';
      return;
    }
    try {
      await persistCredentials(
        { handle: session.handle, appPassword: draft.appPassword, pds: session.pds },
        rememberPassphrase,
      );
      savedCredentialsPresent = true;
      rememberCredsStatus = 'Saved.';
      rememberPassphrase = '';
      rememberCredsChecked = false;
    } catch (e) {
      rememberCredsError = e instanceof Error ? e.message : String(e);
    }
  }

  async function refreshCustomProxyStatus(): Promise<void> {
    const cfg = await loadProxyConfig();
    customProxyConfigured = cfg !== null && cfg.url !== '' && cfg.sharedSecret !== '';
  }

  async function handleSetupModalChange(): Promise<void> {
    await refreshCustomProxyStatus();
    // Recompute the capability snapshot so Library / status panel
    // pick up the new user-worker config without a page reload.
    await initCapabilitySnapshot();
  }

  onMount(async () => {
    operatorProxyOptOut = await loadOperatorProxyOptOut();
    helperOptOut = await loadHelperOptOut();
    savedCredentialsPresent = await hasCredentials();
    await refreshCustomProxyStatus();
    void probeOperatorProxy();
    await loadAssetToggles();
    await loadInstallHintPref();
    await loadRetainMode();
  });

  import {
    probeOperatorProxy as runOperatorProxyProbe,
    type OperatorProxyStatus,
  } from '$lib/operator-proxy-probe';
  import { slideRoute } from '$lib/slide-transition';

  let operatorProxyReachable: OperatorProxyStatus = 'unknown';

  $: operatorProxyConfigured = config.operatorImageProxyUrl !== '';

  async function probeOperatorProxy(): Promise<void> {
    if (!operatorProxyConfigured) return;
    operatorProxyReachable = 'unknown';
    operatorProxyReachable = await runOperatorProxyProbe(
      config.operatorImageProxyUrl,
      config.operatorImageProxyKey,
    );
  }

  async function handleToggleOperatorProxyOptOut(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    await setOperatorProxyOptOut(checked);
    operatorProxyOptOut = checked;
    // Recompute the capability snapshot so Library reflects the new
    // image-backend selection (operator-worker → none when opting out).
    await initCapabilitySnapshot();
  }

  async function handleDisableOperatorProxyClick() {
    await disableOperatorProxy();
    operatorProxyOptOut = await loadOperatorProxyOptOut();
  }

  // The "Use the local helper" checkbox mirrors helperOptOut inverted —
  // checked = use the helper (opt-out false), unchecked = don't use it
  // (opt-out true). Re-init the capability snapshot so the new routing
  // takes effect immediately for the next refresh.
  async function handleToggleUseHelper(event: Event) {
    const useHelper = (event.target as HTMLInputElement).checked;
    helperOptOut = !useHelper;
    await setHelperOptOut(helperOptOut);
    await initCapabilitySnapshot();
  }

  $: toggles = $assetToggles;

  // Off→on flip kicks off the matching hydrator over the existing
  // inventory; on→off cancels any in-flight hydration so the user's
  // intent takes effect immediately rather than after the loop drains.
  // Mirrors the Library Hub badge behavior.
  function handleImagesToggleChange(event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    if (!checked) cancelImageBackup();
    void setAssetToggle('images', checked, { onImagesToggleOn: triggerImageHydration });
  }

  function handleArticlesToggleChange(event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    if (!checked) cancelArticleBackup();
    void setAssetToggle('articles', checked, { onArticlesToggleOn: triggerArticleHydration });
  }

  function handleThreadsToggleChange(event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    if (!checked) cancelThreadHydration();
    void setAssetToggle('threads', checked, { onThreadsToggleOn: triggerThreadHydration });
  }

  // The retain-mode <select> mirrors the `retainMode` store via this local,
  // but routes user changes through handleRetainModeChange so a *narrowing*
  // change (one that will delete inventory entries) is confirmed first. On a
  // declined confirm we revert this local, which Svelte syncs back to the
  // <select>.
  let selectedRetainMode: RetainMode = get(retainMode);
  $: selectedRetainMode = $retainMode;

  // The narrowing predicate (which transitions delete entries) is shared
  // logic in retain-mode.ts; only the user-facing copy lives here.
  function retainNarrowingWarning(from: RetainMode, to: RetainMode): string {
    const removesUnsaved = from === 'keep-all'; // keep-all is the only mode that retains unsaved entries
    const removesDeadSubject = to === 'sync'; // only sync prunes deleted/blocked entries
    const parts: string[] = [];
    if (removesUnsaved) parts.push('posts you unsaved');
    if (removesDeadSubject) parts.push('deleted or blocked posts');
    return `This will remove ${parts.join(' as well as ')} from your Library. Continue?`;
  }

  async function handleRetainModeChange(event: Event): Promise<void> {
    const next = (event.currentTarget as HTMLSelectElement).value as RetainMode;
    const current = get(retainMode);
    if (next === current) return;
    if (isRetainNarrowing(current, next) && !confirm(retainNarrowingWarning(current, next))) {
      selectedRetainMode = current; // revert — Svelte syncs the <select> back
      return;
    }
    const narrowing = isRetainNarrowing(current, next);
    await setRetainMode(next);
    // A narrowing change reconciles the inventory in place immediately, so the
    // confirm dialog's present-tense copy ("This will remove …") is accurate.
    // Widening changes only affect what future refreshes retain.
    if (narrowing) {
      const stored = await loadInventory();
      if (stored) {
        await saveInventory(applyRetainMode(stored, next));
        await loadFromDb();
      }
    }
  }

  // Trigger functions live in $lib/asset-trigger so the Library hub's
  // row-badge toggles use the exact same code path. See that module for
  // the canonical implementations.

  $: libraryFetchedAt = (() => {
    const s = $inventoryState;
    if (s.status !== 'ready') return null;
    const f = s.inventory.fetched_at;
    return typeof f === 'string' && f.length >= 10 ? f.slice(0, 10) : null;
  })();

  async function exportInventory() {
    error = '';
    const s = get(inventoryState);
    if (s.status !== 'ready') {
      error = 'No inventory loaded.';
      return;
    }
    const r = await exportJson(s.inventory);
    downloadFile(r.blob, r.filename);
  }

  async function importInventory(e: Event) {
    error = '';
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseInventory(JSON.parse(text));
      await saveInventory(parsed);
      await loadFromDb();
      status = `Imported ${parsed.saves.length} saved posts.`;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Import failed';
    } finally {
      input.value = '';
    }
  }

  async function clearAll() {
    if (!confirm('Wipe your Library and saved credentials from this browser? This cannot be undone.')) {
      return;
    }
    cancelImageBackup();
    cancelArticleBackup();
    // Clear data wipes the user's data, auth, and diagnostics. It
    // intentionally does NOT touch preferences or setup the user tuned
    // for this device — asset toggles, operator-proxy opt-out, install
    // hint, custom proxy configuration, and Library filters all
    // survive. "Reset preferences" is the separate action for those.
    //
    // The Pyodide worker is terminated as part of the data wipe. Its
    // emulated filesystem retains the inventory at
    // /home/pyodide/saves_inventory.json across runs in the same worker
    // session, and `bsky_saves.fetch.fetch_to_inventory()` merges new
    // fetches into whatever is at that path. Without termination, the
    // next sign-in (potentially a different account) would read the
    // previous user's saves off the worker's FS and merge new fetches
    // into them — a cross-account data leak. See
    // pyodide-worker-driver.ts::terminateSharedDriver for full notes.
    terminateSharedDriver();
    await Promise.all([
      clearInventory(),
      clearCredentials(),
      clearBeaconSent(),
      clearAccount(),
      clearImageBlobs(),
      clearFailures(),
    ]);
    clearLastSession();
    clearSessionHeartbeat();
    // Helper-side status snapshot. Must run BEFORE clearPairingToken()
    // so the bearer is still available for auth; resolves silently on
    // any failure since local wipe is the source of truth.
    await deleteStatus().catch(() => { /* best-effort */ });
    // Local persisted `last_activity` record (idb). Without this, a
    // subsequent "Clear all data" → sign-in → first activity sequence
    // would still see the prior activity record restored from idb at
    // initStatusPusher boot, defeating the wipe. See issue #85.
    await clearLastActivity();
    // Pairing token is per-device local state, not user-account data,
    // but Clear data is a "wipe everything in this browser" affordance
    // by the user's contract — leaving the token would surprise them.
    // The next visit to a saves.lightseed.net page with a running
    // helper will re-prompt to pair (or auto-pair via the meta tag if
    // wheel-served).
    clearPairingToken();
    // Resets all five hydration-progress stores — not just image/article.
    // The fetch/enrich/thread progress counters were previously left
    // stale after Clear data (issue #24).
    resetAllHydrationProgress();
    savedCredentialsPresent = false;
    operatorProxyReachable = 'unknown';
    void probeOperatorProxy();
    await loadFromDb();
    status = 'All local data cleared.';
  }

  async function clearAllPreferences() {
    if (!confirm('Reset preferences and custom setup to defaults? Your Library and credentials will not be affected.')) {
      return;
    }
    await Promise.all([
      clearAssetToggles(),
      clearOperatorProxyOptOut(),
      clearHelperOptOut(),
      clearInstallHintPref(),
      clearProxyConfig(),
      clearRetainMode(),
      clearPanelCollapse(),
    ]);
    resetLibraryFilters();
    operatorProxyOptOut = false;
    helperOptOut = false;
    customProxyConfigured = false;
    // Recompute capability snapshot since helper-opt-out, operator-proxy
    // opt-out, and custom proxy config all affect routing / backend
    // selection.
    await initCapabilitySnapshot();
    status = 'All preferences reset to defaults.';
  }

  function signOut() {
    // End the active session: clear the JWTs in sessionStorage AND the
    // in-memory sign-in draft (which holds the app password from the most
    // recent sign-in form submit). Without clearing the draft, asset
    // hydration could still authenticate against the PDS using the
    // residual password — making "Sign out" a no-op for active backups.
    // Inventory, encrypted credentials, and account label intentionally
    // stay so signing back in only requires the local-DB passphrase.
    // To wipe everything, use "Clear data".
    //
    // Intentionally NOT clearing the session-only marker: if the user
    // signed in unchecked, the session-mode banner should stay visible
    // after sign-out (its copy adapts to drop "and sign you out" when
    // there's no active session). The marker is cleared only by a
    // fresh sign-in, "Keep my saves in this browser"
    // (saveLibraryToDevice), or heartbeat expiry.
    //
    // Intentionally NOT navigating away from Settings either: the user
    // is in the middle of looking at their settings, and signing out
    // is a settings-side action. The runtime route gate in App.svelte
    // ensures any later attempt to reach /library or /post via
    // browser back / address bar redirects them to sign-in.
    //
    // Pyodide worker IS terminated here: a sign-out implies the next
    // sign-in may be a different account, and a reused worker carries
    // the previous user's inventory in its emulated FS (see
    // pyodide-worker-driver.ts::terminateSharedDriver). Cost: ~10s
    // cold-start on next fetch.
    terminateSharedDriver();
    clearLastSession();
    signInDraft.set(null);
  }
</script>

<section class="route route--settings" use:slideRoute>
  <header class="route__header">
    <h2 class="route__title">Settings</h2>
  </header>

  {#if status}
    <p class="status">{status}</p>
  {/if}
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  <section class="settings-section">
    <h3>Account</h3>
    {#if $lastSession}
      <p class="help">
        Signed in as <code>@{$lastSession.handle}</code>.
      </p>
      <div class="settings-row">
        <button type="button" on:click={signOut}>Sign out</button>
      </div>
      <p class="help">
        {#if $persistenceMode === 'session-only' && savedCredentialsPresent}
          You must be signed in to refresh your saved posts. Saved credentials stay on this device — to wipe them, <strong>Clear data</strong> below.
        {:else if $persistenceMode === 'session-only'}
          You must be signed in to refresh your saved posts.
        {:else if savedCredentialsPresent}
          You must be signed in to refresh your saved posts. Your Library and saved credentials stay on this device — to wipe them, <strong>Clear data</strong> below.
        {:else}
          You must be signed in to refresh your saved posts. Your Library stays on this device — to wipe it, <strong>Clear data</strong> below.
        {/if}
      </p>

      {#if !savedCredentialsPresent}
        <label class="checkbox settings-section--spaced">
          <input type="checkbox" bind:checked={rememberCredsChecked} />
          <span>Remember my app password on this device</span>
        </label>
        {#if rememberCredsChecked}
          <div class="card advanced settings-creds-form">
            <label class="settings-field">
              <DefinitionTerm>
                <span slot="term">Passphrase</span>
                Your app password gets locked with this passphrase and stored only
                in this browser. If you forget the passphrase, you'll just need to
                type your app password again next time.
              </DefinitionTerm>
              <input
                type="password"
                bind:value={rememberPassphrase}
                minlength="8"
                autocomplete="new-password"
              />
            </label>
            <div class="settings-row">
              <button type="button" on:click={handleSaveCredentialsFromSettings}>Save</button>
            </div>
            {#if rememberCredsStatus}
              <p class="status">{rememberCredsStatus}</p>
            {/if}
            {#if rememberCredsError}
              <p class="error" role="alert">{rememberCredsError}</p>
            {/if}
          </div>
        {/if}
      {/if}
    {:else}
      <p class="help">Not signed in. You must be signed in to refresh your saved posts.</p>
      <div class="settings-row">
        <button type="button" on:click={() => navigate('/')}>Sign in</button>
      </div>
    {/if}
  </section>

  <section class="settings-section">
    <h3>Library</h3>
    {#if $inventoryState.status === 'ready'}
      <p class="help">
        {$inventoryState.inventory.saves.length} saved posts{#if libraryFetchedAt}, last updated {libraryFetchedAt}{/if}.
      </p>
    {:else if $inventoryState.status === 'empty'}
      <p class="help">No saves yet.</p>
    {/if}
    <div class="settings-row">
      {#if $inventoryState.status === 'ready'}
        <button type="button" on:click={exportInventory}>Export inventory file</button>
      {/if}
      <button type="button" on:click={() => importInputEl?.click()}>Import inventory file</button>
      <input
        bind:this={importInputEl}
        type="file"
        accept=".json,application/json"
        on:change={importInventory}
        hidden
      />
    </div>
  </section>

  <section class="settings-section">
    <h3>Backups</h3>
    <p class="help">Choose what you want to keep in your Library.</p>
    <select
      class="retain-mode"
      aria-label="What to keep in your Library"
      bind:value={selectedRetainMode}
      on:change={handleRetainModeChange}
    >
      <option value="keep-all">Keep everything, including posts I unsave</option>
      <option value="keep-lost">Keep deleted or blocked posts</option>
      <option value="sync">Keep only what's shown now on Bluesky</option>
    </select>
    <p class="help">Choose which kinds of backups Library should keep up to date.</p>
    <label class="checkbox">
      <input
        type="checkbox"
        checked={toggles.threads}
        on:change={handleThreadsToggleChange}
      />
      <span>Back up threads</span>
      <!-- Threads only ever route through helper or pyodide; nothing to surface. -->
    </label>
    <label class="checkbox">
      <input
        type="checkbox"
        checked={toggles.images}
        on:change={handleImagesToggleChange}
      />
      <span>Back up images</span>
      {#if $capabilitySnapshot.images.kind === 'none'}
        <span class="backend-note">— no backend available <button type="button" class="setup-link" on:click={() => (setupModalOpen = true)}>Set up</button></span>
      {:else if prospectiveBackendName($capabilitySnapshot.images.kind)}
        <span class="backend-note">— {toggles.images ? 'via' : 'would use'} {prospectiveBackendName($capabilitySnapshot.images.kind)}{#if $capabilitySnapshot.images.kind === 'operator-worker'}{' '}<button type="button" class="setup-link" on:click={handleDisableOperatorProxyClick}>Don't use</button>{/if}</span>
      {/if}
    </label>
    <label class="checkbox">
      <input
        type="checkbox"
        checked={toggles.articles}
        on:change={handleArticlesToggleChange}
      />
      <span>Back up articles</span>
      {#if $capabilitySnapshot.articles.kind === 'none'}
        <span class="backend-note">— no backend available <button type="button" class="setup-link" on:click={() => (setupModalOpen = true)}>Set up</button></span>
      {:else if prospectiveBackendName($capabilitySnapshot.articles.kind)}
        <span class="backend-note">— {toggles.articles ? 'via' : 'would use'} {prospectiveBackendName($capabilitySnapshot.articles.kind)}</span>
      {/if}
    </label>

    {#if !hideHelperControls}
      <label class="checkbox settings-section--spaced">
        <input
          type="checkbox"
          checked={!helperOptOut}
          on:change={handleToggleUseHelper}
        />
        <span>Use the local helper from this browser</span>
      </label>
    {/if}

    <details
      class="advanced-toggle"
      bind:open={backupAdvancedOpen}
    >
      <summary>Advanced backup options</summary>

      <div class="card advanced">
        <p class="advanced-heading">
          <strong>
            <DefinitionTerm>
              <span slot="term">Custom Cloudflare Worker proxy</span>
              Used as a fallback when no local helper is running. The setup is
              one-time, takes about 10 minutes, and runs on Cloudflare's free tier.
            </DefinitionTerm>
          </strong>
        </p>

        <button type="button" class="setup-guide-trigger" on:click={() => (setupModalOpen = true)}>
          {customProxyConfigured ? 'Edit setup' : 'Setup guide'}
        </button>

        {#if operatorProxyConfigured}
          <p class="advanced-heading advanced-heading--spaced">
            <strong>
              <DefinitionTerm>
                <span slot="term">Operator's image proxy</span>
                When set up by the site operator, this proxy is used as a fallback
                for image backup when no local helper or custom Cloudflare Worker is
                configured. Image bytes flow through the operator's worker; the
                operator does not log URLs or content.
              </DefinitionTerm>
            </strong>
          </p>
          <p class="help">
            <code>{config.operatorImageProxyUrl}</code>
            {#if operatorProxyReachable === 'ok'}
              <span class="status-ok">· reachable</span>
            {:else if operatorProxyReachable === 'origin-blocked'}
              <span class="status-fail">· this origin is not in the worker's ALLOWED_ORIGIN</span>
            {:else if operatorProxyReachable === 'unauthorized'}
              <span class="status-fail">· shared-secret mismatch</span>
            {:else if operatorProxyReachable === 'unreachable'}
              <span class="status-fail">· unreachable</span>
            {/if}
          </p>
          <label class="checkbox">
            <input
              type="checkbox"
              checked={operatorProxyOptOut}
              on:change={handleToggleOperatorProxyOptOut}
            />
            <span>Don't use the operator's proxy</span>
          </label>
        {/if}
      </div>
    </details>
  </section>

  {#if !$capabilitySnapshot.helper.detected && $installHintDismissed}
    <InstallHelperHint showDismiss={false} />
  {/if}

  <section class="settings-section">
    <h3>Reset</h3>
    <div class="settings-row">
      <button type="button" class="danger" on:click={clearAll}>Clear data</button>
    </div>
    <p class="help">
      Wipes your Library and saved credentials from this browser. This cannot be undone.
    </p>
    <div class="settings-row advanced-heading--spaced">
      <button type="button" on:click={clearAllPreferences}>Reset preferences</button>
    </div>
    <p class="help">
      Reset preferences and custom setup to defaults. Your Library and credentials are not affected.
    </p>
  </section>

  <CustomProxySetupModal
    open={setupModalOpen}
    on:close={() => (setupModalOpen = false)}
    on:change={handleSetupModalChange}
  />
</section>

<style>
  .route--settings {
    max-width: 44rem;
    margin: 0 auto;
  }
  .route__header {
    /* Matches Library's `.route__header` padding-top so both titles sit
       the same distance below the app navbar. */
    padding-top: 0.75rem;
    margin-bottom: 1.5rem;
  }
  .route__title {
    margin: 0;
  }
  .settings-section {
    border-top: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
    padding: 1rem 0;
  }
  /* When the InstallHelperHint sits directly above a settings section,
     drop the section's top border so the hint isn't visually fenced
     in below. */
  :global(.install-hint) + .settings-section {
    border-top: 0;
  }
  /* Pull "Advanced backup options" away from the last Backup checkbox. */
  .settings-section .advanced-toggle {
    margin-top: 1.25rem;
  }
  .settings-section h3 {
    margin: 0 0 0.5rem;
  }
  .settings-section .help {
    margin: 0 0 0.75rem;
    font-size: 0.875rem;
    opacity: 0.8;
  }
  .settings-section select.retain-mode {
    display: block;
    margin: 0 0 1.5rem;
    padding: 0.35rem 0.5rem;
    font: inherit;
    max-width: 100%;
  }
  /* When a help paragraph sits immediately after a button row, give
     it breathing room above so the explanation reads as belonging to
     the button rather than fused to it. */
  .settings-section .settings-row + .help {
    margin-top: 0.5rem;
  }
  /* Inline checkboxes for "Don't ask me" toggles. */
  .settings-section label.checkbox {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
    margin: 0.25rem 0 0.5rem;
    font-weight: normal;
    font-size: 0.875rem;
    opacity: 0.85;
    flex-wrap: wrap;
  }
  /* Keep "Back up images" / "Back up articles" on one line so the
     checkbox label never breaks mid-phrase. Long backend notes drop
     to their own line via the media query below. */
  .settings-section label.checkbox > span:not(.backend-note) {
    white-space: nowrap;
  }
  .backend-note {
    font-size: 0.85em;
    opacity: 0.75;
  }
  /* Below the narrow-viewport breakpoint, force the backend note to a
     new line on both image and article rows together — even when only
     one would naturally collide — so the two rows stay visually
     parallel. Indent the note under the label text past the checkbox. */
  @media (max-width: 768px) {
    .settings-section label.checkbox .backend-note {
      flex-basis: 100%;
      padding-left: 1.5rem;
    }
  }
  .backend-note .setup-link {
    font: inherit;
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .settings-section code {
    background: color-mix(in oklab, CanvasText 5%, Canvas);
    padding: 0.1em 0.3em;
    border-radius: 3px;
    font-size: 0.9em;
  }
  .settings-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .settings-row button {
    font: inherit;
    line-height: 1.25;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
  }
  .danger {
    background: color-mix(in oklab, red 10%, Canvas);
    border: 1px solid color-mix(in oklab, red 30%, transparent);
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .status {
    color: color-mix(in oklab, green 70%, CanvasText);
    font-weight: 500;
  }
  .error {
    color: color-mix(in oklab, red 70%, CanvasText);
    font-weight: 500;
  }
  /* "Remember my app password" form revealed by the checkbox in
     Settings → Account. Container reuses .card.advanced so it
     visually matches the other Advanced cards (Settings backup,
     SignIn → Advanced) — no background, just an outlined box. */
  .settings-section--spaced {
    margin-top: 0.75rem;
  }
  .settings-creds-form {
    margin-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .settings-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.875rem;
  }
  .settings-field input {
    font: inherit;
    padding: 0.4rem 0.5rem;
    border: 1px solid color-mix(in oklab, CanvasText 25%, transparent);
    border-radius: 4px;
  }
  .advanced-toggle > summary {
    margin-bottom: 0.75rem;
  }
  .card.advanced {
    border: 1px solid color-mix(in oklab, CanvasText 15%, transparent);
    border-radius: 8px;
    padding: 1rem 1.25rem;
  }
  .advanced-heading {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
  }
  .advanced-heading--spaced {
    margin-top: 1.25rem;
  }
  .card.advanced .help {
    margin-top: 0;
  }
  .status-ok {
    color: color-mix(in oklab, green 70%, CanvasText);
    font-weight: 500;
  }
  .status-fail {
    color: color-mix(in oklab, red 70%, CanvasText);
    font-weight: 500;
  }
  .setup-guide-trigger {
    font: inherit;
    padding: 0.35rem 0.75rem;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
    margin: 0.5rem 0;
  }
</style>

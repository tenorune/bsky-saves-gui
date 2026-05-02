<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { signInDraft } from '$lib/sign-in-draft';
  import { navigate } from '$lib/router';
  import { runJob } from '$lib/engine';
  import { saveCredentials } from '$lib/credentials-store';
  import { InvalidCredentialsError, PdsError } from '$lib/atproto';

  let logLines: string[] = [];
  let status: 'idle' | 'running' | 'done' | 'error' = 'idle';
  let errorMessage = '';

  function appendLog(line: string) {
    logLines = [...logLines, line];
  }

  async function start() {
    const draft = get(signInDraft);
    if (!draft) {
      navigate('/');
      return;
    }
    status = 'running';
    appendLog('Starting…');
    try {
      await runJob(
        {
          handle: draft.handle,
          appPassword: draft.appPassword,
          pds: draft.pds,
          enrich: draft.enrich,
        },
        { onLog: appendLog },
      );
      if (draft.saveCredentials && draft.passphrase) {
        await saveCredentials(
          { handle: draft.handle, appPassword: draft.appPassword, pds: draft.pds },
          draft.passphrase,
        );
        appendLog('Credentials saved (encrypted).');
      }
      status = 'done';
      appendLog('Done. Opening library…');
      navigate('/library');
    } catch (e) {
      status = 'error';
      if (e instanceof InvalidCredentialsError) {
        errorMessage = 'Invalid handle or app password.';
      } else if (e instanceof PdsError) {
        errorMessage = `PDS error (${e.status}). Try again or check the PDS URL.`;
      } else {
        const raw = e instanceof Error ? e.message : String(e);
        // Detect the sync-XMLHttpRequest network failure that some PDSs
        // (notably eurosky.social) trigger when bsky-saves' httpx call is
        // routed through pyodide-http's blocking XHR. The browser is
        // restricting cross-origin sync XHR; only a Web Worker move fixes it.
        if (/XMLHttpRequest|Failed to execute 'send'|Failed to load/i.test(raw)) {
          errorMessage =
            'Network error inside the in-browser Python runtime. ' +
            'This usually means the PDS is rejecting the synchronous request ' +
            "from Pyodide's HTTP shim. Sign in with Bluesky's main PDS " +
            '(https://bsky.social) for now — a future build will move Pyodide ' +
            'into a Web Worker, which will fix this for third-party PDSs.';
        } else {
          errorMessage = raw;
        }
      }
      appendLog(`Failed: ${errorMessage}`);
    }
  }

  onMount(() => {
    void start();
  });
</script>

<section class="route route--run">
  <h2>Running</h2>

  {#if status === 'done'}
    <p class="status status--done">Done.</p>
  {:else if status === 'error'}
    <p class="status status--error">Error.</p>
  {/if}

  <pre class="log" aria-live="polite">{logLines.join('\n')}</pre>

  {#if status === 'error'}
    <button type="button" on:click={() => navigate('/')}>Back to sign-in</button>
  {/if}
</section>

<style>
  .route--run {
    max-width: 44rem;
    margin: 0 auto;
  }
  .log {
    background: color-mix(in oklab, CanvasText 5%, Canvas);
    padding: 1rem;
    overflow: auto;
    max-height: 60vh;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.875rem;
    border-radius: 6px;
    white-space: pre-wrap;
  }
  .status {
    font-weight: 500;
  }
  button {
    padding: 0.5rem 1rem;
    font: inherit;
    cursor: pointer;
  }
</style>

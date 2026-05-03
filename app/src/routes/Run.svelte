<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { signInDraft } from '$lib/sign-in-draft';
  import { lastSession } from '$lib/last-session';
  import { navigate } from '$lib/router';
  import { runJob, type RunJobInput } from '$lib/engine';
  import { saveCredentials } from '$lib/credentials-store';
  import { loadInventory } from '$lib/inventory-store';
  import { loadFromDb } from '$lib/inventory-loader';
  import { InvalidCredentialsError, PdsError } from '$lib/atproto';

  let logLines: string[] = [];
  let status: 'idle' | 'running' | 'done' | 'error' = 'idle';
  let errorMessage = '';

  function appendLog(line: string) {
    logLines = [...logLines, line];
  }

  async function start() {
    const draft = get(signInDraft);
    const session = get(lastSession);

    let input: RunJobInput;
    if (draft && draft.appPassword) {
      // Fresh sign-in OR saved-creds unlock: do a full createSession.
      input = {
        mode: 'password',
        handle: draft.handle,
        appPassword: draft.appPassword,
        pds: draft.pds,
        fetch: draft.fetch,
        enrich: draft.enrich,
        threads: draft.threads,
      };
    } else if (session) {
      // Refresh from a session that survived a reload via sessionStorage.
      input = {
        mode: 'session',
        session: {
          accessJwt: session.accessJwt,
          refreshJwt: session.refreshJwt,
          did: session.did,
          handle: session.handle,
        },
        pds: session.pds,
        fetch: draft?.fetch ?? true,
        enrich: draft?.enrich ?? true,
        threads: draft?.threads ?? false,
      };
    } else {
      navigate('/');
      return;
    }

    status = 'running';
    const existing = await loadInventory();
    appendLog(existing ? 'Refreshing…' : 'Starting…');
    try {
      await runJob(input, { onLog: appendLog });
      if (draft?.saveCredentials && draft.passphrase && draft.appPassword) {
        await saveCredentials(
          { handle: draft.handle, appPassword: draft.appPassword, pds: draft.pds },
          draft.passphrase,
        );
        appendLog('Credentials saved (encrypted).');
      }
      status = 'done';
      // Refresh the in-memory inventory store so Library / Post focus pick up
      // the just-written saves and any newly hydrated fields without a reload.
      await loadFromDb();
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
        // The Python traceback is captured by our stdout/stderr stream so it
        // shows up in `logLines` rather than in `e.message`. Look in both.
        const haystack = `${logLines.join('\n')}\n${raw}`;
        if (/XMLHttpRequest|Failed to execute 'send'|Failed to load/i.test(haystack)) {
          errorMessage =
            'Network error inside the in-browser Python runtime. ' +
            'This usually means the PDS is rejecting the synchronous request ' +
            "from Pyodide's HTTP shim. Sign in with Bluesky's main PDS " +
            '(https://bsky.social) for now — a future build will move Pyodide ' +
            'into a Web Worker, which will fix this for third-party PDSs.';
        } else if (raw) {
          errorMessage = raw;
        } else {
          // e.message was empty (common for PythonError after the traceback
          // streamed out via our stderr capture). Pull the last meaningful
          // line of the streamed log — typically the exception summary like
          // "AttributeError: '_LineWriter' object has no attribute 'isatty'".
          const lastError = [...logLines]
            .reverse()
            .find((l) => /\b(Error|Exception):\s/.test(l));
          errorMessage =
            lastError ?? 'Unknown error. Check browser console for details.';
        }
        // Also surface the full error to the browser console so it's never lost.
        // eslint-disable-next-line no-console
        console.error('Run failed:', e);
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

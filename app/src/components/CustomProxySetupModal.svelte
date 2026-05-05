<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import CopyButton from './CopyButton.svelte';
  // The cf-worker source, loaded at build time. The `?raw` suffix is a Vite
  // feature that bundles the file content as a string. Path is relative to
  // this file (app/src/components/) → up three → into templates/cf-worker.
  import workerSource from '../../../templates/cf-worker/worker.js?raw';
  import { onMount } from 'svelte';
  import { loadProxyConfig, saveProxyConfig, clearProxyConfig } from '$lib/proxy-config';

  export let open = false;

  const dispatch = createEventDispatcher<{ close: void; change: void }>();

  const SECRET_GEN = `crypto.getRandomValues(new Uint8Array(32)).reduce((a,b)=>a+b.toString(16).padStart(2,'0'),'')`;

  let workerUrl = '';
  let workerSecret = '';
  let saveStatus = '';

  onMount(async () => {
    const cfg = await loadProxyConfig();
    if (cfg) {
      workerUrl = cfg.url;
      workerSecret = cfg.sharedSecret;
    }
  });

  async function handleSaveWorker() {
    if (!workerUrl || !workerSecret) {
      saveStatus = 'Both URL and shared secret are required.';
      return;
    }
    await saveProxyConfig({ url: workerUrl, sharedSecret: workerSecret });
    saveStatus = 'Saved.';
    dispatch('change');
  }

  async function handleClearWorker() {
    await clearProxyConfig();
    workerUrl = '';
    workerSecret = '';
    saveStatus = 'Cleared.';
    dispatch('change');
  }

  $: allowedOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  function close() {
    dispatch('close');
  }

  function onBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) close();
  }

  function onKeyDown(event: KeyboardEvent) {
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
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="setup-modal-title">
      <header class="modal__header">
        <h3 id="setup-modal-title" class="modal__title">
          Set up a custom Cloudflare Worker proxy
        </h3>
        <button type="button" class="modal__close" on:click={close} aria-label="Close">
          ✕
        </button>
      </header>

      <p class="modal__step0">
        <strong>Prefer the command line?</strong>
        See the
        <a
          href="https://github.com/tenorune/bsky-saves-gui/blob/main/templates/cf-worker/README.md"
          target="_blank"
          rel="noopener noreferrer"
        >cf-worker README</a>
        for <code>wrangler deploy</code> instructions.
      </p>

      <ol class="modal__steps">
        <li>
          <strong>Generate a shared secret.</strong>
          Open your browser's DevTools (F12 → Console). Paste this and press
          Enter:
          <div class="modal__codeblock">
            <pre>{SECRET_GEN}</pre>
            <CopyButton text={SECRET_GEN} label="Copy command" />
          </div>
          You'll get a 64-character hex string. Copy it — you'll paste it twice
          below.
        </li>

        <li>
          <strong>Create the worker on Cloudflare.</strong>
          Go to
          <a href="https://dash.cloudflare.com" target="_blank" rel="noopener noreferrer">dash.cloudflare.com</a>
          → Compute → Workers &amp; Pages → Create application → Start with
          Hello World! Name it something like
          <code>bsky-saves-image-proxy</code>. Click <em>Deploy</em> to accept
          the placeholder.
        </li>

        <li>
          <strong>Paste the worker source.</strong>
          On the worker page click <em>Edit code</em>. Paste the following over
          the placeholder. Click <em>Deploy</em>.
          <div class="modal__codeblock modal__codeblock--scroll">
            <pre>{workerSource}</pre>
            <CopyButton text={workerSource} label="Copy worker source" />
          </div>
        </li>

        <li>
          <strong>Set environment variables.</strong>
          Worker page → Settings → Variables and Secrets:
          <ul>
            <li>
              Variable <code>ALLOWED_ORIGIN</code> = <code>{allowedOrigin}</code>
            </li>
            <li>
              Secret <code>SHARED_SECRET</code> = the 64-character hex string
              from step 1
            </li>
          </ul>
        </li>

        <li>
          <strong>Copy the worker URL.</strong>
          It's at the top of the worker page, ending in
          <code>.workers.dev</code>. Test it by pasting
          <code>&lt;that URL&gt;/fetch</code> into a browser tab — you should
          see <code>{`{"error":"forbidden"}`}</code> with status 403. That
          means the worker is reachable.
        </li>

        <li>
          <strong>Paste here.</strong>
          Put the URL into <em>Proxy URL</em> and the same hex string into
          <em>Shared secret</em>. Click Save.
          <div class="modal__form">
            <label class="modal__field">
              Proxy URL
              <input type="url" bind:value={workerUrl} placeholder="https://your-worker.workers.dev" />
            </label>
            <label class="modal__field">
              Shared secret
              <input type="password" bind:value={workerSecret} />
            </label>
            <div class="modal__form-actions">
              <button type="button" on:click={handleSaveWorker}>Save</button>
              <button type="button" on:click={handleClearWorker}>Clear</button>
              {#if saveStatus}<span class="modal__form-status">{saveStatus}</span>{/if}
            </div>
          </div>
        </li>
      </ol>

      <footer class="modal__footer">
        <button type="button" on:click={close}>Done</button>
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
    max-width: 44rem;
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
    margin-bottom: 0.5rem;
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
  .modal__steps {
    margin: 0 0 0.5rem 1.25rem;
    padding: 0;
    font-size: 0.9rem;
    line-height: 1.55;
  }
  .modal__steps li {
    margin-bottom: 1rem;
  }
  .modal__steps ul {
    margin: 0.5rem 0 0 1rem;
    padding: 0;
  }
  .modal__codeblock {
    position: relative;
    margin: 0.5rem 0;
  }
  .modal__codeblock pre {
    margin: 0;
    padding: 0.6rem 2.5rem 0.6rem 0.75rem;
    background: color-mix(in oklab, CanvasText 8%, Canvas);
    border-radius: 4px;
    font-size: 0.8rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .modal__codeblock--scroll pre {
    max-height: 14rem;
    overflow: auto;
    word-break: normal;
    white-space: pre;
  }
  .modal__codeblock :global(.copy-button) {
    position: absolute;
    top: 0.4rem;
    right: 0.4rem;
  }
  .modal__steps li :global(.copy-button) {
    margin-left: 0.4rem;
    vertical-align: middle;
  }
  .modal__step0 {
    margin: 0 0 0.75rem;
    padding: 0.5rem 0.75rem;
    background: color-mix(in oklab, CanvasText 4%, Canvas);
    border-radius: 6px;
    font-size: 0.85rem;
  }
  .modal__form {
    margin-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .modal__field {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.85rem;
    font-weight: 500;
  }
  .modal__field input {
    font: inherit;
    padding: 0.4rem 0.6rem;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 4px;
    background: Canvas;
    color: CanvasText;
  }
  .modal__form-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .modal__form-actions button {
    font: inherit;
    padding: 0.35rem 0.85rem;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 4px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
  }
  .modal__form-status {
    font-size: 0.85rem;
    opacity: 0.8;
  }
  .modal__footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.5rem;
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
  a {
    color: inherit;
    text-decoration: underline;
  }
</style>

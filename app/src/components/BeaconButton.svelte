<script lang="ts">
  import { onMount } from 'svelte';
  import { config } from '$lib/config';
  import { hasBeaconBeenSent, markBeaconSent, likeBeacon } from '$lib/beacon';
  import { lastSession } from '$lib/last-session';

  let visible = !!config.beaconAtUri;
  let sent = false;
  let busy = false;
  let error = '';

  onMount(async () => {
    if (!visible) return;
    sent = await hasBeaconBeenSent();
  });

  async function fire() {
    error = '';
    const session = $lastSession;
    if (!session) {
      error = 'Sign in first.';
      return;
    }
    busy = true;
    try {
      await likeBeacon({ pds: session.pds, accessJwt: session.accessJwt, did: session.did });
      await markBeaconSent();
      sent = true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

{#if visible}
  <div class="beacon-button">
    {#if sent}
      <span>Thanks 💌</span>
    {:else}
      <button type="button" on:click={fire} disabled={busy}>
        Tell @{config.operatorHandle} you used this
      </button>
      {#if error}
        <span class="error">{error}</span>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .beacon-button {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  button {
    font: inherit;
    padding: 0.25rem 0.6rem;
    cursor: pointer;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: inherit;
  }
  .error {
    color: color-mix(in oklab, red 70%, CanvasText);
    font-size: 0.875rem;
  }
</style>

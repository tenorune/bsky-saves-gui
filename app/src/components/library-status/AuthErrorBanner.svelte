<script lang="ts">
  import { navigate } from '$lib/router';

  /** Error message from the daemon (e.g., "auth refresh failed"). */
  export let message: string = '';
</script>

<div class="auth-error" role="alert">
  <span class="auth-error__text">
    <strong>Couldn't refresh.</strong>
    {message ? message : 'Your sign-in expired. Please sign in again to continue.'}
  </span>
  <button type="button" class="auth-error__cta" on:click={() => navigate('/')}>Sign in</button>
</div>

<style>
  .auth-error {
    margin: 0 0 0.6rem;
    padding: 0.5rem 0.7rem;
    border-radius: 6px;
    background: color-mix(in oklab, red 12%, Canvas);
    border: 1px solid color-mix(in oklab, red 35%, transparent);
    font-size: 0.875rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }
  .auth-error__text { flex: 1 1 18rem; }
  .auth-error__cta {
    font: inherit;
    font-size: 0.8rem;
    padding: 0.2rem 0.55rem;
    border: 1px solid color-mix(in oklab, CanvasText 25%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
    margin-left: auto;
  }
</style>

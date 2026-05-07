<script lang="ts">
  import { MIN_HELPER_VERSION } from '$lib/min-helper-version';

  /** Currently-detected helper version. */
  export let version: string;
</script>

<div class="outdated-helper" role="alert">
  <span>
    Your helper is outdated ({version}). Upgrade to {MIN_HELPER_VERSION}+ for faster fetch and the JWT-pair auth path.
  </span>
  <a class="outdated-helper__link" href="https://github.com/tenorune/bsky-saves#install" target="_blank" rel="noopener noreferrer">How to upgrade</a>
</div>

<style>
  .outdated-helper {
    margin: 0 0 0.6rem;
    padding: 0.5rem 0.7rem;
    border-radius: 6px;
    background: color-mix(in oklab, gold 18%, Canvas);
    border: 1px solid color-mix(in oklab, gold 40%, transparent);
    font-size: 0.875rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }
  .outdated-helper__link {
    margin-left: auto;
    font-size: 0.8rem;
    color: inherit;
  }
</style>

<script lang="ts">
  import type { Save } from './inventory-shape';
  import { lifecycleBadges, lifecycleBadgeLabel } from './save-lifecycle';

  export let save: Save;

  $: badges = lifecycleBadges(save);
</script>

{#if badges.length > 0}
  <div class="lifecycle-badges">
    {#each badges as badge (badge)}
      <span class="lifecycle-badge lifecycle-badge--{badge}">{lifecycleBadgeLabel(badge)}</span>
    {/each}
  </div>
{/if}

<style>
  .lifecycle-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 0.5rem;
  }
  .lifecycle-badge {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    border: 1px solid currentColor;
  }
  .lifecycle-badge--deleted,
  .lifecycle-badge--blocked {
    color: color-mix(in oklab, #c0392b 80%, CanvasText);
    background: color-mix(in oklab, #c0392b 12%, Canvas);
  }
  .lifecycle-badge--unsaved {
    color: color-mix(in oklab, #b8860b 80%, CanvasText);
    background: color-mix(in oklab, #b8860b 12%, Canvas);
  }
</style>

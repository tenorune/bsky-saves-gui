<script lang="ts">
  import { onMount } from 'svelte';
  import { marked } from 'marked';
  import { config } from '$lib/config';
  import { slideRoute } from '$lib/slide-transition';
  // Vite's `?raw` import returns the file contents as a string at build time.
  import rawPrivacy from '../../../docs/privacy.md?raw';

  // Substitute config placeholders.
  const substituted = rawPrivacy
    .replaceAll('${VITE_APP_NAME}', config.appName)
    .replaceAll('${VITE_APP_DOMAIN}', config.appDomain)
    .replaceAll('${VITE_OPERATOR_HANDLE}', config.operatorHandle);

  // Strip the leading "# Privacy" heading from the rendered body — the
  // page now provides its own <h2 class="route__title"> matching the
  // Library / Settings title styling. Without this we'd render two
  // headings, the old <h1> below the new <h2>.
  const bodyMarkdown = substituted.replace(/^#\s+Privacy\s*\n+/, '');

  const html = marked.parse(bodyMarkdown, { async: false }) as string;

  onMount(() => {
    // Always open Privacy at the top — typical entry points (footer
    // link, SignIn intro) live near the bottom of their respective
    // routes, and the browser keeps window.scrollY across the SPA
    // route swap. Without this jump, the user arrives mid-page.
    window.scrollTo(0, 0);
  });
</script>

<section class="route route--privacy" use:slideRoute>
  <header class="route__header">
    <h2 class="route__title">Privacy</h2>
  </header>
  <div class="privacy-doc">
    {@html html}
  </div>
</section>

<style>
  .route--privacy {
    width: 100%;
    max-width: 44rem;
    margin: 0 auto;
  }
  .route__header {
    /* Matches Library / Settings header spacing so the title sits
       the same distance below the topnav across routes. */
    padding-top: 0.75rem;
    margin-bottom: 1.5rem;
  }
  .route__title {
    margin: 0;
  }
  .privacy-doc {
    line-height: 1.6;
  }
  .privacy-doc :global(h2) {
    margin-top: 2rem;
  }
  .privacy-doc :global(code) {
    background: color-mix(in oklab, CanvasText 5%, Canvas);
    padding: 0.1em 0.3em;
    border-radius: 3px;
    font-size: 0.9em;
  }
</style>

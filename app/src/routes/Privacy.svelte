<script lang="ts">
  import { marked } from 'marked';
  import { config } from '$lib/config';
  // Vite's `?raw` import returns the file contents as a string at build time.
  import rawPrivacy from '../../../docs/privacy.md?raw';

  // Substitute config placeholders.
  const substituted = rawPrivacy
    .replaceAll('${VITE_APP_NAME}', config.appName)
    .replaceAll('${VITE_APP_DOMAIN}', config.appDomain)
    .replaceAll('${VITE_OPERATOR_HANDLE}', config.operatorHandle);

  const html = marked.parse(substituted, { async: false }) as string;
</script>

<section class="route route--privacy">
  <div class="privacy-doc">
    {@html html}
  </div>
</section>

<style>
  .privacy-doc {
    max-width: 44rem;
    margin: 0 auto;
    line-height: 1.6;
  }
  .privacy-doc :global(h1) {
    margin-bottom: 1rem;
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

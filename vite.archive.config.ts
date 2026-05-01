import { defineConfig } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';

// Builds the archive-template entry as a single self-contained HTML file.
// All JS and CSS are inlined so the resulting `dist/archive-template/index.html`
// works when fetched at runtime by html-exporter.ts and when opened from disk
// after export. Run this AFTER the main vite build (it writes into the same
// dist/ tree but a different subdirectory).
export default defineConfig(() => {
  const projectRoot = fileURLToPath(new URL('.', import.meta.url));
  return {
    root: projectRoot,
    publicDir: false,
    define: {
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    build: {
      // Output into the existing dist/ tree (preserved from the main build).
      // Vite places `archive-template/index.html` inside this dir based on
      // the input path's relative location, so the final file lands at
      // `dist/archive-template/index.html`.
      outDir: 'dist',
      emptyOutDir: false,
      sourcemap: false,
      rollupOptions: {
        input: resolve(projectRoot, 'archive-template/index.html'),
      },
    },
    resolve: {
      alias: {
        $lib: resolve(projectRoot, 'app/src/lib'),
        $routes: resolve(projectRoot, 'app/src/routes'),
      },
    },
    plugins: [svelte({ preprocess: vitePreprocess() }), viteSingleFile()],
  };
});

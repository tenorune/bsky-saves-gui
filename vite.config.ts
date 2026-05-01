import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  root: 'app',
  publicDir: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./app/src/lib', import.meta.url)),
      $routes: fileURLToPath(new URL('./app/src/routes', import.meta.url)),
    },
  },
  plugins: [svelte()],
});

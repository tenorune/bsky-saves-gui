import { defineConfig, loadEnv } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';
import { cnamePlugin } from './tools/vite-plugin-cname';

export default defineConfig(({ mode }) => {
  const projectRoot = fileURLToPath(new URL('.', import.meta.url));
  const env = loadEnv(mode, projectRoot, 'VITE_');
  const domain = env.VITE_APP_DOMAIN ?? '';

  return {
    root: projectRoot,
    publicDir: resolve(projectRoot, 'app/public'),
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: {
          main: resolve(projectRoot, 'index.html'),
          archive: resolve(projectRoot, 'archive-template/index.html'),
        },
      },
    },
    resolve: {
      alias: {
        $lib: resolve(projectRoot, 'app/src/lib'),
        $routes: resolve(projectRoot, 'app/src/routes'),
      },
    },
    plugins: [svelte({ preprocess: vitePreprocess() }), cnamePlugin({ domain })],
  };
});

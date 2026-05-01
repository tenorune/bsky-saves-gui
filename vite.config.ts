import { defineConfig, loadEnv } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath, URL } from 'node:url';
import { cnamePlugin } from './tools/vite-plugin-cname';

export default defineConfig(({ mode }) => {
  const projectRoot = fileURLToPath(new URL('.', import.meta.url));
  const env = loadEnv(mode, projectRoot, 'VITE_');
  const domain = env.VITE_APP_DOMAIN ?? '';

  return {
    root: 'app',
    envDir: projectRoot,
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
    plugins: [svelte({ preprocess: vitePreprocess() }), cnamePlugin({ domain })],
  };
});

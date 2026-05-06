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
    define: {
      __BUILD_TIME__: JSON.stringify(
        new Intl.DateTimeFormat('sv-SE', {
          timeZone: 'Europe/Berlin',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit',
          timeZoneName: 'short',
        }).format(new Date()),
      ),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        input: {
          main: resolve(projectRoot, 'index.html'),
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

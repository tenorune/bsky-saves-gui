import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [resolve(here, 'src/worker-with-articles.ts')],
  outfile: resolve(here, 'dist/worker-with-articles.bundle.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  conditions: ['worker', 'browser'],
  minify: true,
  legalComments: 'none',
  banner: {
    js: '// bsky-saves-gui cf-worker — image proxy + article extraction.\n// Built artifact. Source: templates/cf-worker/src/worker-with-articles.ts\n// Rebuild: cd templates/cf-worker && pnpm install && pnpm build',
  },
});

console.log('built dist/worker-with-articles.bundle.js');

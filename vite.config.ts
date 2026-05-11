import { defineConfig, loadEnv } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { cnamePlugin } from './tools/vite-plugin-cname';

function detectBuildBranch(): string {
  // GitHub Actions sets GITHUB_REF_NAME to the branch/tag name on push and
  // workflow_dispatch runs. Prefer it because actions/checkout often leaves
  // the worktree on a detached HEAD where `git rev-parse --abbrev-ref HEAD`
  // just returns "HEAD".
  const ci = process.env.GITHUB_REF_NAME;
  if (ci) return ci;
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (branch && branch !== 'HEAD') return branch;
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (sha) return sha;
  } catch {
    // git not available (e.g. tarball build) — fall through
  }
  return 'unknown';
}

export default defineConfig(({ mode }) => {
  const projectRoot = fileURLToPath(new URL('.', import.meta.url));
  // Include the PREVIEW_ prefix so PREVIEW_ALLOWED_HOSTS is picked up
  // from `.env` files in addition to the VITE_ vars exposed to the app.
  const env = loadEnv(mode, projectRoot, ['VITE_', 'PREVIEW_']);
  const domain = env.VITE_APP_DOMAIN ?? '';

  // Comma-separated host allowlist for `pnpm preview` and `pnpm dev`.
  // A leading dot allows any subdomain of that host. Localhost variants
  // are always allowed regardless of this setting. Default covers
  // `cloudflared tunnel --url http://localhost:4173`, the documented
  // way to test a build from a phone or other off-LAN device.
  const allowedHosts = (env.PREVIEW_ALLOWED_HOSTS ?? '.trycloudflare.com')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

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
      __BUILD_BRANCH__: JSON.stringify(detectBuildBranch()),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: {
          main: resolve(projectRoot, 'index.html'),
        },
      },
    },
    server: { allowedHosts },
    preview: { allowedHosts },
    resolve: {
      alias: {
        $lib: resolve(projectRoot, 'app/src/lib'),
        $routes: resolve(projectRoot, 'app/src/routes'),
      },
    },
    plugins: [svelte({ preprocess: vitePreprocess() }), cnamePlugin({ domain })],
  };
});

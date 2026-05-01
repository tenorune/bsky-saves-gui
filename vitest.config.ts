import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfigFactory from './vite.config';

const viteConfig = viteConfigFactory({ mode: 'test', command: 'build', isSsrBuild: false });

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['app/src/**/*.test.ts'],
      setupFiles: ['app/src/exporters/blob-polyfill.ts'],
    },
  }),
);

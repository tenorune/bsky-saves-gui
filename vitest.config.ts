import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfigFactory from './vite.config';

const viteConfig = viteConfigFactory({ mode: 'test', command: 'build', isSsrBuild: false });

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['src/**/*.test.ts'],
      setupFiles: ['src/exporters/blob-polyfill.ts'],
    },
  }),
);

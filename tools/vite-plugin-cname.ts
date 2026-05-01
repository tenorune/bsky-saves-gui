import type { Plugin } from 'vite';

export interface CnamePluginOptions {
  readonly domain: string;
}

export function cnamePlugin(options: CnamePluginOptions): Plugin {
  return {
    name: 'cname',
    apply: 'build',
    generateBundle() {
      if (!options.domain || options.domain.length === 0) {
        this.warn('VITE_APP_DOMAIN is empty; skipping CNAME emission');
        return;
      }
      this.emitFile({
        type: 'asset',
        fileName: 'CNAME',
        source: `${options.domain}\n`,
      });
    },
  };
}

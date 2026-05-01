/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME: string;
  readonly VITE_APP_DOMAIN: string;
  readonly VITE_OPERATOR_HANDLE: string;
  readonly VITE_BEACON_AT_URI: string;
  readonly VITE_DEFAULT_PDS: string;
  readonly VITE_HELPER_ORIGIN: string;
  readonly VITE_REPO_URL: string;
  readonly VITE_PYODIDE_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.md?raw' {
  const content: string;
  export default content;
}

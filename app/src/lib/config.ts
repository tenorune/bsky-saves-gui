function required(key: keyof ImportMetaEnv): string {
  const value = import.meta.env[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function optional(key: keyof ImportMetaEnv): string | null {
  const value = import.meta.env[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export interface Config {
  readonly appName: string;
  readonly appDomain: string;
  readonly operatorHandle: string;
  readonly beaconAtUri: string | null;
  readonly defaultPds: string;
  readonly helperOrigin: string;
  readonly repoUrl: string;
  readonly pyodideVersion: string;
}

export const config: Config = Object.freeze({
  appName: required('VITE_APP_NAME'),
  appDomain: required('VITE_APP_DOMAIN'),
  operatorHandle: required('VITE_OPERATOR_HANDLE'),
  beaconAtUri: optional('VITE_BEACON_AT_URI'),
  defaultPds: required('VITE_DEFAULT_PDS'),
  helperOrigin: required('VITE_HELPER_ORIGIN'),
  repoUrl: required('VITE_REPO_URL'),
  pyodideVersion: required('VITE_PYODIDE_VERSION'),
});

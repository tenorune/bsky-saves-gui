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

function optionalString(key: keyof ImportMetaEnv): string {
  const value = import.meta.env[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Optional env var that, when set, must be an absolute http(s) URL. Returns
 * '' when unset/empty, so callers can use empty-string as the "feature
 * disabled" sentinel. Throws at module load on a non-empty but malformed
 * value — better to fail the deploy loudly than to silently produce a
 * relative URL that browser fetch() resolves against the page origin (real
 * incident: a bare hostname produced
 * https://<page-origin>/<bare-hostname>/fetch and probes still passed).
 */
function optionalAbsoluteHttpUrl(key: keyof ImportMetaEnv): string {
  const raw = import.meta.env[key];
  if (typeof raw !== 'string' || raw.length === 0) return '';
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Env var ${key} must be an absolute URL (e.g. https://...); got ${JSON.stringify(raw)}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Env var ${key} must use http(s); got ${parsed.protocol}`);
  }
  return raw;
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
  readonly operatorImageProxyUrl: string;
  // Public — inlined into the bundle by Vite, exposed to anyone who
  // downloads the deployed JS. Not a confidential secret; the real
  // worker-side protection is the URL allowlist + rate limiting.
  // See templates/cf-worker/README.md and .env.example.
  readonly operatorImageProxyKey: string;
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
  operatorImageProxyUrl: optionalAbsoluteHttpUrl('VITE_OPERATOR_IMAGE_PROXY_URL'),
  operatorImageProxyKey: optionalString('VITE_OPERATOR_IMAGE_PROXY_KEY'),
});

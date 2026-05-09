// Probe for the operator's image-proxy worker, used by Settings → Backup.
//
// The previous probe just sent an OPTIONS preflight and treated any 204 as
// "reachable." That falsely passed when VITE_OPERATOR_IMAGE_PROXY_URL was
// scheme-less and fetch() resolved it as a relative URL against the page
// origin: the page origin's generic OPTIONS handler returned 204 and the
// worker was never contacted. We now reuse probeWorkerCapabilities (the
// same authenticated GET /capabilities the setup modal uses), which can
// only succeed if the request actually reached our worker.

import { probeWorkerCapabilities, type ProbeResult } from './user-worker-client';

export type OperatorProxyStatus =
  | 'unknown'
  | 'ok'
  | 'origin-blocked'
  | 'unauthorized'
  | 'unreachable';

export function classifyOperatorProxyProbe(result: ProbeResult): OperatorProxyStatus {
  switch (result.kind) {
    case 'has-articles':
    case 'image-only':
    case 'no-capabilities-endpoint':
      return 'ok';
    case 'origin-blocked':
      return 'origin-blocked';
    case 'unauthorized':
      return 'unauthorized';
    case 'unreachable':
      return 'unreachable';
  }
}

export async function probeOperatorProxy(
  url: string,
  sharedSecret: string,
): Promise<OperatorProxyStatus> {
  if (url === '') return 'unknown';
  const result = await probeWorkerCapabilities(url, sharedSecret);
  return classifyOperatorProxyProbe(result);
}

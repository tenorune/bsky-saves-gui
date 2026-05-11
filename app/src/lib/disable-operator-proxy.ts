// Shared action: opt the user out of the operator's image proxy and
// recompute the capability snapshot so callers (Library Hub, Settings)
// see the updated routing immediately. Used by the "Don't use" link
// next to operator-proxy backend labels and by the matching checkbox in
// Settings > Advanced backup options.

import { setOperatorProxyOptOut } from './operator-proxy-opt-out';
import { initCapabilitySnapshot } from './capability-snapshot';

export async function disableOperatorProxy(): Promise<void> {
  await setOperatorProxyOptOut(true);
  await initCapabilitySnapshot();
}

// Push library status to the local helper for the installer panel.
// See docs/superpowers/specs/2026-05-21-status-snapshot-push-design.md
// and bsky-saves-coordination:docs/installer-status-panel.md (canonical
// contract).

import type { LastSession } from './last-session';
import type { PairingState } from './pairing-token';

export interface ActivationInputs {
  readonly helperDetected: boolean;
  readonly pairingState: PairingState;
  readonly helperOptOut: boolean;
  readonly lastSession: LastSession | null;
}

/**
 * Pusher activation gate. All four conditions must hold for pushes
 * to fire. A `stale` pairing state is intentionally not active —
 * pushing would 401 repeatedly until the user re-pairs.
 */
export function isActive(inputs: ActivationInputs): boolean {
  return (
    inputs.helperDetected &&
    inputs.pairingState === 'paired' &&
    !inputs.helperOptOut &&
    inputs.lastSession !== null
  );
}

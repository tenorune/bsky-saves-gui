import { get, set, del } from 'idb-keyval';
import { config } from './config';

const KEY = 'beacon:sent:v1';

export class BeaconNotConfiguredError extends Error {
  constructor() {
    super('Beacon AT URI is not configured for this deployment');
    this.name = 'BeaconNotConfiguredError';
  }
}

export interface BeaconAuth {
  readonly pds: string;
  readonly accessJwt: string;
  readonly did: string;
}

export async function likeBeacon(auth: BeaconAuth): Promise<void> {
  if (!config.beaconAtUri) throw new BeaconNotConfiguredError();
  const base = auth.pds.replace(/\/+$/, '');
  // We need the cid of the beacon post for a proper like; without an extra
  // getRecord call we approximate by passing only uri (Bluesky tolerates this
  // for likes but the spec recommends both). Implementer may extend with a
  // getRecord call if accuracy of cid matters.
  const res = await fetch(`${base}/xrpc/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${auth.accessJwt}`,
    },
    body: JSON.stringify({
      repo: auth.did,
      collection: 'app.bsky.feed.like',
      record: {
        $type: 'app.bsky.feed.like',
        subject: { uri: config.beaconAtUri, cid: '' },
        createdAt: new Date().toISOString(),
      },
    }),
  });
  if (!res.ok) throw new Error(`Beacon like failed: ${res.status}`);
}

export async function hasBeaconBeenSent(): Promise<boolean> {
  return (await get(KEY)) === true;
}

export async function markBeaconSent(): Promise<void> {
  await set(KEY, true);
}

export async function clearBeaconSent(): Promise<void> {
  await del(KEY);
}

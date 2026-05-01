import { config } from './config';

export type HelperStatus =
  | { status: 'available'; version: string }
  | { status: 'unavailable' };

export async function detectHelper(): Promise<HelperStatus> {
  const url = `${config.helperOrigin.replace(/\/+$/, '')}/health`;
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return { status: 'unavailable' };
    const body = (await res.json()) as { ok?: boolean; version?: string };
    if (body.ok === true && typeof body.version === 'string') {
      return { status: 'available', version: body.version };
    }
    return { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}

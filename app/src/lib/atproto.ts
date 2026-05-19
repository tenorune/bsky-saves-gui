export interface CreateSessionInput {
  readonly pds: string;
  readonly identifier: string;
  readonly password: string;
  /**
   * Per-request timeout in milliseconds. The fetch is aborted via an
   * AbortController if no response (any status) arrives within this
   * window; the caller gets a {@link NetworkError}. Defaults to 30s —
   * long enough that a slow-but-working PDS still succeeds, short
   * enough that the user gets actionable feedback when the upstream
   * (or its CDN) is wedged. See bsky.social PDS incidents where the
   * `createSession` endpoint sits in front of a Cloudflare edge that
   * 504s after ~minutes — without a timeout the user sees a hung
   * submit button forever.
   */
  readonly timeoutMs?: number;
}

export interface AtSession {
  readonly accessJwt: string;
  readonly refreshJwt: string;
  readonly handle: string;
  readonly did: string;
}

export class InvalidCredentialsError extends Error {
  constructor(message = 'Invalid handle or app password') {
    super(message);
    this.name = 'InvalidCredentialsError';
  }
}

export class PdsError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'PdsError';
  }
}

/**
 * Raised when the fetch itself never produced a response — TCP/TLS
 * failure, DNS failure, abort/timeout, offline browser. Distinct from
 * {@link PdsError} (server responded, with a non-2xx status) and from
 * {@link InvalidCredentialsError} (server responded 401). Callers
 * route this to "couldn't reach Bluesky" / "took too long" UX rather
 * than "wrong password".
 */
export class NetworkError extends Error {
  constructor(message = "Couldn't reach Bluesky") {
    super(message);
    this.name = 'NetworkError';
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function createSession(input: CreateSessionInput): Promise<AtSession> {
  const base = input.pds.replace(/\/+$/, '');
  const url = `${base}/xrpc/com.atproto.server.createSession`;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Build the abort signal locally rather than using AbortSignal.timeout
  // so the test suite can attach an event listener to a real controller
  // (AbortSignal.timeout returns a special signal that some test envs
  // handle inconsistently). Same observable behavior either way: the
  // signal fires after `timeoutMs` and the fetch rejects with AbortError.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: input.identifier, password: input.password }),
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new NetworkError('Bluesky took too long to respond. Try again in a moment.');
    }
    // TypeError from fetch === network failure (DNS, TCP, TLS, offline).
    if (e instanceof TypeError) {
      throw new NetworkError("Couldn't reach Bluesky. Check your connection and try again.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) throw new InvalidCredentialsError();
  if (!res.ok) throw new PdsError(res.status, `PDS returned ${res.status}`);

  const body = (await res.json()) as AtSession;
  return {
    accessJwt: body.accessJwt,
    refreshJwt: body.refreshJwt,
    handle: body.handle,
    did: body.did,
  };
}

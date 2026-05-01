export interface CreateSessionInput {
  readonly pds: string;
  readonly identifier: string;
  readonly password: string;
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

export async function createSession(input: CreateSessionInput): Promise<AtSession> {
  const base = input.pds.replace(/\/+$/, '');
  const url = `${base}/xrpc/com.atproto.server.createSession`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: input.identifier, password: input.password }),
  });

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

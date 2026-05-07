export interface PreauthSession {
  readonly accessJwt: string;
  readonly refreshJwt: string;
  readonly did: string;
  readonly handle: string;
}

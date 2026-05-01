export interface Author {
  readonly did?: string;
  readonly handle: string;
  readonly displayName?: string;
  readonly avatar?: string;
}

export interface PostRecord {
  readonly text: string;
  readonly createdAt: string;
  readonly langs?: readonly string[];
  // Other fields (facets, embed) preserved as unknown extras.
  readonly [extra: string]: unknown;
}

export interface ArticleHydration {
  readonly url: string;
  readonly title?: string;
  readonly text: string;
}

export interface ThreadEntry {
  readonly uri: string;
  readonly cid?: string;
  readonly author: Author;
  readonly record: PostRecord;
  readonly [extra: string]: unknown;
}

export interface LocalImage {
  readonly cid: string;
  readonly path: string;
}

export interface Save {
  readonly uri: string;
  readonly cid?: string;
  readonly author: Author;
  readonly record: PostRecord;
  readonly indexedAt?: string;
  readonly embed?: unknown;
  readonly enriched_created_at?: string;
  readonly article?: ArticleHydration;
  readonly thread?: readonly ThreadEntry[];
  readonly local_images?: readonly LocalImage[];
  readonly [extra: string]: unknown;
}

export interface Inventory {
  readonly saves: readonly Save[];
  readonly [extra: string]: unknown;
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(obj: Record<string, unknown>, key: string, ctx: string): string {
  const v = obj[key];
  if (typeof v !== 'string') {
    throw new ParseError(`${ctx}.${key} is not a string`);
  }
  return v;
}

function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

function parseAuthor(v: unknown): Author {
  if (!isObject(v)) {
    return { handle: 'unknown' };
  }
  return {
    handle: typeof v.handle === 'string' ? v.handle : 'unknown',
    did: optionalString(v, 'did'),
    displayName: optionalString(v, 'displayName'),
    avatar: optionalString(v, 'avatar'),
  };
}

function parseRecord(v: unknown): PostRecord {
  if (!isObject(v)) {
    return { text: '', createdAt: '' };
  }
  return {
    ...v,
    text: typeof v.text === 'string' ? v.text : '',
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
    langs: Array.isArray(v.langs)
      ? (v.langs.filter((x) => typeof x === 'string') as string[])
      : undefined,
  };
}

function parseSave(v: unknown): Save {
  if (!isObject(v)) throw new ParseError('save is not an object');
  return {
    ...v,
    uri: requireString(v, 'uri', 'save'),
    cid: optionalString(v, 'cid'),
    indexedAt: optionalString(v, 'indexedAt'),
    author: parseAuthor(v.author),
    record: parseRecord(v.record),
  };
}

export function parseInventory(input: unknown): Inventory {
  if (!isObject(input)) throw new ParseError('inventory root is not an object');
  if (!Array.isArray(input.saves)) throw new ParseError('inventory.saves is not an array');
  return {
    ...input,
    saves: input.saves.map(parseSave),
  };
}

const RKEY_RE = /\/([^/]+)$/;

export function rkeyOf(uri: string): string {
  const m = RKEY_RE.exec(uri);
  if (!m) throw new ParseError(`uri has no rkey segment: ${uri}`);
  return m[1];
}

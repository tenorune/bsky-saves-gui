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
  readonly path: string;
  readonly cid?: string;
  readonly url?: string;
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
    // Accept both camelCase (PostView) and snake_case (bsky-saves) shapes.
    displayName: optionalString(v, 'displayName') ?? optionalString(v, 'display_name'),
    avatar: optionalString(v, 'avatar'),
  };
}

function parseSave(v: unknown): Save {
  if (!isObject(v)) throw new ParseError('save is not an object');

  // bsky-saves stores save records flat with snake_case keys (post_text,
  // post_created_at, saved_at, author.display_name). Earlier code assumed the
  // nested PostView shape (record: { text, createdAt }, indexedAt, ...).
  // Normalize both into the internal { record, indexedAt } interface while
  // preserving the original keys via the spread so JSON export round-trips.
  const recordObj = isObject(v.record) ? v.record : null;
  const text =
    typeof v.post_text === 'string'
      ? v.post_text
      : recordObj && typeof recordObj.text === 'string'
        ? recordObj.text
        : '';
  const createdAt =
    typeof v.post_created_at === 'string'
      ? v.post_created_at
      : recordObj && typeof recordObj.createdAt === 'string'
        ? recordObj.createdAt
        : '';
  const indexedAt =
    optionalString(v, 'saved_at') ?? optionalString(v, 'indexedAt');

  const langsRaw = recordObj && Array.isArray(recordObj.langs) ? recordObj.langs : null;
  const langs = langsRaw
    ? (langsRaw.filter((x) => typeof x === 'string') as string[])
    : undefined;

  const record: PostRecord = {
    ...(recordObj ?? {}),
    text,
    createdAt,
    ...(langs ? { langs } : {}),
  };

  // Synthesize embed.images from bsky-saves' top-level `images` array so
  // PostBody/PostFocus/Markdown exporter (which look for embed.images with
  // {fullsize, thumb}) keep rendering. Original `images` and `embed` are
  // preserved via the spread.
  const rawImages = Array.isArray((v as { images?: unknown }).images)
    ? ((v as { images: unknown[] }).images as Record<string, unknown>[])
    : [];
  const synthesizedEmbedImages = rawImages
    .map((img) => {
      const url = typeof img.url === 'string' ? img.url : null;
      if (!url) return null;
      const alt = typeof img.alt === 'string' ? img.alt : '';
      return { fullsize: url, thumb: url, alt };
    })
    .filter((x): x is { fullsize: string; thumb: string; alt: string } => x !== null);
  const originalEmbed = isObject(v.embed) ? v.embed : null;
  const embed =
    synthesizedEmbedImages.length > 0
      ? { ...(originalEmbed ?? {}), images: synthesizedEmbedImages }
      : (originalEmbed ?? undefined);

  // Synthesize `article` from bsky-saves' hydrate-articles output fields.
  let article: ArticleHydration | undefined;
  if (typeof v.article_text === 'string') {
    const url = originalEmbed && typeof originalEmbed.url === 'string' ? originalEmbed.url : '';
    const title =
      originalEmbed && typeof originalEmbed.title === 'string' ? originalEmbed.title : undefined;
    article = { url, text: v.article_text, ...(title ? { title } : {}) };
  } else if (isObject(v.article)) {
    article = v.article as unknown as ArticleHydration;
  }

  // Synthesize `thread` from bsky-saves' hydrate-threads output. bsky-saves'
  // thread_replies entries are flat ({uri, text, indexedAt, images}). The
  // hydrator only collects SAME-AUTHOR replies (self-thread), so each entry's
  // author is the parent save's author — synthesize from there.
  const replies = Array.isArray((v as { thread_replies?: unknown }).thread_replies)
    ? ((v as { thread_replies: unknown[] }).thread_replies as Record<string, unknown>[])
    : [];
  const parentAuthor = parseAuthor(v.author);
  const thread: ThreadEntry[] | undefined =
    replies.length > 0
      ? replies.map((r) => ({
          uri: typeof r.uri === 'string' ? r.uri : '',
          author: parentAuthor,
          record: {
            text: typeof r.text === 'string' ? r.text : '',
            createdAt:
              typeof r.created_at === 'string'
                ? r.created_at
                : typeof r.indexedAt === 'string'
                  ? r.indexedAt
                  : '',
          },
        }))
      : Array.isArray(v.thread)
        ? (v.thread as ThreadEntry[])
        : undefined;

  // local_images: bsky-saves uses {url, path}; the legacy assumption was
  // {cid, path}. Pass through with both shapes accepted.
  const localImagesRaw = Array.isArray((v as { local_images?: unknown }).local_images)
    ? ((v as { local_images: unknown[] }).local_images as Record<string, unknown>[])
    : [];
  const localImages: LocalImage[] = [];
  for (const img of localImagesRaw) {
    if (typeof img.path !== 'string') continue;
    const entry: LocalImage = { path: img.path };
    if (typeof img.cid === 'string') (entry as { cid: string }).cid = img.cid;
    if (typeof img.url === 'string') (entry as { url: string }).url = img.url;
    localImages.push(entry);
  }

  return {
    ...v,
    uri: requireString(v, 'uri', 'save'),
    cid: optionalString(v, 'cid'),
    indexedAt,
    author: parseAuthor(v.author),
    record,
    embed,
    ...(article ? { article } : {}),
    ...(thread ? { thread } : {}),
    ...(localImages.length > 0 ? { local_images: localImages } : {}),
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

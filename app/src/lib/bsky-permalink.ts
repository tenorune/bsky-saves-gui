/**
 * Build the canonical bsky.app permalink for a saved post.
 *
 * The save's `uri` is an at-URI like
 * `at://did:plc:abc/app.bsky.feed.post/3kx9abc`. We extract the trailing
 * record-key segment and combine it with the author handle to produce
 * `https://bsky.app/profile/{handle}/post/{rkey}`.
 */
export function bskyPostUrl(save: {
  author: { handle: string };
  uri: string;
}): string {
  const m = /\/([^/]+)$/.exec(save.uri);
  const rkey = m?.[1] ?? '';
  return `https://bsky.app/profile/${encodeURIComponent(save.author.handle)}/post/${encodeURIComponent(rkey)}`;
}

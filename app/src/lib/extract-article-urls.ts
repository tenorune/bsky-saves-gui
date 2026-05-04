// Walks an inventory and returns the distinct list of https?:// article URLs
// referenced from each save's `embed.url`. Pure function.
//
// Skips saves whose `article_text` is already populated — those have been
// hydrated and don't need re-fetching.
//
// Quoted-post articles are NOT walked here; they're rare and easy to add in
// a follow-up plan.

const HTTP_RE = /^https?:\/\//;

export function extractArticleUrls(inventory: unknown): string[] {
  if (!inventory || typeof inventory !== 'object') return [];
  const inv = inventory as { saves?: unknown };
  if (!Array.isArray(inv.saves)) return [];
  const out = new Set<string>();
  for (const save of inv.saves) {
    if (!save || typeof save !== 'object') continue;
    const s = save as Record<string, unknown>;
    if (typeof s.article_text === 'string') continue; // already hydrated
    const embed = s.embed;
    if (!embed || typeof embed !== 'object') continue;
    const url = (embed as Record<string, unknown>).url;
    if (typeof url === 'string' && HTTP_RE.test(url)) out.add(url);
  }
  return [...out];
}

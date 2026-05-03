import type { Inventory, Save } from '../reader/inventory-shape';
import { sortByCreatedDesc } from '../reader/feed-filter';

export interface HydratedFlags {
  readonly enrich: boolean;
  readonly threads: boolean;
  readonly articles: boolean;
  readonly images: boolean;
}

export interface MarkdownExportOptions {
  readonly account: string;
  readonly hydratedFlags: HydratedFlags;
}

export interface ExportResult {
  readonly blob: Blob;
  readonly filename: string;
}

function bskyUrl(save: Save): string {
  const m = /\/([^/]+)$/.exec(save.uri);
  const rkey = m?.[1] ?? '';
  return `https://bsky.app/profile/${encodeURIComponent(save.author.handle)}/post/${encodeURIComponent(rkey)}`;
}

function imageUrls(save: Save): string[] {
  const e = save.embed as { images?: { fullsize?: string; thumb?: string }[] } | undefined;
  if (!Array.isArray(e?.images)) return [];
  return e!.images
    .map((img) => img.fullsize ?? img.thumb)
    .filter((u): u is string => typeof u === 'string');
}

function renderSave(save: Save): string {
  const date = save.record.createdAt.slice(0, 10);
  const lines: string[] = [`## ${date} · @${save.author.handle}`, ''];
  if (save.author.displayName) lines.push(`*${save.author.displayName}*`, '');
  lines.push(save.record.text, '');
  lines.push(`[Original post](${bskyUrl(save)})`, '');
  for (const url of imageUrls(save)) {
    lines.push(`![](${url})`);
  }
  if (save.article) {
    lines.push('', `### Linked article${save.article.title ? `: ${save.article.title}` : ''}`, '');
    lines.push(save.article.text);
  }
  if (save.thread && save.thread.length > 0) {
    lines.push('', '### Thread', '');
    for (const entry of save.thread) {
      if (entry.record.text) {
        lines.push(`> @${entry.author.handle}: ${entry.record.text}`);
      }
      if (entry.images) {
        for (const img of entry.images) {
          lines.push(`> ![${img.alt ?? ''}](${img.url})`);
        }
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}

function formatExportTime(date: Date): string {
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function hydratedSummary(flags: HydratedFlags): string {
  const on = (Object.keys(flags) as (keyof HydratedFlags)[]).filter((k) => flags[k]);
  return on.length > 0 ? on.join(', ') : 'none';
}

export async function exportMarkdown(
  inventory: Inventory,
  options: MarkdownExportOptions,
): Promise<ExportResult> {
  const sorted = sortByCreatedDesc(inventory.saves);
  // Plain Markdown bullet list — renders as normal-sized lines in any viewer
  // and avoids YAML-frontmatter quirks (some renderers style `---` blocks as
  // headlines rather than metadata).
  const header = [
    `- **Exported:** ${formatExportTime(new Date())}`,
    `- **Account:** @${options.account}`,
    `- **Count:** ${sorted.length}`,
    `- **Hydrated:** ${hydratedSummary(options.hydratedFlags)}`,
    '',
  ].join('\n');

  const body = sorted.map(renderSave).join('\n');
  const text = header + body;

  return {
    blob: new Blob([text], { type: 'text/markdown' }),
    filename: 'saves.md',
  };
}

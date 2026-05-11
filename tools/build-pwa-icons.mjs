// One-off rasterizer: SVG → PNG at the sizes Safari/Android want.
// Run: node tools/build-pwa-icons.mjs
//
// Re-run whenever app/public/icons/icon{,-maskable}.svg changes.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const here = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(here, '../app/public/icons');

const targets = [
  { src: 'icon.svg',          out: 'icon-192.png',           size: 192 },
  { src: 'icon.svg',          out: 'icon-512.png',           size: 512 },
  { src: 'icon-maskable.svg', out: 'icon-512-maskable.png',  size: 512 },
];

for (const { src, out, size } of targets) {
  const svg = readFileSync(resolve(iconsDir, src));
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(resolve(iconsDir, out), png);
  console.log(`wrote ${out} (${png.length} bytes)`);
}

// One-off rasterizer: SVG → PNG at the sizes Safari/Android want, plus
// the multi-size favicon.ico.
// Run: node tools/build-pwa-icons.mjs
//
// Re-run whenever app/public/icons/icon{,-maskable}.svg or
// app/public/favicon.svg changes.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '../app/public');
const iconsDir = resolve(publicDir, 'icons');

// ── PWA icons (PNG) ──────────────────────────────────────────────────
const targets = [
  { src: 'icon.svg',          out: 'icon-192.png',           size: 192 },
  { src: 'icon.svg',          out: 'icon-512.png',           size: 512 },
  { src: 'icon-maskable.svg', out: 'icon-512-maskable.png',  size: 512 },
];

for (const { src, out, size } of targets) {
  const svg = readFileSync(resolve(iconsDir, src));
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(resolve(iconsDir, out), png);
  console.log(`wrote icons/${out} (${png.length} bytes)`);
}

// ── favicon.ico ──────────────────────────────────────────────────────
// Rasterize favicon.svg at the classic favicon sizes and pack them into
// a single .ico. The PNG-encoded ICO variant is used (every entry is a
// full PNG, not a BMP) — universally supported by modern browsers and
// what the previous favicon.ico already shipped.
const FAVICON_SIZES = [16, 32, 48, 64];

function rasterize(svg, size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

function packIco(images) {
  // images: [{ size, data: Buffer }]
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    // A dimension of 256 is encoded as 0; our sizes are all < 256.
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2);                      // palette colour count
    entry.writeUInt8(0, 3);                      // reserved
    entry.writeUInt16LE(1, 4);                   // colour planes
    entry.writeUInt16LE(32, 6);                  // bits per pixel
    entry.writeUInt32LE(data.length, 8);         // image data size
    entry.writeUInt32LE(offset, 12);             // image data offset
    entries.push(entry);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const faviconSvg = readFileSync(resolve(publicDir, 'favicon.svg'));
const faviconImages = FAVICON_SIZES.map((size) => ({ size, data: rasterize(faviconSvg, size) }));
const ico = packIco(faviconImages);
writeFileSync(resolve(publicDir, 'favicon.ico'), ico);
console.log(`wrote favicon.ico (${ico.length} bytes; sizes ${FAVICON_SIZES.join('/')})`);

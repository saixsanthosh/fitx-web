// Regenerates every FITX logo file from the mark's exact geometry (src/components/brand/logo/geometry.ts):
// the SVG marks, app icons and PNGs in public/brand, src/app/icon.svg, src/app/favicon.ico and the Admin app's
// icon. Run from the repository root: node scripts/brand/generate-brand-assets.mjs (sharp comes with Next).
// tests/brand/brand-assets.test.ts checks the committed files still match the geometry.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { FITX_MARK_BOUNDS, FITX_MARK_D } from "../../src/components/brand/logo/geometry.ts";
import { BRAND_INK, BRAND_PAPER, BRAND_TILE, BRAND_EMBER, iconSvg, markSvg } from "./brand-svg.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const brandDir = path.join(root, "public", "brand");
await mkdir(brandDir, { recursive: true });

const files = {
  // The mark alone on a transparent ground, in ink and in white.
  "public/brand/fitx-mark-black.svg": markSvg(BRAND_INK),
  "public/brand/fitx-mark-white.svg": markSvg(BRAND_PAPER),
  // The app icon: the light mark on the dark tile, as in the original artwork (white on black).
  "public/brand/fitx-app-icon.svg": iconSvg({ fill: 0.68, radius: 0.22 }),
  "public/brand/fitx-app-icon-maskable.svg": iconSvg({ fill: 0.54, radius: 0 }),
  "public/brand/fitx-apple-touch-icon.svg": iconSvg({ fill: 0.64, radius: 0 }),
  // Favicons fill more of the tile: at 16 to 48 px every pixel of the mark counts.
  "src/app/icon.svg": iconSvg({ fill: 0.8, radius: 0.2 }),
  // Admin: the same tile with an ember dot, so its tab is told apart from the member app's.
  "admin/src/app/icon.svg": iconSvg({ fill: 0.8, radius: 0.2, dot: BRAND_EMBER }),
};
for (const [file, svg] of Object.entries(files)) await writeFile(path.join(root, file), svg);

const render = (svg, size) => sharp(Buffer.from(svg)).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toBuffer();
for (const [filename, svg, size] of [
  ["fitx-mark-black.png", files["public/brand/fitx-mark-black.svg"], 1024],
  ["fitx-mark-white.png", files["public/brand/fitx-mark-white.svg"], 1024],
  ["fitx-app-icon.png", files["public/brand/fitx-app-icon.svg"], 512],
  ["fitx-app-icon-192.png", files["public/brand/fitx-app-icon.svg"], 192],
  ["fitx-app-icon-maskable.png", files["public/brand/fitx-app-icon-maskable.svg"], 512],
  ["fitx-apple-touch-icon.png", files["public/brand/fitx-apple-touch-icon.svg"], 180],
  ["fitx-favicon-32.png", files["src/app/icon.svg"], 32],
]) {
  await writeFile(path.join(brandDir, filename), await render(svg, size));
}

const icoSizes = [16, 32, 48];
const icoImages = await Promise.all(icoSizes.map((size) => render(files["src/app/icon.svg"], size)));
const header = Buffer.alloc(6 + icoImages.length * 16);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoImages.length, 4);
let offset = header.length;
icoImages.forEach((png, index) => {
  const entry = 6 + index * 16;
  const size = icoSizes[index];
  header[entry] = size;
  header[entry + 1] = size;
  header[entry + 2] = 0;
  header[entry + 3] = 0;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
await writeFile(path.join(root, "src", "app", "favicon.ico"), Buffer.concat([header, ...icoImages]));
console.log(`Generated the FITX logo files from the mark's geometry (${FITX_MARK_D.length} path characters, bounds ${FITX_MARK_BOUNDS.width} x ${FITX_MARK_BOUNDS.height}; tile ${BRAND_TILE}).`);

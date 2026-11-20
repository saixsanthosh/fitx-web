// Regenerates the FITX logo PNGs in public/brand and src/app/favicon.ico from the SVG marks there.
// Run from the repository root: node scripts/brand/generate-brand-assets.mjs (sharp comes with Next).

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const brandDir = path.join(root, "public", "brand");
const markPath = path.join(brandDir, "fitx-mark-black.svg");
const appIconPath = path.join(brandDir, "fitx-app-icon.svg");
await mkdir(brandDir, { recursive: true });

const appIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#F7F7F4"/><path d="M10 13H54M32 13V54M10 29H32M32 31L53 52M32 52L53 31" fill="none" stroke="#191C19" stroke-width="5.5" stroke-linecap="square" stroke-linejoin="miter"/></svg>`;
await writeFile(appIconPath, appIconSvg);

for (const [filename, size] of [
  ["fitx-mark-black.png", 1024],
  ["fitx-mark-white.png", 1024],
  ["fitx-app-icon.png", 512],
  ["fitx-apple-touch-icon.png", 180],
  ["fitx-favicon-32.png", 32],
]) {
  const input = filename === "fitx-mark-white.png"
    ? path.join(brandDir, "fitx-mark-white.svg")
    : filename === "fitx-app-icon.png" || filename === "fitx-apple-touch-icon.png" || filename === "fitx-favicon-32.png"
      ? appIconPath
      : markPath;
  const png = await sharp(input).resize(size, size, { fit: "contain" }).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(path.join(brandDir, filename), png);
}

const icoImages = await Promise.all([16, 32, 48].map((size) =>
  sharp(appIconPath).resize(size, size).png().toBuffer(),
));
const header = Buffer.alloc(6 + icoImages.length * 16);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoImages.length, 4);
let offset = header.length;
icoImages.forEach((png, index) => {
  const entry = 6 + index * 16;
  const size = [16, 32, 48][index];
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
console.log("Generated FITX logo PNGs and favicon.");

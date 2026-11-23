// Renders the mark's geometry (src/components/brand/logo/geometry.ts) back at the size of the owner's artwork and
// compares it with the artwork, pixel by pixel. The artwork is not in the repository; pass its path:
//   node scripts/brand/check-logo-geometry.mjs "<path>/instruction/logo.jpeg" [--out=diff.png]
// It prints the share of the mark's pixels that differ (inside or outside an edge). Exits 1 above 1%.

import sharp from "sharp";
import { FITX_MARK_D, FITX_MARK_ORIGIN } from "../../src/components/brand/logo/geometry.ts";

const [source, ...rest] = process.argv.slice(2);
if (!source) {
  console.error("Usage: node scripts/brand/check-logo-geometry.mjs <logo.jpeg> [--out=diff.png]");
  process.exit(2);
}
const out = rest.find((arg) => arg.startsWith("--out="))?.slice(6);

const artwork = sharp(source).greyscale();
const { width, height } = await artwork.metadata();
const reference = await artwork.raw().toBuffer();
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#000"/><path fill="#fff" transform="translate(${FITX_MARK_ORIGIN.x} ${FITX_MARK_ORIGIN.y})" d="${FITX_MARK_D}"/></svg>`;
const rendered = await sharp(Buffer.from(svg)).greyscale().raw().toBuffer();

let ink = 0;
let differ = 0;
const diff = Buffer.alloc(width * height);
for (let index = 0; index < width * height; index += 1) {
  const a = reference[index] > 128;
  const b = rendered[index] > 128;
  if (a) ink += 1;
  if (a !== b) {
    differ += 1;
    diff[index] = 255;
  }
}
const share = (100 * differ) / ink;
console.log(`${differ} of ${ink} mark pixels differ (${share.toFixed(2)}%).`);
if (out) await sharp(diff, { raw: { width, height, channels: 1 } }).png().toFile(out);
process.exit(share > 1 ? 1 : 0);

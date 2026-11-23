// The FITX logo files' SVG, built from the mark's exact geometry. Used by generate-brand-assets.mjs and by
// tests/brand/brand-assets.test.ts (which checks the committed files are exactly this output).

import { FITX_MARK_BOUNDS, FITX_MARK_D, FITX_MARK_SIZE } from "../../src/components/brand/logo/geometry.ts";

/** Literal colours for files that cannot read CSS variables (they match the theme tokens in globals.css). */
export const BRAND_INK = "#191C19"; // --fitx-text, light theme
export const BRAND_PAPER = "#F3F3EF"; // --fitx-text, dark theme
export const BRAND_TILE = "#151715"; // --fitx-bg, dark theme
export const BRAND_EMBER = "#ED725C"; // --fitx-primary, dark theme

const round = (value) => Math.round(value * 1000) / 1000;

/** The mark alone on a transparent ground, in its own 600-unit square. @param {string} color */
export function markSvg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FITX_MARK_SIZE} ${FITX_MARK_SIZE}"><path fill="${color}" d="${FITX_MARK_D}"/></svg>\n`;
}

/**
 * The mark centred on a square tile of 64 units. `fill` is the share of the tile the mark's wider side takes,
 * `radius` the tile's corner radius as a share of its side (0 for maskable and Apple icons, which the system
 * rounds itself), `dot` an optional ember dot in the lower-left corner (Admin).
 * @param {{ fill: number, radius: number, dot?: string | null, tile?: string, mark?: string }} options
 */
export function iconSvg({ fill, radius, dot = null, tile = BRAND_TILE, mark = BRAND_PAPER }) {
  const side = 64;
  const { x, y, width, height } = FITX_MARK_BOUNDS;
  const scale = (side * fill) / Math.max(width, height);
  const tx = side / 2 - (x + width / 2) * scale;
  const ty = side / 2 - (y + height / 2) * scale;
  const corner = radius ? ` rx="${round(side * radius)}"` : "";
  const extra = dot ? `<circle cx="12.5" cy="51.5" r="4.5" fill="${dot}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}"><rect width="${side}" height="${side}"${corner} fill="${tile}"/><path fill="${mark}" transform="translate(${round(tx)} ${round(ty)}) scale(${round(scale)})" d="${FITX_MARK_D}"/>${extra}</svg>\n`;
}

// Release 3, fix round 3c (explore's open item 4, D4): the post composer's photo tools (Move earlier, Remove, Move later)
// were 32 px, under the 44 px touch target, and three 44 px buttons do not fit side by side on a phone's photo tile
// (about 109 px wide in the 3-column grid at 375 px). Remove now takes the tile's top corner and the two moves the
// bottom ones, and the grid takes only as many columns as leave every tile room for two tools side by side.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");
const css = source("src/components/social/Explore.module.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (selector: string) => {
  const match = new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")} \\{([^}]*)\\}`).exec(css);
  assert.ok(match, `${selector} is in Explore.module.css`);
  return match[1];
};
const px = (text: string, name: string) => {
  const match = new RegExp(`(?:^|[;\\s])${name}: (\\d+)px`).exec(text);
  assert.ok(match, `${name} in "${text.trim()}"`);
  return Number(match[1]);
};

/** The numbers the layout comes from, read from the stylesheet itself. */
function geometry() {
  const picker = rule(".picker");
  const grid = /grid-template-columns: repeat\(auto-fill, minmax\((\d+)px, 1fr\)\)/.exec(picker);
  assert.ok(grid, "the grid takes as many columns as fit");
  const tool = rule(".pickTool");
  const moves = rule(".pickMoves");
  const remove = rule(".pickRemove");
  const inset = /inset: auto (\d+)px (\d+)px;/.exec(moves);
  assert.ok(inset && inset[1] === inset[2], "the moves sit the same distance from both sides and the bottom");
  return {
    minTile: Number(grid[1]), gap: px(picker, "gap"),
    tool: px(tool, "width"), toolHeight: px(tool, "height"),
    inset: Number(inset[1]), between: px(moves, "gap"),
    removeTop: px(remove, "top"), removeRight: px(remove, "right"),
  };
}

/** The tiles of the photo grid in a column `width` px wide (CSS grid auto-fill with minmax(min, 1fr)). */
function tiles(width: number, g = geometry()) {
  const columns = Math.max(1, Math.floor((width + g.gap) / (g.minTile + g.gap)));
  const tile = (width - g.gap * (columns - 1)) / columns;
  return { columns, tile, height: (tile * 5) / 4 };
}

// The composer's column: the page's width less 16 px a side on phones, 24 px from 640 px, at most 640 px (.narrow).
const column = (viewport: number) => Math.min(640, viewport - 2 * (viewport >= 640 ? 24 : 16));

test("each photo tool is a 44 x 44 px target, and a tile always has room for them, from a 320 px phone up", () => {
  const g = geometry();
  assert.equal(g.tool, 44);
  assert.equal(g.toolHeight, 44);
  assert.equal(g.minTile, 2 * g.inset + 2 * g.tool + g.between, "the narrowest tile holds the two moves side by side");
  assert.equal(g.removeTop, g.inset);
  assert.equal(g.removeRight, g.inset);
  // The photo's number sits in the other top corner: "10" at 12 px bold with 8 px either side is under 32 px.
  const badge = 32;
  for (const viewport of [320, 360, 375, 390, 414, 430, 480, 600, 640, 768, 1024, 1280, 1440]) {
    const { columns, tile, height } = tiles(column(viewport));
    assert.ok(columns >= 2 && columns <= 5, `${viewport} px: ${columns} columns`);
    assert.ok(tile >= 2 * g.inset + 2 * g.tool + g.between, `${viewport} px: the moves fit a ${tile.toFixed(1)} px tile`);
    assert.ok(tile >= g.inset + badge + 4 + g.tool + g.inset, `${viewport} px: the number and Remove fit side by side`);
    assert.ok(height >= 2 * g.inset + 2 * g.tool + 8, `${viewport} px: Remove and the moves do not meet`);
  }
  // Checked at the widths the re-check named: three photos to a row, as before, at 375 and 390 px.
  assert.deepEqual([375, 390].map((viewport) => tiles(column(viewport)).columns), [3, 3]);
  assert.equal(Math.round(tiles(column(375)).tile), 109);
  assert.equal(Math.round(tiles(column(390)).tile), 114);
  assert.equal(tiles(column(320)).columns, 2, "a 320 px phone: two to a row");
  assert.equal(tiles(column(1280)).columns, 5, "the 640 px column: five to a row, as before");
  // With a desktop scroll bar taking 15 px of a 375 px window the tiles still hold the tools (no viewport breakpoint).
  assert.ok(tiles(375 - 15 - 32).tile >= g.minTile);
});

test("only a mouse with no touch screen gets the compact 32 px tools, and only from 640 px", () => {
  const compact = [...css.matchAll(/@media ([^{]+)\{\s*\.pickTool \{([^}]*)\}\s*\}/g)];
  assert.equal(compact.length, 1, "one rule changes the tools' size");
  const [, query, body] = compact[0];
  assert.equal(query.trim(), "(min-width: 640px) and (pointer: fine) and (not (any-pointer: coarse))");
  assert.equal(px(body, "width"), 32);
  assert.equal(px(body, "height"), 32);
  // Nothing else shrinks them: no fixed size elsewhere, and the tool keeps its size in its row.
  assert.equal((css.match(/\.pickTool[^{]*\{[^}]*\bwidth: \d+px/g) ?? []).length, 2);
  assert.match(rule(".pickTool"), /flex: none;/);
  assert.doesNotMatch(css, /\.pickTools\b/, "the old row of three is gone");
});

test("every tool keeps its name, in an order that follows the tile: Remove (top), then Move earlier and Move later", () => {
  const composer = source("src/components/social/ComposerView.tsx");
  const tile = composer.slice(composer.indexOf("<div key={item.key} className={styles.pick}>"), composer.indexOf("{Array.from({ length: preparing }"));
  const at = (text: string) => {
    const index = tile.indexOf(text);
    assert.ok(index >= 0, text);
    return index;
  };
  const remove = at("aria-label={`Remove photo ${index + 1}`}");
  const earlier = at("aria-label={`Move photo ${index + 1} earlier`}");
  const later = at("aria-label={`Move photo ${index + 1} later`}");
  assert.ok(remove < earlier && earlier < later);
  assert.match(tile, /className=\{`\$\{styles\.pickTool\} \$\{styles\.pickRemove\}`\}/);
  const moves = tile.slice(tile.indexOf("<div className={styles.pickMoves}>"));
  assert.ok(moves.includes("earlier") && moves.includes("later") && !moves.includes("Remove photo"), "the moves share the bottom row");
  // Still disabled at the ends (and while the post is being shared, when focus is on Share post).
  assert.match(tile, /disabled=\{index === 0 \|\| busy\} onClick=\{\(\) => move\(index, -1\)\}/);
  assert.match(tile, /disabled=\{index === items\.length - 1 \|\| busy\} onClick=\{\(\) => move\(index, 1\)\}/);
  assert.match(tile, /disabled=\{busy\} onClick=\{\(\) => drop\(item\.key\)\}/);
});

/** WCAG relative luminance and contrast. */
const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const rgb = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
const mix = (a: number[], b: number[], share: number) => a.map((value, index) => value * share + b[index] * (1 - share));

test("the tools read in light and dark: theme colours only, the icon clear of its disc over any photo", () => {
  const tool = rule(".pickTool");
  assert.match(tool, /background: color-mix\(in srgb, var\(--fitx-surface\) (\d+)%, transparent\);/);
  assert.match(tool, /color: var\(--fitx-text\);/);
  assert.doesNotMatch(tool + rule(".pickRemove") + rule(".pickMoves"), /#[0-9a-f]{3,8}\b|rgba?\(/i, "no fixed colours");
  assert.match(css, /\.pickTool:focus-visible \{ outline: 2px solid var\(--fitx-primary\); \}/);
  const share = Number(/var\(--fitx-surface\) (\d+)%/.exec(tool)?.[1]) / 100;
  const globals = source("src/app/globals.css");
  const light = globals.slice(0, globals.indexOf(':root[data-theme="dark"]'));
  const dark = globals.slice(globals.indexOf(':root[data-theme="dark"]'));
  const token = (block: string, name: string) => {
    const match = new RegExp(`--fitx-${name}: (#[0-9a-f]{6});`, "i").exec(block);
    assert.ok(match, `--fitx-${name}`);
    return rgb(match[1]);
  };
  for (const [theme, block] of [["light", light], ["dark", dark]] as const) {
    const text = token(block, "text");
    const surface = token(block, "surface");
    for (const photo of [[0, 0, 0], [255, 255, 255]]) {
      const disc = mix(surface, photo, share);
      assert.ok(contrast(text, disc) >= 4.5, `${theme}: the icon on its disc over a ${photo[0] ? "white" : "black"} photo (${contrast(text, disc).toFixed(1)}:1)`);
    }
  }
});

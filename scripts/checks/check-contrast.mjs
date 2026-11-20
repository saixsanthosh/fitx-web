#!/usr/bin/env node
/**
 * Checks the colour tokens in src/app/globals.css against WCAG 2.2 contrast minimums.
 *
 *   node scripts/checks/check-contrast.mjs            # failures plus a summary
 *   node scripts/checks/check-contrast.mjs --all      # every pair, passing ones too
 *   node scripts/checks/check-contrast.mjs --json     # machine-readable result
 *   node scripts/checks/check-contrast.mjs --css path/to/file.css
 *
 * Palettes: light (`:root`, which is also what "system" shows on a light OS), dark
 * (`:root[data-theme="dark"]`), system-dark (`:root[data-theme="system"]` inside
 * `prefers-color-scheme: dark`), and the inverse band (`.fitx-inverse`) resolved inside each of them.
 *
 * Thresholds: 4.5:1 for body text, 3:1 for large text (24px, or 18.66px bold) and for UI edges such as
 * focus rings, indicators, progress fills and button outlines (WCAG 1.4.3 and 1.4.11). Pairs marked
 * "info" are printed for reference and never fail (decorative dividers and card borders).
 *
 * It also fails when:
 * - the system-dark block drifts from the dark block (they must be identical);
 * - a themed token declared in `:root` is not redeclared for dark (dark mode would show the light value);
 * - a token used by a pair is missing or is not a colour this script can read.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MINIMUM = { text: 4.5, large: 3, ui: 3, info: 0 };
/** Tokens that intentionally keep one value in every theme. */
const THEME_INDEPENDENT = /^--fitx-(scrim|inverse-|on-inverse)/;

/**
 * The pairs to check. `fg` is the text or UI colour; `bg` lists layers from the bottom up. A layer is a
 * token, a literal colour, or [token, alpha] for that token at an opacity. Translucent layers are
 * composited over the layer beneath them, and the bottom layer over the palette's --fitx-bg.
 * `scopes`: "theme" (light, dark, system only), "inverse" (inverse band only) or "both".
 */
export const PAIRS = (() => {
  const pairs = [];
  const add = (fg, bg, kind, where, scopes = "both") => pairs.push({ fg, bg: Array.isArray(bg) ? bg : [bg], kind, where, scopes });
  const neutralSurfaces = ["--fitx-bg", "--fitx-surface", "--fitx-card-bg", "--fitx-surface-variant", "--fitx-elevated"];

  for (const surface of neutralSurfaces) {
    add("--fitx-text", surface, "text", "Body text and headings");
    add("--fitx-text-secondary", surface, "text", "Secondary text, labels, helper copy");
    add("--fitx-text-disabled", surface, "text", "Tertiary text, timestamps, placeholders");
    add("--fitx-primary-text", surface, "text", "Small brand-coloured text: eyebrows, links, selected labels");
    add("--fitx-danger", surface, "text", "Error messages and destructive labels");
    add("--fitx-primary", surface, "ui", "Brand icons, focus rings, active indicators, progress fills");
  }
  for (const surface of ["--fitx-surface", "--fitx-card-bg"]) {
    add("--fitx-primary", surface, "text", "Brand text on plain cards (on the page bg or a tint use --fitx-primary-text)");
    add("--fitx-success", surface, "text", "Success messages");
    add("--fitx-info", surface, "text", "Informational accents");
    add("--fitx-warning", surface, "text", "Warnings (e.g. .auth-config-note)");
    add("--fitx-gold", surface, "text", "Gold accents");
  }
  add("--fitx-primary", "--fitx-bg", "large", "Brand-coloured display text on the page background");
  add("--fitx-primary", "--fitx-surface-variant", "large", "Brand-coloured display text on variant surfaces");
  add("--fitx-success", "--fitx-bg", "text", "Success messages on the page background");
  add("--fitx-warning", "--fitx-bg", "text", "Warnings on the page background");

  // Fills and the text on them.
  add("--fitx-on-primary", "--fitx-primary", "text", ".fitx-button label");
  add("--fitx-on-primary", "--fitx-primary-bright", "text", ".fitx-button label on hover");
  add("--fitx-on-danger", "--fitx-danger", "text", "Text on a solid danger fill");
  add("--fitx-on-strong", "--fitx-strong-bg", "text", "'Continue with Google' label", "theme");
  add("--fitx-on-strong", "--fitx-strong-hover", "text", "'Continue with Google' label on hover", "theme");
  add("--fitx-strong-border", "--fitx-bg", "ui", "'Continue with Google' button edge against the page", "theme");

  // Tints and states.
  for (const base of ["--fitx-bg", "--fitx-surface"]) {
    add("--fitx-primary-text", [base, ["--fitx-primary", 0.1]], "text", "Selected chip or active nav item (bg-fitx-primary/10)");
    add("--fitx-danger", [base, "--fitx-danger-bg"], "text", ".fitx-alert-danger, .auth-error");
    add("--fitx-success", [base, "--fitx-success-bg"], "text", ".fitx-alert-success");
    add("--fitx-text", [base, "--fitx-hover"], "text", "Hovered row or button text");
    add("--fitx-text-secondary", [base, "--fitx-hover"], "text", "Hovered secondary text");
    add("--fitx-primary-text", [base, "--fitx-hover"], "text", "Hovered brand link");
  }
  add("--fitx-primary-text", ["--fitx-surface-variant", ["--fitx-primary", 0.08]], "text", "Selected day or card on a variant surface");
  add("--fitx-text-secondary", ["--fitx-surface-variant", ["--fitx-primary", 0.08]], "text", "Secondary text on a selected variant surface");
  add("--fitx-primary", "--fitx-track", "ui", "Progress fill and ring against its track");
  add("--fitx-info", "--fitx-track", "ui", "Water progress fill against its track");
  add("--fitx-primary", "--fitx-surface-variant", "ui", "Chart bars against their column");

  // Body map: a highlighted muscle must stand out from a resting one, and the figure from the card it sits on.
  add("--fitx-primary", "--fitx-anatomy-muscle", "info", "Highlighted muscle against a resting muscle (about 2.7:1; hue and the text label carry the meaning too)");
  add("--fitx-primary", "--fitx-anatomy-base", "ui", "Highlighted muscle against the plain body");
  add("--fitx-anatomy-muscle", "--fitx-anatomy-base", "info", "Resting muscle against the plain body");
  add("--fitx-anatomy-secondary", "--fitx-anatomy-muscle", "info", "Assisting muscle against a resting muscle");
  add("--fitx-anatomy-base", "--fitx-card-bg", "info", "Body figure against its card");
  // Photo tiles: label text over the tile wash, worst case a white photo pixel under the 72% scrim.
  add("--fitx-on-inverse", ["#ffffff", ["--fitx-tile-scrim", 0.72]], "text", "Focus tile label over a bright photo", "theme");

  // Mobile navigation: a translucent bar over the page.
  add("--fitx-text-disabled", ["--fitx-bg", "--fitx-nav-bg"], "text", "Inactive bottom-bar labels", "theme");
  add("--fitx-primary-text", ["--fitx-bg", "--fitx-nav-bg"], "text", "Active bottom-bar label", "theme");
  add("--fitx-primary", ["--fitx-bg", "--fitx-nav-bg"], "ui", "Active bottom-bar icon", "theme");
  add("--fitx-primary-text", ["--fitx-elevated", ["--fitx-primary", 0.1]], "text", "Active item in the More menu", "theme");
  add("--fitx-text-secondary", ["--fitx-elevated", "--fitx-hover"], "text", "Hovered item in the More menu", "theme");

  // Photo heroes: worst case is a white photo pixel under the shade stop behind the text.
  add("--fitx-on-inverse", ["#ffffff", ["--fitx-scrim", 0.79]], "text", "Hero copy over the desktop photo shade (79% stop)", "inverse");
  add(["--fitx-on-inverse", 0.68], ["#ffffff", ["--fitx-scrim", 0.79]], "text", "Hero note (68% ink) over the desktop photo shade", "inverse");
  add("--fitx-inverse-primary", ["#ffffff", ["--fitx-scrim", 0.79]], "text", "Hero eyebrow over the desktop photo shade", "inverse");
  add("--fitx-on-inverse", ["#ffffff", ["--fitx-scrim", 0.66]], "large", "Hero headline over the tablet photo shade (66% stop)", "inverse");

  // Sports, macros and chart series: labels and fills on cards, tints and tracks.
  for (const sport of ["walk", "run", "ride"]) {
    for (const surface of ["--fitx-bg", "--fitx-surface", "--fitx-card-bg"]) add(`--fitx-sport-${sport}`, surface, "text", `${sport} label or icon`);
    add(`--fitx-sport-${sport}`, ["--fitx-surface", `--fitx-sport-${sport}-bg`], "text", `${sport} label on its tint`);
    add(`--fitx-sport-${sport}`, "--fitx-track", "ui", `${sport} fill against a track`);
  }
  for (const macro of ["protein", "carbs", "fat"]) {
    add(`--fitx-macro-${macro}`, "--fitx-card-bg", "text", `${macro} label on a card`);
    add(`--fitx-macro-${macro}`, "--fitx-track", "ui", `${macro} fill against its track`);
  }
  for (const series of [1, 2, 3, 4]) {
    add(`--fitx-chart-${series}`, "--fitx-card-bg", "ui", `Chart series ${series} on a card`);
    add(`--fitx-chart-${series}`, "--fitx-surface-variant", "ui", `Chart series ${series} on a variant surface`);
  }
  // The cinematic stage (dark in every theme).
  add("--fitx-on-stage", "--fitx-stage", "text", "Text on the stage", "theme");
  add("--fitx-on-stage-secondary", "--fitx-stage", "text", "Secondary text on the stage", "theme");
  add("--fitx-inverse-primary", "--fitx-stage", "text", "Brand accent text on the stage", "theme");

  // Reference only: decorative separators (WCAG 1.4.11 does not apply to them).
  add("--fitx-border", "--fitx-surface", "info", "Card and field borders");
  add("--fitx-divider", "--fitx-surface", "info", "Dividers");
  add("--fitx-track", "--fitx-card-bg", "info", "Empty track against its card");
  return pairs;
})();

// ---------------------------------------------------------------------------------------------------
// CSS reading
// ---------------------------------------------------------------------------------------------------
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
}

/** Every rule block with its selector and the at-rule preludes around it. */
function readBlocks(css) {
  const blocks = [];
  const stack = [];
  let prelude = "";
  for (let i = 0; i < css.length; i += 1) {
    const char = css[i];
    if (char === "{") {
      stack.push({ prelude: prelude.trim(), start: i + 1 });
      prelude = "";
    } else if (char === "}") {
      const open = stack.pop();
      if (open) blocks.push({ selector: open.prelude.replace(/\s+/g, " "), context: stack.map((entry) => entry.prelude.replace(/\s+/g, " ")), body: css.slice(open.start, i) });
      prelude = "";
    } else if (char === ";" && stack.length === 0) {
      prelude = "";
    } else {
      prelude += char;
    }
  }
  return blocks;
}

/** The custom properties declared in a block body. */
function declarations(body) {
  const result = {};
  let depth = 0;
  let current = "";
  const flush = () => {
    const match = current.match(/^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/);
    if (match) result[match[1]] = match[2];
    current = "";
  };
  for (const char of body) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === ";" && depth === 0) flush();
    else current += char;
  }
  flush();
  return result;
}

// ---------------------------------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------------------------------
const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], transparent: [0, 0, 0, 0] };

function resolveVars(value, palette, seen = new Set()) {
  return value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (_, name, fallback) => {
    if (seen.has(name)) throw new Error(`circular reference through ${name}`);
    if (name in palette) return resolveVars(palette[name], palette, new Set([...seen, name]));
    if (fallback !== undefined) return resolveVars(fallback, palette, seen);
    throw new Error(`${name} is not defined`);
  });
}

/** Parses hex, rgb()/rgba(), white/black/transparent and `color-mix(in srgb, …)` into [r, g, b, a]. */
export function parseColor(raw) {
  const value = raw.trim().toLowerCase();
  if (value in NAMED) return NAMED[value];
  const hex = value.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) digits = [...digits].map((digit) => digit + digit).join("");
    if (digits.length !== 6 && digits.length !== 8) throw new Error(`unsupported hex colour ${raw}`);
    const [r, g, b, a = 255] = [0, 2, 4, 6].filter((index) => index < digits.length).map((index) => parseInt(digits.slice(index, index + 2), 16));
    return [r, g, b, a / 255];
  }
  const rgb = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    const channel = (part) => (part.endsWith("%") ? (parseFloat(part) / 100) * 255 : parseFloat(part));
    const alpha = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    return [channel(parts[0]), channel(parts[1]), channel(parts[2]), alpha];
  }
  const mix = value.match(/^color-mix\(\s*in srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+?)(?:\s+([\d.]+)%)?\s*\)$/);
  if (mix) {
    const [first, second] = [parseColor(mix[1]), parseColor(mix[3])];
    const p = parseFloat(mix[2]) / 100;
    const q = mix[4] === undefined ? 1 - p : parseFloat(mix[4]) / 100;
    const alpha = (first[3] * p + second[3] * q) / (p + q);
    const channel = (index) => (alpha === 0 ? 0 : (first[index] * first[3] * p + second[index] * second[3] * q) / (p + q) / alpha);
    return [channel(0), channel(1), channel(2), alpha * Math.min(1, p + q)];
  }
  throw new Error(`cannot read colour "${raw}"`);
}

/** Paints `top` over `bottom` (both [r, g, b, a]). */
export function composite(top, bottom) {
  const alpha = top[3] + bottom[3] * (1 - top[3]);
  if (alpha === 0) return [0, 0, 0, 0];
  return [0, 1, 2].map((index) => (top[index] * top[3] + bottom[index] * bottom[3] * (1 - top[3])) / alpha).concat(alpha);
}

function relativeLuminance([r, g, b]) {
  const linear = (channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio between two opaque colours. */
export function contrastRatio(a, b) {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

// ---------------------------------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------------------------------
const describe = (layer) => (Array.isArray(layer) ? `${layer[0]} @${Math.round(layer[1] * 100)}%` : layer);

/** Reads the token blocks from a stylesheet and checks every pair. Returns { problems, results }. */
export function checkTokens(cssText, pairs = PAIRS) {
  const blocks = readBlocks(stripComments(cssText));
  const find = (selector, context = []) => blocks.find((block) => block.selector === selector && block.context.join("|") === context.join("|"));
  const wanted = {
    light: [":root"],
    dark: [':root[data-theme="dark"]'],
    system: [':root[data-theme="system"]', ["@media (prefers-color-scheme: dark)"]],
    inverse: [".fitx-inverse"],
  };
  const problems = [];
  const found = {};
  for (const [name, [selector, context]] of Object.entries(wanted)) {
    const block = find(selector, context);
    if (block) found[name] = declarations(block.body);
    else problems.push(`Missing token block ${context ? `${context.join(" ")} ` : ""}${selector}`);
  }
  if (problems.length) return { problems, results: [] };
  const { light, dark, system, inverse } = found;

  for (const name of new Set([...Object.keys(dark), ...Object.keys(system)])) {
    if (dark[name] !== system[name]) problems.push(`System-dark drifted from dark: ${name} is "${dark[name] ?? "missing"}" in dark but "${system[name] ?? "missing"}" in system-dark`);
  }
  for (const name of Object.keys(light)) {
    if (name.startsWith("--fitx-") && !THEME_INDEPENDENT.test(name) && !(name in dark)) problems.push(`${name} is declared for light but not for dark, so dark mode would show the light value`);
  }

  const palettes = [
    { name: "light", scope: "theme", tokens: { ...light } },
    { name: "dark", scope: "theme", tokens: { ...light, ...dark } },
    { name: "system-dark", scope: "theme", tokens: { ...light, ...system } },
    { name: "inverse (light)", scope: "inverse", tokens: { ...light, ...inverse } },
    { name: "inverse (dark)", scope: "inverse", tokens: { ...light, ...dark, ...inverse } },
    { name: "inverse (system-dark)", scope: "inverse", tokens: { ...light, ...system, ...inverse } },
  ];
  const results = [];
  for (const palette of palettes) {
    const colour = (layer) => {
      if (Array.isArray(layer)) {
        const base = colour(layer[0]);
        return [base[0], base[1], base[2], base[3] * layer[1]];
      }
      return parseColor(layer.startsWith("--") ? resolveVars(`var(${layer})`, palette.tokens) : layer);
    };
    for (const pair of pairs) {
      if (pair.scopes !== "both" && pair.scopes !== palette.scope) continue;
      const label = `${describe(pair.fg)} on ${pair.bg.map(describe).join(" + ")}`;
      try {
        const page = colour("--fitx-bg");
        const start = page[3] < 1 ? composite(page, NAMED.white) : page;
        const background = pair.bg.reduce((below, layer) => composite(colour(layer), below), start);
        const value = contrastRatio(composite(colour(pair.fg), background), background);
        const minimum = MINIMUM[pair.kind];
        results.push({ palette: palette.name, pair: label, kind: pair.kind, where: pair.where, ratio: value, minimum, pass: pair.kind === "info" || value >= minimum });
      } catch (error) {
        problems.push(`${palette.name}: ${label}: ${error.message}`);
      }
    }
  }
  return { problems, results };
}

function main(args) {
  const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };
  const cssPath = resolve(option("--css", "src/app/globals.css"));
  const { problems, results } = checkTokens(readFileSync(cssPath, "utf8"));
  const failures = results.filter((result) => !result.pass);
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ css: cssPath, problems, failures, results }, null, 2)}\n`);
  } else {
    let lastPalette = "";
    for (const row of args.includes("--all") ? results : failures) {
      if (row.palette !== lastPalette) {
        console.log(`\n${row.palette}`);
        lastPalette = row.palette;
      }
      const verdict = row.kind === "info" ? "info" : row.pass ? "pass" : "FAIL";
      const need = row.kind === "info" ? "" : ` (needs ${row.minimum}:1 ${row.kind})`;
      console.log(`  ${verdict.padEnd(4)}  ${row.ratio.toFixed(2).padStart(5)}:1${need.padEnd(20)}  ${row.pair}  — ${row.where}`);
    }
    for (const problem of problems) console.log(`FAIL  ${problem}`);
    const checked = results.filter((result) => result.kind !== "info").length;
    console.log(`\n${checked} contrast checks across ${new Set(results.map((result) => result.palette)).size} palettes: ${failures.length} failing, ${problems.length} token problems.`);
  }
  if (problems.length || failures.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2));

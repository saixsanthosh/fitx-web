#!/usr/bin/env node
/**
 * Fails when app code hard-codes a colour instead of using the theme tokens in src/app/globals.css.
 * Hard-coded colours ignore the light, dark and system themes, which is how dark-on-dark text slips in.
 *
 *   node scripts/check-raw-colors.mjs              # scan src/
 *   node scripts/check-raw-colors.mjs <path ...>   # scan only these files or folders
 *   node scripts/check-raw-colors.mjs --json       # machine-readable result
 *
 * Reports hex colours (#c44933), colour functions (rgb(), rgba(), hsl(), oklch() …), Tailwind palette
 * utilities (text-red-200, bg-white/5, border-black/20) and, in CSS, named colours (white, black …).
 * Use a token instead: `var(--fitx-…)` in CSS, `text-fitx-…`/`bg-fitx-…` utilities in markup, and
 * `color-mix(in srgb, var(--fitx-…) 20%, transparent)` for a translucent version.
 *
 * Not scanned: src/app/globals.css (where the tokens live) and src/components/brand/** (the intro film,
 * whose colours match the pre-rendered video). A line can opt out with a comment containing
 * "fitx-allow-raw-color: <reason>" on the same line or the line above. ALLOWED lists the places where
 * a literal colour is required.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css"]);
const SKIPPED = ["src/app/globals.css", "src/components/brand/"];
const INLINE_ALLOW = "fitx-allow-raw-color";

/** Places where a literal colour is required. `values` limits the exemption to those exact colours. */
export const ALLOWED = [
  { file: "src/components/ui/GoogleIcon.tsx", reason: "Google's logo colours are fixed by Google's brand guidelines." },
  { file: "src/app/opengraph-image.tsx", reason: "The share image is drawn by next/og, which cannot read CSS variables." },
  { file: "src/app/manifest.ts", values: ["#f7f7f4"], reason: "Web app manifest colours must be literal (they match --fitx-bg)." },
  { file: "src/app/layout.tsx", values: ["#f7f7f4", "#151715"], reason: "The theme-color meta tag needs literal values (they match --fitx-bg in light and dark)." },
];

const PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTILITY = "bg|text|border(?:-[trblxyse])?|from|via|to|ring|ring-offset|outline|fill|stroke|shadow|decoration|divide|accent|caret|placeholder";
const PATTERNS = [
  { kind: "hex colour", regex: /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g },
  { kind: "colour function", regex: /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi },
  { kind: "Tailwind palette colour", regex: new RegExp(`(?<![\\w-])(?:${UTILITY})-(?:white|black|(?:${PALETTE})-\\d{2,3})(?:\\/(?:\\d{1,3}|\\[[^\\]\\s]+\\]))?(?![\\w-])`, "g") },
];
const NOT_COLOUR_PROPERTIES = new Set(["content", "font", "font-family", "grid-area", "grid-template-areas", "animation", "animation-name", "transition", "transition-property", "will-change", "counter-reset", "counter-increment", "list-style-type", "quotes"]);
const NAMED_CSS = /(?<![\w-])(white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|maroon|navy|teal|aqua|lime|olive|fuchsia|crimson|coral|salmon|tomato|gold)(?![\w-])/gi;

/** Blanks out comments (keeping line breaks) so old colours mentioned in notes are not reported. */
function stripComments(source, css) {
  let out = "";
  let quote = null;
  for (let i = 0; i < source.length; ) {
    const char = source[i];
    const next = source[i + 1];
    if (quote) {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (char === quote) quote = null;
      i += 1;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (!css && char === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      out += " ".repeat(stop - i);
      i = stop;
    } else {
      if (char === '"' || char === "'" || (!css && char === "`")) quote = char;
      out += char;
      i += 1;
    }
  }
  return out;
}

/**
 * Finds raw colours in one file's source. `file` is the repo-relative path (used for ALLOWED);
 * `css` switches on CSS comment rules and named-colour checks.
 */
export function findRawColors(source, { file = "", css = file.endsWith(".css") } = {}) {
  const rawLines = source.split("\n");
  const lines = stripComments(source, css).split("\n");
  const allowed = ALLOWED.find((entry) => entry.file === file);
  const findings = [];
  lines.forEach((line, index) => {
    if (rawLines[index].includes(INLINE_ALLOW) || (index > 0 && rawLines[index - 1].includes(INLINE_ALLOW))) return;
    const hits = [];
    for (const { kind, regex } of PATTERNS) {
      for (const match of line.matchAll(regex)) hits.push({ kind, value: match[0], column: match.index + 1 });
    }
    if (css) {
      for (const declaration of line.matchAll(/(^|[;{\s])([a-z-]+)\s*:\s*([^;{}]+)/gi)) {
        if (NOT_COLOUR_PROPERTIES.has(declaration[2].toLowerCase())) continue;
        const valueStart = declaration.index + declaration[0].indexOf(declaration[3]);
        for (const match of declaration[3].matchAll(NAMED_CSS)) hits.push({ kind: "named colour", value: match[0], column: valueStart + match.index + 1 });
      }
    }
    for (const hit of hits) {
      if (allowed && (!allowed.values || allowed.values.includes(hit.value.toLowerCase()))) continue;
      findings.push({ file, line: index + 1, column: hit.column, kind: hit.kind, value: hit.value, text: rawLines[index].trim().slice(0, 140) });
    }
  });
  return findings;
}

function main(args) {
  const root = process.cwd();
  const display = (path) => relative(root, path).split(sep).join("/");
  const isSkipped = (path) => SKIPPED.some((skip) => (skip.endsWith("/") ? path.startsWith(skip) : path === skip));
  const files = [];
  const collect = (path) => {
    let stats;
    try {
      stats = statSync(path);
    } catch {
      console.error(`No such file or folder: ${display(path)}`);
      process.exitCode = 2;
      return;
    }
    if (stats.isDirectory()) {
      for (const entry of readdirSync(path)) if (entry !== "node_modules" && !entry.startsWith(".")) collect(join(path, entry));
    } else if (EXTENSIONS.has(extname(path)) && !isSkipped(display(path))) {
      files.push(path);
    }
  };
  const targets = args.filter((arg) => !arg.startsWith("--"));
  for (const target of targets.length ? targets : ["src"]) collect(resolve(root, target));

  const findings = files
    .flatMap((path) => findRawColors(readFileSync(path, "utf8"), { file: display(path), css: extname(path) === ".css" }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);

  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ scanned: files.length, findings }, null, 2)}\n`);
  } else {
    let lastFile = "";
    for (const finding of findings) {
      if (finding.file !== lastFile) {
        console.log(`\n${finding.file}`);
        lastFile = finding.file;
      }
      console.log(`  ${String(finding.line).padStart(4)}:${String(finding.column).padEnd(4)} ${finding.value.padEnd(22)} ${finding.kind}`);
    }
    const fileCount = new Set(findings.map((finding) => finding.file)).size;
    console.log(`\nScanned ${files.length} files: ${findings.length} raw colours in ${fileCount} files.`);
    if (findings.length) console.log("Use the theme tokens in src/app/globals.css (see the comment at the top of that file).");
  }
  if (findings.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2));

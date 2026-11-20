// Tests for scripts/checks/check-contrast.mjs and scripts/checks/check-raw-colors.mjs.
// Run with: node --test scripts/checks/theme-checks.test.mjs (from the repository root; npm test runs it too)
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkTokens, contrastRatio, parseColor } from "./check-contrast.mjs";
import { findRawColors } from "./check-raw-colors.mjs";

const globals = readFileSync("src/app/globals.css", "utf8");
const failing = ({ results }) => results.filter((result) => !result.pass);

test("contrast maths matches the WCAG formula", () => {
  assert.equal(contrastRatio(parseColor("#000"), parseColor("#fff")).toFixed(2), "21.00");
  assert.equal(contrastRatio(parseColor("#c44933"), parseColor("#ffffff")).toFixed(2), "4.83");
  assert.deepEqual(parseColor("rgba(25, 28, 25, 0.14)"), [25, 28, 25, 0.14]);
  assert.deepEqual(parseColor("#ffffff80").slice(0, 3), [255, 255, 255]);
});

test("the theme tokens pass every contrast pair in light, dark, system and the inverse band", () => {
  const report = checkTokens(globals);
  assert.deepEqual(report.problems, []);
  assert.deepEqual(failing(report).map((result) => `${result.palette}: ${result.pair} ${result.ratio.toFixed(2)}`), []);
  const palettes = new Set(report.results.map((result) => result.palette));
  for (const name of ["light", "dark", "system-dark", "inverse (light)", "inverse (dark)", "inverse (system-dark)"]) assert.ok(palettes.has(name), name);
});

test("white text on the dark-theme coral button is caught (the 2.93:1 bug)", () => {
  const broken = globals.replaceAll("--fitx-on-primary: #191c19;", "--fitx-on-primary: #ffffff;");
  const failures = failing(checkTokens(broken)).filter((result) => result.where === ".fitx-button label");
  assert.deepEqual(failures.map((result) => result.palette).sort(), ["dark", "system-dark"]);
  assert.equal(failures[0].ratio.toFixed(2), "2.93");
});

test("the old dark-theme danger colour is caught (the 2.19:1 bug)", () => {
  const broken = globals.replaceAll("--fitx-danger: #f2b8b5;", "--fitx-danger: #9f2727;");
  const failures = failing(checkTokens(broken)).filter((result) => result.palette === "dark" && result.pair === "--fitx-danger on --fitx-surface");
  assert.equal(failures.length, 1);
  assert.ok(failures[0].ratio < 2.3);
});

test("system-dark drifting from dark is reported", () => {
  const drifted = globals.replace(/(:root\[data-theme="system"\] \{[\s\S]*?--fitx-text: )#f3f3ef;/, "$1#ffffff;");
  assert.notEqual(drifted, globals);
  assert.ok(checkTokens(drifted).problems.some((problem) => problem.startsWith("System-dark drifted from dark: --fitx-text")));
});

test("a light token without a dark value is reported", () => {
  const missing = globals.replace("  --fitx-track: #e4e6e0;", "  --fitx-track: #e4e6e0;\n  --fitx-new-thing: #123456;");
  assert.ok(checkTokens(missing).problems.some((problem) => problem.startsWith("--fitx-new-thing is declared for light but not for dark")));
});

test("raw colours are found in markup and CSS", () => {
  const tsx = [
    '<div className="bg-[#0b1012] p-4" />',
    '<p className="text-red-200">x</p>',
    '<a className="hover:bg-white/[.04]" />',
    '<span className="border-black/20" />',
    'const shade = "rgba(5, 8, 8, 0.9)";',
  ].join("\n");
  assert.deepEqual(findRawColors(tsx, { file: "src/x.tsx" }).map((finding) => finding.value), ["#0b1012", "text-red-200", "bg-white/[.04]", "border-black/20", "rgba("]);
  const css = ".a { color: white; background: #101817; }\n.b { box-shadow: 0 0 0 4px rgb(1 2 3 / 10%); }";
  assert.deepEqual(findRawColors(css, { file: "src/x.module.css" }).map((finding) => finding.value), ["#101817", "white", "rgb("]);
});

test("tokens, anchors, entities and comments are not reported", () => {
  const tsx = [
    '<a href="#features">Features</a>',
    "<p>It&#8217;s here</p>",
    "// was #101817 before the rebrand",
    "/* rgba(0,0,0,.5) */",
    '<div className="bg-fitx-primary/10 text-fitx-primary-text hover:bg-fitx-hover" />',
    'const url = "https://example.com/path";',
  ].join("\n");
  assert.deepEqual(findRawColors(tsx, { file: "src/x.tsx" }), []);
  const css = [
    ".a { color: var(--fitx-text); background: color-mix(in srgb, var(--fitx-primary) 10%, transparent); }",
    ".b { --story-white: var(--fitx-on-inverse); animation: gold-pulse 1s; }",
    "/* old: #79df83 */",
  ].join("\n");
  assert.deepEqual(findRawColors(css, { file: "src/x.module.css" }), []);
});

test("exemptions: inline opt-out and the allowed literal values", () => {
  const optOut = "// fitx-allow-raw-color: canvas drawing needs a literal\nctx.fillStyle = \"#ff0000\";";
  assert.deepEqual(findRawColors(optOut, { file: "src/x.tsx" }), []);
  const layout = 'themeColor: [{ color: "#F7F7F4" }, { color: "#151715" }, { color: "#123456" }]';
  assert.deepEqual(findRawColors(layout, { file: "src/app/layout.tsx" }).map((finding) => finding.value), ["#123456"]);
});

test("files converted to tokens in this stream contain no raw colours", () => {
  const owned = [
    "src/components/layout/PublicFooter.tsx",
    "src/components/layout/PublicFooter.module.css",
    "src/components/layout/BottomNav.tsx",
    "src/components/layout/Sidebar.tsx",
    "src/components/layout/WorkspaceHeader.tsx",
    "src/components/app/ProgressRing.tsx",
    "src/components/ui/Toaster.tsx",
    "src/app/(auth)/onboarding/page.tsx",
    "src/app/(marketing)/page.module.css",
    "src/components/landing/landing.module.css",
    "src/app/(dashboard)/dashboard",
    "src/app/(dashboard)/goals",
    "src/app/(dashboard)/planner",
    "src/app/(dashboard)/progress",
    "src/app/(dashboard)/profile",
  ];
  // Route folders can hold sub-routes (e.g. /progress/muscles), so folders are read all the way down.
  const filesIn = (path) => (statSync(path).isDirectory() ? readdirSync(path).flatMap((name) => filesIn(join(path, name))) : [path]);
  const files = owned.flatMap(filesIn);
  const findings = files.flatMap((file) => findRawColors(readFileSync(file, "utf8"), { file }));
  assert.deepEqual(findings.map((finding) => `${finding.file}:${finding.line} ${finding.value}`), []);
});

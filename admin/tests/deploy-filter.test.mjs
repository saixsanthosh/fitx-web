// The root `npm test` runs this file and vercel-ignore.test.mjs too, without
// admin/node_modules, so the filter and both test files import only Node built-ins and
// each other. The last test below enforces that.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizePath, parseNameStatusZ, relevantFiles, shouldBuild } from "../scripts/deploy-filter.mjs";

test("FITX skips an Admin-only push, including additions, edits, and deletions", () => {
  assert.equal(shouldBuild("fitx", ["admin/src/app/page.tsx", "admin/README.md"]), false);
});

test("FITX builds for application and root dependency changes", () => {
  assert.equal(shouldBuild("fitx", ["src/app/page.tsx", "admin/src/app/page.tsx"]), true);
  assert.equal(shouldBuild("fitx", ["package-lock.json"]), true);
});

test("Admin builds for Admin changes and shared dependency changes", () => {
  assert.equal(shouldBuild("admin", ["admin/src/app/page.tsx"]), true);
  assert.equal(shouldBuild("admin", ["package-lock.json"]), true);
  assert.equal(shouldBuild("admin", ["packages/ui/button.tsx"]), true);
});

test("Admin skips FITX-only changes", () => {
  assert.equal(shouldBuild("admin", ["src/app/dashboard/page.tsx"]), false);
});

test("shared paths build both apps", () => {
  for (const file of ["package.json", "package-lock.json", ".npmrc", "tsconfig.base.json", "packages/ui/button.tsx", "shared/format.ts"]) {
    assert.equal(shouldBuild("fitx", [file]), true, `fitx should build for ${file}`);
    assert.equal(shouldBuild("admin", [file]), true, `admin should build for ${file}`);
  }
});

test("each project's own config file builds only that project", () => {
  assert.deepEqual([shouldBuild("fitx", ["vercel.json"]), shouldBuild("admin", ["vercel.json"])], [true, false]);
  assert.deepEqual([shouldBuild("fitx", ["admin/vercel.json"]), shouldBuild("admin", ["admin/vercel.json"])], [false, true]);
});

test("docs-only changes outside admin/ build FITX, which lives at the root, and skip Admin", () => {
  assert.equal(shouldBuild("fitx", ["docs/runbooks/release.md", "README.md"]), true);
  assert.equal(shouldBuild("admin", ["docs/runbooks/release.md", "README.md"]), false);
});

test("an empty diff builds both apps, because it means a redeploy or an empty commit", () => {
  assert.equal(shouldBuild("fitx", []), true);
  assert.equal(shouldBuild("admin", []), true);
  assert.equal(shouldBuild("admin", ["", ""]), true);
});

test("paths that only look like admin/ are not Admin paths", () => {
  assert.equal(shouldBuild("fitx", ["administration/notes.md"]), true);
  assert.equal(shouldBuild("admin", ["administration/notes.md"]), false);
  assert.equal(shouldBuild("admin", ["src/admin/page.tsx"]), false);
});

test("Git rename and delete records retain both paths", () => {
  const files = parseNameStatusZ("R100\0admin/src/old.tsx\0admin/src/new.tsx\0D\0admin/src/remove.tsx\0");
  assert.deepEqual(files, ["admin/src/old.tsx", "admin/src/new.tsx", "admin/src/remove.tsx"]);
  assert.equal(shouldBuild("admin", files), true);
});

test("a move between the apps builds both apps", () => {
  const files = parseNameStatusZ("R090\0src/lib/format.ts\0admin/src/lib/format.ts\0");
  assert.equal(shouldBuild("fitx", files), true);
  assert.equal(shouldBuild("admin", files), true);
});

test("Windows separators and ./ prefixes are normalised", () => {
  assert.equal(normalizePath(".\\admin\\src\\page.tsx"), "admin/src/page.tsx");
  assert.equal(normalizePath("./src/app/page.tsx"), "src/app/page.tsx");
  assert.equal(shouldBuild("fitx", ["admin\\src\\page.tsx"]), false);
});

test("relevantFiles lists only the paths that matter to each app", () => {
  const files = ["admin/src/a.tsx", "src/b.tsx", "package.json"];
  assert.deepEqual(relevantFiles("admin", files), ["admin/src/a.tsx", "package.json"]);
  assert.deepEqual(relevantFiles("fitx", files), ["src/b.tsx", "package.json"]);
});

test("unknown filter target fails open", () => {
  assert.equal(shouldBuild("unknown", ["admin/src/app/page.tsx"]), true);
  assert.equal(shouldBuild(undefined, []), true);
});

test("the filter and its tests need only Node and git, so the root npm test can run them", async () => {
  const files = ["../scripts/deploy-filter.mjs", "../scripts/vercel-ignore.mjs", "./deploy-filter.test.mjs", "./vercel-ignore.test.mjs"];
  const allowedRelative = new Set(["./deploy-filter.mjs", "../scripts/deploy-filter.mjs"]);
  const importPattern = /\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s+["']([^"']+)["']|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

  let checked = 0;
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match.slice(1).find(Boolean);
      assert.ok(specifier.startsWith("node:") || allowedRelative.has(specifier), `${file} imports "${specifier}", which needs more than Node and git`);
      checked++;
    }
  }
  assert.ok(checked >= 10, `expected to check the imports of all four files, found ${checked}`);
});

import test from "node:test";
import assert from "node:assert/strict";
import { parseNameStatusZ, shouldBuild } from "../scripts/vercel-ignore.mjs";

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

test("Git rename and delete records retain both paths", () => {
  const files = parseNameStatusZ("R100\0admin/src/old.tsx\0admin/src/new.tsx\0D\0admin/src/remove.tsx\0");
  assert.deepEqual(files, ["admin/src/old.tsx", "admin/src/new.tsx", "admin/src/remove.tsx"]);
  assert.equal(shouldBuild("admin", files), true);
});

test("unknown filter target fails open", () => {
  assert.equal(shouldBuild("unknown", ["admin/src/app/page.tsx"]), true);
});

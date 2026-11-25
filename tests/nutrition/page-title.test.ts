// Bug 78 (nutrition-14, nutrition's part): /nutrition carried the home page's title ("FITX — Train smart. Live fit."),
// so screen readers announced nothing when moving to it. It now has its own, "Nutrition | FITX" (the root layout's
// "%s | FITX" template), and Food data sources keeps "Food data sources | FITX".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("Nutrition has a title of its own, set beside its client page", () => {
  const layout = read("src/app/(dashboard)/nutrition/layout.tsx");
  assert.match(layout, /export const metadata: Metadata = \{ title: "Nutrition" \};/);
  assert.doesNotMatch(layout, /"use client"/, "metadata needs a server component");
  assert.match(read("src/app/(dashboard)/nutrition/page.tsx"), /^"use client";/, "which is why it is not in the page");
  assert.match(read("src/app/layout.tsx"), /template: "%s \| FITX"/);
  assert.match(read("src/app/(dashboard)/nutrition/sources/page.tsx"), /export const metadata: Metadata = \{ title: "Food data sources" \};/);
});

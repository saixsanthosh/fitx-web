// Bug 78 (nutrition-14, nutrition's part): /nutrition carried the home page's title ("FITX — Train smart. Live fit."),
// so screen readers announced nothing when moving to it. It now has its own, "Nutrition | FITX" (the root layout's
// "%s | FITX" template), and Food data sources keeps "Food data sources | FITX".
// Fix round 3a (reg-nutrition-a-1): the layout's first title was a plain string, which in Next.js resolves with no
// template, so Food data sources lost "| FITX" from its title and its screen-reader announcement. The layout's title
// is a template object now, and the titles below are worked out with Next's own title resolver.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { NUTRITION_TITLE } from "@/app/(dashboard)/nutrition/nutrition-title";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
type Resolved = { absolute: string; template: string | null };
const { resolveTitle } = createRequire(import.meta.url)("next/dist/lib/metadata/resolvers/resolve-title.js") as { resolveTitle: (title: unknown, template: string | null) => Resolved };

/** A route's title from its segments' titles, root first, as Next accumulates them: each uses the template above it. */
function routeTitle(segments: readonly unknown[]): string {
  let template: string | null = null;
  let resolved: Resolved | null = null;
  for (const title of segments) {
    if (title !== undefined) resolved = resolveTitle(title, template);
    template = resolved?.template ?? null;
  }
  return resolved?.absolute ?? "";
}

const rootTemplate = /title: \{ default: BRAND\.meta\.title, template: "([^"]+)" \}/.exec(read("src/app/layout.tsx"))?.[1];
const ROOT = { default: "FITX — Train smart. Live fit.", template: rootTemplate };
const sources = /export const metadata: Metadata = \{ title: "([^"]+)" \};/.exec(read("src/app/(dashboard)/nutrition/sources/page.tsx"))?.[1];
/** The (dashboard) layout sets no title (only robots). */
const DASHBOARD = undefined;

test("Nutrition has a title of its own, set beside its client page", () => {
  const layout = read("src/app/(dashboard)/nutrition/layout.tsx");
  assert.match(layout, /export const metadata: Metadata = \{ title: NUTRITION_TITLE \};/);
  assert.doesNotMatch(layout, /"use client"/, "metadata needs a server component");
  assert.match(read("src/app/(dashboard)/nutrition/page.tsx"), /^"use client";/, "which is why it is not in the page");
  assert.doesNotMatch(read("src/app/(dashboard)/layout.tsx"), /title:/);
  assert.equal(rootTemplate, "%s | FITX");
  assert.equal(NUTRITION_TITLE.template, rootTemplate, "the pages under Nutrition keep the root's suffix");
  assert.equal(sources, "Food data sources");
});

test("Nutrition reads \"Nutrition | FITX\" and Food data sources \"Food data sources | FITX\", worked out as Next does", () => {
  assert.equal(routeTitle([ROOT, DASHBOARD, NUTRITION_TITLE]), "Nutrition | FITX", "/nutrition (its client page sets none)");
  assert.equal(routeTitle([ROOT, DASHBOARD, NUTRITION_TITLE, sources]), "Food data sources | FITX", "/nutrition/sources");
  assert.equal(routeTitle([ROOT, DASHBOARD, "Nutrition", sources]), "Food data sources", "(the plain string title lost the suffix)");
});

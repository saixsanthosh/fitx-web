// Bug 72 (coach-help-9): Pricing offered "Create account" to a member who was already signed in, and pressing it only
// bounced to the dashboard. The page stays static: it renders both links and the head script's sign-in hint (the
// fitx_auth cookie, as the public header uses it) hides the one that doesn't fit before the first paint.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8");

test("the free account card offers Create account signed out and Open dashboard signed in", () => {
  const page = read("app/(marketing)/pricing/page.tsx");
  assert.match(page, /<Link href="\/signup" prefetch=\{false\} className="fitx-when-signed-out fitx-button[^"]*">\s*Create account\s*<\/Link>/);
  assert.match(page, /<Link href="\/dashboard" prefetch=\{false\} className="fitx-when-signed-in fitx-button[^"]*">\s*Open dashboard\s*<\/Link>/);
  assert.equal(page.match(/href="\/signup"/g)?.length, 1, "no other sign-up link on the page");
});

test("the page stays static: no session read, still rebuilt from the plans table", () => {
  const page = read("app/(marketing)/pricing/page.tsx");
  assert.doesNotMatch(page, /next\/headers|cookies\(\)|createClient|getUser|force-dynamic/);
  assert.match(page, /export const revalidate = 300;/);
});

test("the hint those classes follow is the one the public header uses", () => {
  const css = read("app/globals.css");
  assert.match(css, /:root:not\(\[data-fitx-auth="1"\]\) \.fitx-when-signed-in \{ display: none !important; \}/);
  assert.match(css, /:root\[data-fitx-auth="1"\] \.fitx-when-signed-out \{ display: none !important; \}/);
  assert.match(read("components/brand/introBootstrap.ts"), /if \(signedIn\) root\.setAttribute\("data-fitx-auth", "1"\)/);
  assert.match(read("components/layout/PublicHeader.tsx"), /Open dashboard/);
});

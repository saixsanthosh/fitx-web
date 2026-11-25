import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEGAL_NAV, PUBLIC_NAV } from "../../src/components/layout/publicNav.ts";

// Bug 95: Chrome logs "preloaded but not used" for other pages' stylesheets. Next 16 prefetches the routes of links
// in view and, with each prefetched route, preloads that route's stylesheets
// (next/dist/server/app-render/render-css-resource.js: every prefetch response carries a preload for each of the
// route's CSS files, also with experimental.inlineCss). So the rarely followed links stop prefetching; the main
// menu keeps it, by design, so its pages still open at once (its preloads are what remains in the console).
const source = (file: string) => readFileSync(file, "utf8");
const links = (text: string, href: string) => [...text.matchAll(new RegExp(`<Link href="${href}"[^>]*>`, "g"))].map((match) => match[0]);

test("the privacy banner's Cookie details link does not prefetch (it put the public pages' styles on every app page)", () => {
  const banner = links(source("src/components/layout/AnalyticsConsent.tsx"), "/cookies");
  assert.equal(banner.length, 1);
  assert.match(banner[0], /prefetch=\{false\}/);
});

test("sign-up and sign-in links on the public pages never prefetch (the sign-in pages' styles), as the header's never did", () => {
  const files = [
    "src/components/layout/PublicHeader.tsx",
    "src/components/layout/PublicMobileMenu.tsx",
    "src/app/(marketing)/features/page.tsx",
    "src/components/landing/FilmHero.tsx",
    "src/components/landing/VisionReel.tsx",
  ];
  let seen = 0;
  for (const file of files) {
    for (const link of [...links(source(file), "/signup"), ...links(source(file), "/signin")]) {
      seen += 1;
      assert.match(link, /prefetch=\{false\}/, `${file}: ${link}`);
    }
  }
  assert.ok(seen >= 7, `every one found (${seen})`);
  // The refund policy's link to the Subscription page (a signed-out visitor is sent on to sign-in).
  assert.match(links(source("src/app/(marketing)/refunds/page.tsx"), "/subscription")[0] ?? "", /prefetch=\{false\}/);
});

test("the footer's legal links load when pressed; its site links prefetch like the header's", () => {
  const footer = source("src/components/layout/PublicFooter.tsx");
  assert.match(footer, /const LEGAL = new Set<string>\(LEGAL_NAV\.map\(\(\{ href \}\) => href\)\);/);
  assert.match(footer, /prefetch=\{LEGAL\.has\(href\) \? false : undefined\}/);
  assert.deepEqual(LEGAL_NAV.map(({ href }) => href), ["/privacy", "/terms", "/cookies", "/refunds"]);
  assert.ok(PUBLIC_NAV.every(({ href }) => !LEGAL_NAV.some((legal) => legal.href === href)), "no site section is treated as a legal page");
});

test("the main menu still prefetches: the sidebar, the phone's bar and the public header's sections", () => {
  const sidebar = source("src/components/layout/Sidebar.tsx");
  const sideLink = sidebar.slice(sidebar.indexOf("function SideLink("));
  assert.doesNotMatch(sideLink, /prefetch=/);
  const bar = source("src/components/layout/BottomNav.tsx");
  assert.doesNotMatch(bar.slice(bar.indexOf("{PHONE_TABS.map("), bar.indexOf("<button ref={moreButton}")), /prefetch=/);
  const header = source("src/components/layout/PublicHeader.tsx");
  assert.match(header, /\{PUBLIC_NAV\.map\(\(\{ href, label \}\) => <Link key=\{href\} className="[^"]+" href=\{href\}>\{label\}<\/Link>\)\}/);
  // The logo links are the menu's Home: they keep prefetching too.
  for (const file of ["PublicHeader.tsx", "Sidebar.tsx", "WorkspaceHeader.tsx"]) {
    const logo = source(`src/components/layout/${file}`).match(/<Link href="\/(?:dashboard)?" aria-label="FITX home"[^>]*>/)?.[0] ?? "";
    assert.ok(logo && !logo.includes("prefetch"), file);
  }
});

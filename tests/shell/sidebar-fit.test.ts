import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACCOUNT_NAV, NAV_GROUPS } from "../../src/config/navigation.ts";

// Bug 73: the desktop sidebar needed 822 px of height (a 72 px logo row, the 485 px menu and a 265 px account block
// that never shrank: card, three links and Log out), so at 1366 x 768 Explore was cut off, at 1280 x 720 AI Coach
// and Explore, and on a 1366 x 768 laptop with Chrome's bars (641 px of page) everything after Nutrition, with no
// sign that the menu scrolled. The account is now one row whose menu opens above it.
const source = (file: string) => readFileSync(file, "utf8");
const sidebar = source("src/components/layout/Sidebar.tsx");
const menu = source("src/components/layout/AccountMenu.tsx");
const tokens = (classes: string) => classes.split(/\s+/);
const classOf = (text: string, pattern: RegExp) => text.match(pattern)?.[1] ?? "";

// The desktop sidebar's heights in px, as its classes draw them (checked against the source below).
const LOGO = 72; // h-[72px]
const ITEM = 44; // lg:min-h-11
const ITEM_GAP = 2; // space-y-0.5
const GROUP_GAP = 16; // lg:mt-4
const GROUP_LABEL = 10.5 * 1.5 + 6; // text-[10.5px] at the page's 1.5 line height (15.75 px), plus pb-1.5
const NAV_END = 12; // pb-3
const ACCOUNT_ROW = 1 + 8 + 56 + 8; // border-t, py-2 and the min-h-14 card

function sidebarHeight(accountBlock: number) {
  const menuHeight = NAV_GROUPS.reduce((total, group, index) => {
    const items = group.items.length * ITEM + (group.items.length - 1) * ITEM_GAP;
    return total + (index > 0 ? GROUP_GAP : 0) + (group.label ? GROUP_LABEL : 0) + items;
  }, 0) + NAV_END;
  // Rounded as the browser reports it (the three labels come to 65.25 px).
  return Math.round(LOGO + menuHeight + accountBlock);
}

test("the heights used here are the ones the sidebar's classes draw", () => {
  assert.ok(tokens(classOf(sidebar, /<Link href="\/dashboard" aria-label="FITX home" className="([^"]+)"/)).includes("h-[72px]"));
  const nav = tokens(classOf(sidebar, /<nav ref=\{nav\} aria-label="Main navigation" className="([^"]+)"/));
  for (const token of ["pb-3", "overflow-y-auto", "min-h-0", "flex-1"]) assert.ok(nav.includes(token), token);
  assert.match(sidebar, /index > 0 && "mt-3 border-t border-fitx-divider pt-3 lg:mt-4 lg:border-t-0 lg:pt-0"/);
  assert.match(sidebar, /<p id=\{`nav-group-\$\{group\.id\}`\} className="m-0 hidden px-3 pb-1\.5 text-\[10\.5px\]/);
  assert.match(sidebar, /<ul aria-labelledby=[^>]*className="space-y-0\.5">/);
  assert.ok(tokens(classOf(sidebar, /"fitx-nav-link group relative ([^"]+)"/)).includes("lg:min-h-11"));
  const footer = tokens(classOf(sidebar, /<div className="([^"]+)">\s*<AccountMenu summary=\{summary\} placement="sidebar" \/>/));
  for (const token of ["shrink-0", "border-t", "py-2", "lg:block", "hidden"]) assert.ok(footer.includes(token), token);
  assert.match(menu, /\? cn\("flex min-h-14 w-full items-center/, "the sidebar's account card is 56 px tall");
  // The model gives what the hunt measured for the old sidebar: 822 px with the 265 px account block.
  assert.equal(sidebarHeight(265), 822);
});

test("every section and the account fit without scrolling at 1280 x 720, 1366 x 768 and a 1366 x 768 laptop's 641 px", () => {
  const height = sidebarHeight(ACCOUNT_ROW);
  assert.equal(height, 630);
  for (const viewport of [641, 720, 768]) assert.ok(height <= viewport, `${height} px fits in ${viewport} px`);
  assert.equal(NAV_GROUPS.flatMap((group) => group.items).length, 8, "all eight sections are in the menu");
});

test("the account is one row at the foot; its menu holds Profile, Settings, Help and feedback, and Log out, above it", () => {
  assert.doesNotMatch(sidebar, /ACCOUNT_NAV|LogoutButton/, "no separate account links or Log out in the sidebar itself");
  assert.match(sidebar, /<AccountMenu summary=\{summary\} placement="sidebar" \/>/);
  assert.match(menu, /\{ACCOUNT_NAV\.map\(\(\{ href, label, icon: Icon \}\) => \{/);
  assert.match(menu, /<LogoutButton className="w-full" \/>/);
  assert.match(menu, /sidebar \? "inset-x-0 bottom-full mb-2" : "right-0 top-full mt-2 w-64"/, "opens upwards from the foot, downwards from the header");
  assert.deepEqual(ACCOUNT_NAV.map((item) => item.label), ["Profile", "Settings", "Help and feedback"]);
  // The page the member is on is marked in the panel, and the card shows it holds the current page.
  assert.match(menu, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(menu, /\(open \|\| onAccountPage\) && "bg-fitx-surface/);
  // Tablets: no account links on the rail (the header beside it has the same menu).
  assert.match(source("src/components/layout/WorkspaceHeader.tsx"), /<AccountMenu summary=\{summary\} \/>/);
});

test("on a shorter window the menu scrolls and shows that it does", () => {
  assert.ok(tokens(classOf(sidebar, /<nav ref=\{nav\} aria-label="Main navigation" className="([^"]+)"/)).includes("fitx-scroll-cue"));
  const globals = source("src/app/globals.css");
  const cue = globals.match(/^\.fitx-scroll-cue \{([^}]*)\}/m)?.[1] ?? "";
  assert.match(cue, /background-attachment: local, local, scroll, scroll;/, "two covers that scroll with the list, two shades fixed at its edges");
  assert.doesNotMatch(cue, /background:/, "longhands only: the list keeps its own background colour");
  // The same cue on the phone's More sheet and the public menu, whose panel is the elevated surface.
  for (const file of ["BottomNav.tsx", "PublicMobileMenu.tsx"]) assert.match(source(`src/components/layout/${file}`), /<div className="fitx-sheet__panel fitx-scroll-cue">/, file);
  const panel = globals.match(/^\.fitx-sheet__panel \{([^}]*)\}/m)?.[1] ?? "";
  assert.match(panel, /background-color: var\(--fitx-elevated\); --fitx-scroll-cue-bg: var\(--fitx-elevated\);/);
});

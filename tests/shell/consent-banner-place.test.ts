import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Bug 79, re-check of release 3. The privacy banner was centred in the window (at most 768 px wide, 24 px from each
// edge). The desktop sidebar is sticky and one window tall, its account card at its foot, so from 1024 px to about
// 1250 px wide the banner lay over the card and no scrolling could move the card clear: at 1024 x 768, banner
// x 128-896 over the focused card x 12-235 (39% of it hidden). The banner now centres over the page beside the
// app's menu column (the rail from 768 px, the sidebar from 1024 px), where the scroll padding keeps controls clear.
const source = (file: string) => readFileSync(file, "utf8");
const globals = source("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
const sidebar = source("src/components/layout/Sidebar.tsx");
const banner = source("src/components/layout/AnalyticsConsent.tsx");

const BANNER_MAX = 768; // max-w-3xl

/** The banner's left and right edges in a window `width` px wide, beside a menu column `menu` px wide (0: none). */
function bannerBox(width: number, menu: number) {
  const gutter = width >= 640 ? 24 : 12;
  const start = menu + gutter;
  const end = width - gutter;
  const box = Math.min(BANNER_MAX, end - start);
  const left = start + (end - start - box) / 2; // mx-auto between left and right
  return { left, right: left + box };
}

/** The menu column's width at a window width, as Sidebar.tsx and --fitx-menu-width draw it (no notch). */
const menuWidth = (width: number) => (width >= 1024 ? 248 : width >= 768 ? 88 : 0);

test("the old banner lay over the sidebar's foot from 1024 to 1263 px; now it keeps beside the column", () => {
  // As the re-check measured it: centred in the window, 128-896 at 1024 px, over the card (12-235).
  assert.deepEqual(bannerBox(1024, 0), { left: 128, right: 896 });
  const overlapsOld = (width: number) => bannerBox(width, 0).left < menuWidth(width);
  assert.ok(overlapsOld(1024) && overlapsOld(1100) && overlapsOld(1200) && overlapsOld(1263));
  assert.ok(!overlapsOld(1264), "from about 1250 px the old banner cleared the sidebar");

  for (let width = 320; width <= 2560; width += 1) {
    const menu = menuWidth(width);
    const { left, right } = bannerBox(width, menu);
    assert.ok(left >= menu + 12, `${width} px: the banner starts beside the column`);
    assert.ok(right <= width - 12, `${width} px: and stays inside the window`);
    assert.ok(right - left >= 296, `${width} px: still wide enough for its text and two buttons`);
  }
  assert.deepEqual(bannerBox(1024, 248), { left: 272, right: 1000 }, "1024 px: 728 px wide, right of the sidebar");
  assert.deepEqual(bannerBox(1440, 248), { left: 460, right: 1228 }, "wide windows: centred over the page");
  assert.deepEqual(bannerBox(390, 0), { left: 12, right: 378 }, "phones: as before");
  // Pages without the column (public pages, sign-in, setup) keep it centred in the window, as the re-check measured
  // on setup at 1440 x 900 (336-1104).
  assert.deepEqual(bannerBox(1440, 0), { left: 336, right: 1104 });
});

test("globals.css places the banner beside the menu column while it shows, and nowhere else", () => {
  const consent = [...globals.matchAll(/^\s*\.fitx-consent \{([^}]*)\}/gm)].map((match) => match[1]);
  assert.equal(consent.length, 2, "phones, and from 640 px");
  assert.match(consent[0], /left: calc\(var\(--fitx-menu-inset, 0px\) \+ 12px\); right: 12px;/);
  assert.match(consent[1], /left: calc\(var\(--fitx-menu-inset, 0px\) \+ 24px\); right: 24px;/);
  assert.match(globals, /@media \(min-width: 640px\) \{\s*\.fitx-consent \{/);

  // The column's width: one variable, which the sidebar draws itself with.
  assert.match(globals, /^:root \{ --fitx-menu-width: calc\(88px \+ env\(safe-area-inset-left\)\); \}$/m);
  assert.match(globals, /@media \(min-width: 1024px\) \{\s*:root \{ --fitx-menu-width: calc\(248px \+ env\(safe-area-inset-left\)\); \}\s*\}/);
  const aside = sidebar.match(/<aside data-coach-edge="" className="([^"]+)"/)?.[1].split(/\s+/) ?? [];
  for (const token of ["fitx-menu-column", "w-[var(--fitx-menu-width)]", "hidden", "md:flex", "fitx-app-only"]) assert.ok(aside.includes(token), token);
  assert.ok(!aside.some((token) => /^(lg:|md:)?w-\[calc/.test(token)), "no second width to drift from the variable");

  // Its reach into the screen: only while it shows (md, 768 px, is where md:flex shows it), and not in setup mode,
  // where .fitx-app-only hides it. Same specificity, so the setup rule must come later.
  const shows = globals.search(/@media \(min-width: 768px\) \{\s*:root:has\(\.fitx-menu-column\) \{ --fitx-menu-inset: var\(--fitx-menu-width\); \}\s*\}/);
  const setup = globals.search(/^:root:has\(\[data-fitx-setup\]\) \{ --fitx-menu-inset: 0px; \}$/m);
  assert.ok(shows >= 0 && setup > shows);
  assert.match(globals, /^:root:has\(\[data-fitx-setup\]\) \.fitx-app-only \{ display: none !important; \}$/m);
  assert.equal((globals.match(/--fitx-menu-inset:/g) ?? []).length, 2, "nothing else sets it");

  // Nothing in the banner's own classes fights the rule (unlayered, it would win anyway; no dead utilities).
  const classes = banner.match(/<aside ref=\{banner\}[^>]*className="([^"]+)"/)?.[1].split(/\s+/) ?? [];
  assert.ok(classes.includes("fitx-consent") && classes.includes("mx-auto") && classes.includes("max-w-3xl"));
  assert.ok(!classes.some((token) => /^(sm:|md:|lg:)?(inset-x|inset|left|right|start|end)-/.test(token)), classes.join(" "));
});

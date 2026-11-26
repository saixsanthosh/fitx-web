import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BOTTOM_INSET_EVENT, BOTTOM_INSETS, bottomInset, fixedAreaHeight, insetValue, trackBottomInset, type InsetBox, type InsetHost } from "../../src/components/layout/bottom-inset.ts";

// Bugs 12 and 79: on phones a control reached with Tab ended up behind the fixed bottom bar (html kept only
// scroll-padding-top), and while the privacy banner was open it covered the focused control, even at the end of
// the page where no scrolling could help. Each bar now measures what it hides and globals.css keeps that clear.
const source = (file: string) => readFileSync(file, "utf8");
const css = (file: string) => source(file).replace(/\/\*[\s\S]*?\*\//g, "");

test("what a bar hides: from its top edge to the bottom of the viewport, none when it isn't shown", () => {
  // The hunt's numbers: the phone bar at 390 x 844 (top 777, 67 tall) and the banner at 1440 x 900 (770 to 876).
  assert.equal(bottomInset({ top: 777, width: 390, height: 67 }, 844), 67);
  assert.equal(bottomInset({ top: 770, width: 768, height: 106 }, 900), 130, "the 24 px gap under the banner counts");
  assert.equal(bottomInset({ top: 776.4, width: 390, height: 67.6 }, 844), 68, "rounded up, never short");
  assert.equal(bottomInset({ top: 0, width: 0, height: 0 }, 844), 0, "display: none (the bar at 768 px and up)");
  assert.equal(bottomInset(null, 844), 0);
  assert.equal(bottomInset({ top: 900, width: 390, height: 67 }, 844), 0, "wholly below the screen");
  assert.equal(bottomInset({ top: -40, width: 390, height: 2000 }, 844), 844, "never more than the screen");
  assert.equal(bottomInset({ top: 777, width: 390, height: 67 }, 0), 0);
  assert.equal(insetValue(67), "67px");
  assert.equal(insetValue(0), null);
  assert.equal(insetValue(Number.NaN), null);
});

/**
 * A page stand-in: <html>'s style, the window's events and frames, and the element's size watcher. `clientHeight` is
 * <html>'s, which a phone keeps at its toolbar-shown height while innerHeight grows as the URL bar hides.
 */
function fakePage(height: number, clientHeight = height) {
  const style = new Map<string, string>();
  const frames: Array<() => void> = [];
  const resizers: Array<() => void> = [];
  const view = Object.assign(new EventTarget(), {
    innerHeight: height,
    requestAnimationFrame: (callback: FrameRequestCallback) => frames.push(() => callback(0)),
    cancelAnimationFrame: () => undefined,
  });
  const host: InsetHost = {
    root: { clientHeight, style: { setProperty: (name, value) => style.set(name, value), removeProperty: (name) => style.delete(name) } },
    view: view as unknown as InsetHost["view"],
    watchSize: (_element, onResize) => {
      resizers.push(onResize);
      return () => resizers.splice(resizers.indexOf(onResize), 1);
    },
  };
  const flush = () => frames.splice(0).forEach((frame) => frame());
  return { style, host, view, resizers, flush };
}

test("a bar keeps its variable on <html> while it is in the page, through resizes, and removes it when it goes", () => {
  const page = fakePage(844);
  let box: InsetBox = { top: 777, width: 390, height: 67 };
  const stop = trackBottomInset({ getBoundingClientRect: () => box }, "bar", page.host);
  assert.equal(page.style.get(BOTTOM_INSETS.bar), "67px", "set at once, before the first paint");
  box = { top: 0, width: 0, height: 0 };
  page.resizers.forEach((resize) => resize());
  page.flush();
  assert.equal(page.style.has(BOTTOM_INSETS.bar), false, "hidden at a wider size: nothing to keep clear");
  box = { top: 760, width: 390, height: 84 };
  page.view.dispatchEvent(new Event("resize"));
  page.flush();
  assert.equal(page.style.get(BOTTOM_INSETS.bar), "84px");
  stop();
  assert.equal(page.style.has(BOTTOM_INSETS.bar), false, "removed with the bar (a focus screen, a choice made)");
  assert.equal(page.resizers.length, 0);
});

test("the banner above the phone's bar measures itself again when the bar comes or goes", () => {
  const page = fakePage(844);
  let banner: InsetBox = { top: 640, width: 366, height: 192 };
  const announced: string[] = [];
  page.view.addEventListener(BOTTOM_INSET_EVENT, (event) => announced.push((event as CustomEvent<{ name: string }>).detail.name));
  const stopBanner = trackBottomInset({ getBoundingClientRect: () => banner }, "consent", page.host);
  assert.equal(page.style.get(BOTTOM_INSETS.consent), "204px");
  // The bar appears below it; the banner, sitting on top of the bar, moves up without changing size.
  banner = { top: 565, width: 366, height: 192 };
  const stopBar = trackBottomInset({ getBoundingClientRect: () => ({ top: 777, width: 390, height: 67 }) }, "bar", page.host);
  page.flush();
  assert.equal(page.style.get(BOTTOM_INSETS.bar), "67px");
  assert.equal(page.style.get(BOTTOM_INSETS.consent), "279px", "the banner followed the bar");
  assert.deepEqual(announced, ["consent", "bar", "consent"]);
  page.flush();
  assert.deepEqual(announced, ["consent", "bar", "consent"], "no echo once nothing changes");
  stopBar();
  stopBanner();
  assert.equal(page.style.size, 0);
});

// Review of bug 12: the bar is fixed in an area that grows when a phone's URL bar or toolbar collapses (it moves down
// with it), but <html>'s clientHeight keeps the toolbar-shown height. Measured against that, the inset shrank by the
// URL bar's height on every resize the collapse fires, and with it the scroll padding, so Tab again left controls
// under the bar on a real phone (the emulated 390 x 844 re-check can't show it: there both heights are the same).
test("a phone's URL bar hiding: the bar and the banner above it keep their whole inset", () => {
  // The reviewer's case: the area is 900 px with the URL bar hidden, <html> still says 844, the bar's top is at 833.
  const hidden = fakePage(900, 844);
  const stopHidden = trackBottomInset({ getBoundingClientRect: () => ({ top: 833, width: 390, height: 67 }) }, "bar", hidden.host);
  assert.equal(hidden.style.get(BOTTOM_INSETS.bar), "67px", "not 11 px");
  stopHidden();

  // Chrome for Android at 390 x 844: open with the URL bar shown, then a touch scroll hides it (56 px) and the
  // window's resize measures again. The banner floats above the bar and moves down with it too.
  const page = fakePage(844);
  let bar: InsetBox = { top: 777, width: 390, height: 67 };
  let banner: InsetBox = { top: 565, width: 366, height: 192 };
  const stopBar = trackBottomInset({ getBoundingClientRect: () => bar }, "bar", page.host);
  const stopBanner = trackBottomInset({ getBoundingClientRect: () => banner }, "consent", page.host);
  assert.equal(page.style.get(BOTTOM_INSETS.bar), "67px");
  assert.equal(page.style.get(BOTTOM_INSETS.consent), "279px");
  page.view.innerHeight = 900;
  bar = { top: 833, width: 390, height: 67 };
  banner = { top: 621, width: 366, height: 192 };
  page.view.dispatchEvent(new Event("resize"));
  page.flush();
  assert.equal(page.style.get(BOTTOM_INSETS.bar), "67px", "the bar still hides 67 px");
  assert.equal(page.style.get(BOTTOM_INSETS.consent), "279px", "and the banner 279 px");
  stopBanner();
  stopBar();

  // iOS-like numbers: the toolbar collapses by 81 px, more than the bar is tall. Against clientHeight the bar would
  // hide nothing at all and its variable would go.
  const ios = fakePage(745, 664);
  const stopIos = trackBottomInset({ getBoundingClientRect: () => ({ top: 678, width: 390, height: 67 }) }, "bar", ios.host);
  assert.equal(ios.style.get(BOTTOM_INSETS.bar), "67px");
  assert.equal(bottomInset({ top: 678, width: 390, height: 67 }, 664), 0, "what the old measure gave");
  stopIos();
});

test("the area a bar is fixed in is the larger of innerHeight and <html>'s clientHeight", () => {
  assert.equal(fixedAreaHeight(900, 844), 900, "the URL bar or toolbar has collapsed: innerHeight");
  assert.equal(fixedAreaHeight(520, 844), 844, "a pinch zoom or the keyboard shrinks the visual viewport; the bar stays put");
  assert.equal(fixedAreaHeight(915, 900), 915, "a desktop's horizontal scrollbar: a slightly larger inset, harmless");
  assert.equal(fixedAreaHeight(0, 844), 844);
  assert.equal(fixedAreaHeight(Number.NaN, 844), 844);
  assert.equal(fixedAreaHeight(900, 0), 900);
  assert.equal(fixedAreaHeight(0, 0), 0);
  // What the old measure gave with the reviewer's numbers, and what the bar really hides.
  assert.equal(bottomInset({ top: 833, width: 390, height: 67 }, 844), 11);
  assert.equal(bottomInset({ top: 833, width: 390, height: 67 }, fixedAreaHeight(900, 844)), 67);
  // The tracker measures against it.
  assert.match(source("src/components/layout/bottom-inset.ts"), /bottomInset\(element\.getBoundingClientRect\(\), fixedAreaHeight\(view\.innerHeight, root\.clientHeight\)\)/);
});

test("globals.css keeps the larger of the two clear when scrolling to a control, with room for the focus ring", () => {
  const globals = css("src/app/globals.css");
  const html = globals.match(/^html \{([^}]*)\}/m)?.[1] ?? "";
  assert.match(html, /scroll-padding-top: 84px;/, "the sticky header, as before");
  // The bottom room is one variable, so what keeps clear of it (the coach's end marker) reads the same value.
  assert.match(html, /--fitx-scroll-room-bottom: calc\(max\(var\(--fitx-inset-bottom-bar, 0px\), var\(--fitx-inset-consent, 0px\)\) \+ 12px\);/);
  assert.match(html, /scroll-padding-bottom: var\(--fitx-scroll-room-bottom\);/);
  const body = globals.match(/^body \{([^}]*)\}/m)?.[1] ?? "";
  assert.match(body, /padding-bottom: var\(--fitx-inset-consent, 0px\);/, "room at the page's end while the banner is open");
  // The public footer's dark band takes that room inside itself, so no light strip shows below it (the app's frame,
  // the onboarding frame and the status screens do the same: end-room.test.ts).
  assert.match(globals, /^\.fitx-holds-end-room \{ margin-bottom: calc\(-1 \* var\(--fitx-inset-consent, 0px\)\); \}/m);
  assert.match(globals, /^\.fitx-band-end \{ padding-bottom: calc\(env\(safe-area-inset-bottom\) \+ var\(--fitx-inset-consent, 0px\)\); \}/m);
  assert.match(source("src/app/(marketing)/layout.tsx"), /className="fitx-holds-end-room flex min-h-dvh flex-col"><PublicHeader\/>\{children\}<PublicFooter\/>/);
  assert.match(source("src/components/layout/PublicFooter.tsx"), /<footer className="fitx-inverse fitx-band-end /);
  // The banner floats above the phone's bar, so the bar's links are never under it.
  // (Beside the app's menu column too: consent-banner-place.test.ts.)
  assert.match(globals, /^\.fitx-consent \{[^}]* bottom: max\(calc\(var\(--fitx-inset-bottom-bar, 0px\) \+ 8px\), env\(safe-area-inset-bottom\), 12px\); \}/m);
});

test("the phone's bar and the privacy banner each measure themselves", () => {
  const nav = source("src/components/layout/BottomNav.tsx");
  assert.match(nav, /const bar = useBottomInsetRef\("bar"\);/);
  assert.match(nav, /<nav ref=\{bar\} aria-label="Main navigation"/);
  // Declared with the other hooks, before the focus screens return nothing (the ref then cleans up by itself).
  assert.ok(nav.indexOf('useBottomInsetRef("bar")') < nav.indexOf("if (FOCUS_SCREENS.has(pathname)) return null;"));
  const banner = source("src/components/layout/AnalyticsConsent.tsx");
  assert.match(banner, /const banner = useBottomInsetRef\("consent"\);/);
  const aside = banner.match(/<aside ref=\{banner\}[^>]*className="([^"]+)"/)?.[1] ?? "";
  assert.ok(aside.split(/\s+/).includes("fitx-consent"), "placed by .fitx-consent");
  assert.ok(!aside.split(/\s+/).some((token) => /^(sm:)?bottom-/.test(token)), "no bottom utility left to fight it");
});

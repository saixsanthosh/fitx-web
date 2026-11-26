// Round 3d re-check (reg-3d-workouts-b-finish-message-under-rest): on a desktop, Finish workout's reason ("This session
// was already closed or could not be completed. Reload to check its status.") showed in the bar's second row, under
// Abandon and Finish workout, and the floating rest timer covered its middle (1280 × 720: the reason at y 636-674, the
// timer at x 416-864, y 526-684). Abandon's reason used the same place. The reason now shows right above the buttons at
// every width, and the bar is brought into view clear of the page's own bars at the window's foot (the rest timer, a
// phone's Previous and Next), over html's scroll padding for the privacy banner. The page is JSX, which `node --test`
// cannot render: the decisions are pure (foot-clearance.ts) and the wiring is read from the source.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FOOT_ROOM, footHidden, footMargin, revealAboveFoot, type FootBar, type FootPage } from "@/app/(dashboard)/workouts/active/_lib/foot-clearance";

const page = readFileSync("src/app/(dashboard)/workouts/active/page.tsx", "utf8");
const dock = readFileSync("src/components/session/RestDock.tsx", "utf8");

/** A box as getBoundingClientRect gives it. */
const box = (top: number, height: number, width = 448) => ({ top, height, width });
const shown = (top: number, height: number, width?: number): FootBar => ({ getBoundingClientRect: () => box(top, height, width) });

/**
 * Where the browser's scrollIntoView({ block: "nearest" }) moves the window for a box (CSSOM View): the scrollport less
 * html's scroll padding and the element's scroll margins. Returns how far the page scrolls down (negative: up).
 */
function nearestScroll(rect: { top: number; bottom: number }, viewport: number, topRoom: number, bottomRoom: number): number {
  const top = topRoom;
  const bottom = viewport - bottomRoom;
  const fits = rect.bottom - rect.top <= bottom - top;
  if (rect.top < top && rect.bottom > bottom) return 0;
  if ((rect.top < top && fits) || (rect.bottom > bottom && !fits)) return rect.top - top;
  if ((rect.top < top && !fits) || (rect.bottom > bottom && fits)) return rect.bottom - bottom;
  return 0;
}

describe("what the page's bars hide at the window's foot", () => {
  test("nothing when no bar is drawn, or one is hidden at that width (Previous and Next from 640 px)", () => {
    assert.equal(footHidden([], 720), 0);
    assert.equal(footHidden([null, null], 720), 0);
    assert.equal(footHidden([box(0, 0, 0)], 720), 0, "display: none has no size");
    assert.equal(footHidden([box(800, 60)], 720), 0, "below the window");
  });

  test("from the highest top edge down to the window's bottom", () => {
    assert.equal(footHidden([box(526, 158)], 720), 194, "the re-check's desktop: the rest timer at y 526");
    // A phone resting: the timer rides 72 px over Previous and Next, so its top edge is the higher one.
    assert.equal(footHidden([box(614, 146, 366), box(784, 48, 366)], 844), 230);
    assert.equal(footHidden([null, box(784, 48, 366)], 844), 60, "a phone with no rest running: Previous and Next");
  });
});

describe("the scroll margin that clears them", () => {
  test("none when no bar shows", () => {
    for (const padding of [0, 12, 166, Number.NaN]) assert.equal(footMargin(0, padding), 0);
  });

  test("only what goes beyond html's scroll padding: together they stop FOOT_ROOM px above the bars", () => {
    assert.equal(FOOT_ROOM, 12);
    assert.equal(footMargin(194, 12), 194, "the banner closed: html keeps 12 px");
    // The banner open (154 px from its top edge to the window's bottom): html keeps 166 px, the timer sits 8 px above
    // the banner, so it hides 154 + 8 + 158; the margin asks for the rest, never the banner's room twice.
    const hidden = 154 + 8 + 158;
    const margin = footMargin(hidden, 154 + 12);
    assert.equal(margin + 154 + 12, hidden + FOOT_ROOM);
    assert.equal(footMargin(40, 166), 0, "the padding already clears them");
    assert.equal(footMargin(100.2, 12), 101, "whole px, rounded up");
    assert.equal(footMargin(194, Number.NaN), 206, "padding unreadable: counted as none, so the bar clears them all the same");
  });
});

describe("bringing the bar into view", () => {
  const body = { tag: "body" };
  const button = { tag: "button" };
  const header = { tag: "a" };
  /** A stand-in bar: its scroll margin when the browser was asked to bring it into view, and each request. */
  const bar = () => {
    const calls: Array<{ block: string; margin: string }> = [];
    const element = {
      style: { scrollMarginBottom: "" },
      contains: (node: unknown) => node === button,
      scrollIntoView: (options: { block: "nearest" }) => { calls.push({ block: options.block, margin: element.style.scrollMarginBottom }); },
    };
    return { element, calls };
  };
  const desk = (activeElement: unknown, padding = 12): FootPage => ({ activeElement, body, viewportHeight: 720, scrollPadding: padding });

  test("with focus still on Finish workout or Abandon, it asks for the margin first, then the nearest scroll", () => {
    const { element, calls } = bar();
    assert.equal(revealAboveFoot(element, [shown(526, 158), shown(0, 0, 0)], desk(button)), true);
    assert.deepEqual(calls, [{ block: "nearest", margin: "194px" }]);
  });

  test("with focus lost (a click that does not focus, as in Safari), it does the same", () => {
    const { element, calls } = bar();
    assert.equal(revealAboveFoot(element, [shown(526, 158)], desk(body)), true);
    assert.deepEqual(calls, [{ block: "nearest", margin: "194px" }]);
    const nothing = bar();
    assert.equal(revealAboveFoot(nothing.element, [shown(526, 158)], desk(null)), true);
  });

  test("with focus moved elsewhere while it saved (the header, say), the page stays where the member put it", () => {
    const { element, calls } = bar();
    assert.equal(revealAboveFoot(element, [shown(526, 158)], desk(header)), false);
    assert.deepEqual(calls, []);
    assert.equal(element.style.scrollMarginBottom, "", "nothing changed");
  });

  test("no rest running on a desktop: no margin beyond html's padding (the banner's room is html's)", () => {
    const { element, calls } = bar();
    revealAboveFoot(element, [null, shown(0, 0, 0)], desk(button, 166));
    assert.deepEqual(calls, [{ block: "nearest", margin: "0px" }]);
  });

  test("the re-check's case ends with the reason and the buttons clear of the rest timer, under the header", () => {
    // 1280 × 720: the bar now holds the reason (38 px) over the totals and buttons (48 px) in its 16 px padding, from
    // y 560; the timer's top edge is at 526. html: 84 px kept at the top (the header), 12 at the bottom.
    const { element, calls } = bar();
    revealAboveFoot(element, [shown(526, 158)], desk(button));
    const margin = Number.parseInt(calls[0].margin, 10);
    const rect = { top: 560, bottom: 560 + 16 + 38 + 12 + 48 + 16 };
    const moved = nearestScroll(rect, 720, 84, 12 + margin);
    assert.ok(moved > 0, "the page scrolls down");
    assert.equal(rect.bottom - moved, 526 - FOOT_ROOM, "its bottom stops 12 px above the timer");
    assert.ok(rect.top - moved >= 84, "its top is still under the header's room");
    // A bar already clear of the timer does not move.
    assert.equal(nearestScroll({ top: 300, bottom: 430 }, 720, 84, 12 + margin), 0);
  });

  test("a phone resting with the banner open: still clear of the timer, Previous and Next and the banner", () => {
    // 390 × 844; the banner reaches 212 px up, Previous and Next sit 8 px above it, the timer 72 px above them.
    const consent = 212;
    const stepTop = 844 - (consent + 8) - 48;
    const timerTop = 844 - (consent + 8 + 72) - 146;
    const { element, calls } = bar();
    revealAboveFoot(element, [shown(timerTop, 146, 366), shown(stepTop, 48, 366)], { activeElement: button, body, viewportHeight: 844, scrollPadding: consent + 12 });
    const margin = Number.parseInt(calls[0].margin, 10);
    // The bar on a phone: the totals, the reason (three lines), Finish workout and Abandon, stacked (236 px).
    const rect = { top: 600, bottom: 836 };
    const moved = nearestScroll(rect, 844, 84, consent + 12 + margin);
    assert.equal(rect.bottom - moved, timerTop - FOOT_ROOM);
    assert.ok(rect.top - moved >= 84);
  });
});

describe("the page: the reason right above the buttons, the bar brought clear (JSX, read from the source)", () => {
  const start = page.indexOf("Finish and Abandon say why");
  const bar = page.slice(start, page.indexOf("</section>", start));
  const children = bar.split("\n").filter((line) => /^\s+(?:<p |\{problem\?\.at === "finish"|<div )/.test(line));

  test("the bar's three parts, in reading order: the totals, the reason, then Abandon and Finish workout", () => {
    assert.equal(children.length, 3, children.join("\n"));
    assert.match(children[0], /<span>\{tally\}<\/span>/);
    assert.match(children[1], /^\s+\{problem\?\.at === "finish" && <p role="alert" className=\{`sm:order-first sm:col-span-2 \$\{PROBLEM_CLASS\}`\}>\{problem\.message\}<\/p>\}$/);
    assert.match(children[2], /void abandonWorkout\(\)[\s\S]*void finishWorkout\(\)/);
  });

  test("on a phone (one column) the reason is directly above Finish workout, which tops the stacked buttons", () => {
    assert.match(children[2], /^\s+<div className="flex flex-col-reverse gap-2 sm:flex-row">/);
  });

  test("from 640 px the reason takes a row of its own first; the totals and the buttons share the row under it", () => {
    assert.match(bar, /<section ref=\{finishBarRef\} className="fitx-panel grid gap-3 p-4 sm:grid-cols-\[minmax\(0,1fr\)_auto\] sm:items-center">/);
    // Placed by the grid in order: the reason first (order-first) across both columns, then the totals and the buttons
    // in the next row. No part pins a row or a column, which is what put the reason under the buttons.
    assert.doesNotMatch(bar, /sm:(?:row|col)-(?:start|end)-/);
    assert.doesNotMatch(children[0], /order-/);
    assert.doesNotMatch(children[2], /order-/);
  });

  test("when Finish workout or Abandon gives a reason, the bar is brought clear of the rest timer and Previous and Next", () => {
    assert.match(page, /import \{ browserFootPage, footBarRef, revealAboveFoot \} from "\.\/_lib\/foot-clearance";/);
    assert.match(page, /useEffect\(\(\) => \{\n\s+if \(problem\?\.at === "finish" && finishBarRef\.current\) revealAboveFoot\(finishBarRef\.current, \[restDockRef\.current, stepBarRef\.current\], browserFootPage\(\)\);\n\s+\}, \[problem\]\);/);
    // Through refs that also keep html's scroll padding clear of the two bars (active-bars-scroll-padding.test.ts).
    assert.match(page, /\{resting && <RestDock ref=\{restDockAttach\} /);
    assert.match(page, /<div ref=\{stepBarAttach\} className="fixed inset-x-3 bottom-\[[^\]]+\] z-30 mx-auto grid max-w-md grid-cols-2 gap-2 sm:hidden">/);
    assert.match(page, /const restDockAttach = useMemo\(\(\) => footBarRef\(restDockRef, /);
    assert.match(page, /const stepBarAttach = useMemo\(\(\) => footBarRef\(stepBarRef, /);
    // Both ways a reason arrives (a refusal or a failure of Finish workout, a failure of Abandon) set a new problem.
    assert.ok((page.match(/setProblem\(\{ at: "finish"/g) ?? []).length >= 4);
  });

  test("the rest timer passes its ref to its own region; its place at the foot is the integrator's (7fe3ddb), unchanged", () => {
    assert.match(dock, /import type \{ Ref \} from "react";/);
    assert.match(dock, /ref\?: Ref<HTMLElement>;/);
    assert.match(dock, /export function RestDock\(\{ remaining, total, upNext, onAdjust, onSkip, ref \}: RestDockProps\)/);
    assert.match(dock, /<section role="timer" aria-label="Rest timer" ref=\{ref\} className="fitx-panel fixed inset-x-3 bottom-\[max\(calc\(env\(safe-area-inset-bottom\)\+5\.25rem\),calc\(var\(--fitx-inset-consent,0px\)\+8px\+4\.5rem\)\)\] z-40 [^"]*sm:bottom-\[max\(1rem,calc\(var\(--fitx-inset-consent,0px\)\+8px\)\)\]/);
  });

  test("the buttons keep their busy rule (aria-disabled, never disabled while saving) and focus is never moved", () => {
    assert.match(children[2], /<button type="button" disabled=\{paused\} aria-disabled=\{saving \|\| clockSaving \|\| undefined\} onClick=\{\(\) => void finishWorkout\(\)\}/);
    const clearance = readFileSync("src/app/(dashboard)/workouts/active/_lib/foot-clearance.ts", "utf8");
    assert.doesNotMatch(clearance, /\.focus\(/);
    assert.doesNotMatch(clearance, /behavior:/, "the page's own scroll-behavior decides (smooth, or none for reduced motion or keyboard focus)");
  });
});

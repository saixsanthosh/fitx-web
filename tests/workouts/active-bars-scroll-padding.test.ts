// Release 3 fix round 3f (open-3e-active-bars-scroll-padding, open item 1 of round 3e). On the live workout, Tab could
// leave a control under the rest timer or, on a phone, under Previous and Next: the browser's focus scroll keeps clear
// only what html's scroll padding names, and that named the shell's phone bar and the privacy banner, not these two
// bars of the page's own (at 768 × 1024 while resting, Tab to Finish workout could stop it partly under the timer).
// While they show, the two bars now set a third inset of the shell's ("foot", --fitx-inset-page-foot) that only html's
// scroll padding reads; with neither showing, nothing changes. The page is JSX, which `node --test` cannot render, so
// its wiring is read from the source; the tracker and the ref are pure and run here on stand-ins.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { BOTTOM_INSETS, BOTTOM_INSET_EVENT, trackBottomInset, type InsetBox, type InsetHost } from "@/components/layout/bottom-inset";
import { footBarRef } from "@/app/(dashboard)/workouts/active/_lib/foot-clearance";

const source = (file: string) => readFileSync(file, "utf8");
const css = (file: string) => source(file).replace(/\/\*[\s\S]*?\*\//g, "");
const page = source("src/app/(dashboard)/workouts/active/page.tsx");
const FOOT = "--fitx-inset-page-foot";

/** <html>'s style, the window's events and frames, and the elements' size watchers (as tests/shell does). */
function fakePage(height: number) {
  const style = new Map<string, string>();
  const frames: Array<() => void> = [];
  const resizers: Array<() => void> = [];
  const view = Object.assign(new EventTarget(), {
    innerHeight: height,
    requestAnimationFrame: (callback: FrameRequestCallback) => frames.push(() => callback(0)),
    cancelAnimationFrame: () => undefined,
  });
  const host: InsetHost = {
    root: { clientHeight: height, style: { setProperty: (name, value) => style.set(name, value), removeProperty: (name) => style.delete(name) } },
    view: view as unknown as InsetHost["view"],
    watchSize: (_element, onResize) => {
      resizers.push(onResize);
      return () => resizers.splice(resizers.indexOf(onResize), 1);
    },
  };
  const flush = () => frames.splice(0).forEach((frame) => frame());
  const resize = () => { view.dispatchEvent(new Event("resize")); flush(); };
  return { style, host, view, flush, resize };
}

/** A bar whose box the test moves. */
const bar = (box: InsetBox) => {
  const element = { box, getBoundingClientRect: () => element.box };
  return element;
};
const HIDDEN: InsetBox = { top: 0, width: 0, height: 0 };

describe("the third inset: a page's own bars over its foot", () => {
  test("its own variable, beside the phone's bar and the banner (unchanged)", () => {
    assert.deepEqual(BOTTOM_INSETS, { bar: "--fitx-inset-bottom-bar", consent: "--fitx-inset-consent", foot: FOOT });
  });

  test("a phone resting: the rest timer and Previous and Next both set it, and it holds the most either hides", () => {
    // 390 × 844: Previous and Next 12 px up (48 tall), the timer 84 px up (146 tall).
    const view = fakePage(844);
    const steps = bar({ top: 784, width: 366, height: 48 });
    const stopSteps = trackBottomInset(steps, "foot", view.host);
    assert.equal(view.style.get(FOOT), "60px", "no rest: Previous and Next");
    const timer = bar({ top: 614, width: 366, height: 146 });
    const stopTimer = trackBottomInset(timer, "foot", view.host);
    assert.equal(view.style.get(FOOT), "230px", "resting: the timer's top edge is the higher");
    // Previous and Next measuring again (a resize) does not take the timer's room away.
    view.resize();
    assert.equal(view.style.get(FOOT), "230px");
    stopTimer();
    assert.equal(view.style.get(FOOT), "60px", "the rest is over: Previous and Next's room is left, not nothing");
    stopSteps();
    assert.equal(view.style.has(FOOT), false, "the page left: nothing kept");
  });

  test("the order the bars come in does not matter, and a bar's own change is followed", () => {
    const view = fakePage(844);
    const timer = bar({ top: 614, width: 366, height: 146 });
    const steps = bar({ top: 784, width: 366, height: 48 });
    const stopTimer = trackBottomInset(timer, "foot", view.host);
    const stopSteps = trackBottomInset(steps, "foot", view.host);
    assert.equal(view.style.get(FOOT), "230px");
    // The privacy banner opens (212 px from its top edge to the window's bottom): both bars rise above it.
    timer.box = { top: 844 - (212 + 8 + 72) - 146, width: 366, height: 146 };
    steps.box = { top: 844 - (212 + 8) - 48, width: 366, height: 48 };
    view.view.dispatchEvent(new CustomEvent(BOTTOM_INSET_EVENT, { detail: { name: "consent" } }));
    view.flush();
    assert.equal(view.style.get(FOOT), `${212 + 8 + 72 + 146}px`, "the banner's change makes them measure again");
    stopSteps();
    stopTimer();
    assert.equal(view.style.size, 0);
  });

  test("from 640 px Previous and Next are hidden: only the timer counts, and with no rest nothing is kept", () => {
    // 768 × 1024: the timer 16 px up (152 tall); Previous and Next display: none.
    const view = fakePage(1024);
    const steps = bar(HIDDEN);
    const stopSteps = trackBottomInset(steps, "foot", view.host);
    assert.equal(view.style.has(FOOT), false, "neither shows: nothing changes");
    const timer = bar({ top: 856, width: 448, height: 152 });
    const stopTimer = trackBottomInset(timer, "foot", view.host);
    assert.equal(view.style.get(FOOT), "168px");
    stopTimer();
    assert.equal(view.style.has(FOOT), false);
    stopSteps();
  });

  test("the phone's bar and the banner keep their own variables; only one element sets each, as before", () => {
    const view = fakePage(844);
    const stopBanner = trackBottomInset(bar({ top: 632, width: 366, height: 200 }), "consent", view.host);
    const stopFoot = trackBottomInset(bar({ top: 784, width: 366, height: 48 }), "foot", view.host);
    assert.equal(view.style.get(BOTTOM_INSETS.consent), "212px");
    assert.equal(view.style.get(FOOT), "60px");
    stopFoot();
    assert.equal(view.style.get(BOTTOM_INSETS.consent), "212px", "the banner's inset is untouched");
    stopBanner();
    assert.equal(view.style.size, 0);
  });
});

/** html's bottom room, worked out from globals.css with the insets given (px; 0 when a variable is unset). */
function scrollRoom(insets: Partial<Record<keyof typeof BOTTOM_INSETS, number>>): number {
  const html = css("src/app/globals.css").match(/^html \{([^}]*)\}/m)?.[1] ?? "";
  const room = html.match(/--fitx-scroll-room-bottom: calc\(max\(([^)]*\)(?:, [^)]*\))*)\) \+ (\d+)px\);/);
  assert.ok(room, "html's --fitx-scroll-room-bottom");
  const terms = [...room[1].matchAll(/var\((--[a-z-]+), 0px\)/g)].map((match) => match[1]);
  const byVariable = new Map<string, number>(Object.entries(BOTTOM_INSETS).map(([name, variable]) => [variable, insets[name as keyof typeof BOTTOM_INSETS] ?? 0]));
  return Math.max(...terms.map((variable) => byVariable.get(variable) ?? Number.NaN)) + Number(room[2]);
}

/** Where scrollIntoView({ block: "nearest" }) puts a box (CSSOM View), as the browser's focus scroll keeps it clear. */
function nearestScroll(rect: { top: number; bottom: number }, viewport: number, topRoom: number, bottomRoom: number): number {
  const top = topRoom;
  const bottom = viewport - bottomRoom;
  const fits = rect.bottom - rect.top <= bottom - top;
  if (rect.top < top && rect.bottom > bottom) return 0;
  if ((rect.top < top && fits) || (rect.bottom > bottom && !fits)) return rect.top - top;
  if ((rect.top < top && !fits) || (rect.bottom > bottom && fits)) return rect.bottom - bottom;
  return 0;
}

describe("html's scroll padding reads it, and nothing else does", () => {
  test("the bottom room is the most any inset hides, plus 12 px; with none set, 12 px as before", () => {
    assert.equal(scrollRoom({}), 12);
    assert.equal(scrollRoom({ consent: 154 }), 166);
    assert.equal(scrollRoom({ foot: 168 }), 180);
    assert.equal(scrollRoom({ consent: 212, foot: 438 }), 450, "the timer rises over the open banner, so its room wins");
    assert.match(css("src/app/globals.css").match(/^html \{([^}]*)\}/m)?.[1] ?? "", /scroll-padding-bottom: var\(--fitx-scroll-room-bottom\);/);
  });

  test("the re-check's case: Tab to Finish workout at 768 × 1024 while resting stops it 12 px above the timer", () => {
    // The timer's top edge at 856 (168 px up); Finish workout (48 tall) sits where Tab finds it, from y 830.
    const button = { top: 830, bottom: 878 };
    const before = nearestScroll(button, 1024, 84, 12);
    assert.ok(button.bottom - before > 856, "before: kept clear of 12 px only, so partly under the timer");
    const after = nearestScroll(button, 1024, 84, scrollRoom({ foot: 168 }));
    assert.equal(button.bottom - after, 856 - 12);
    // A phone resting, the timer over Previous and Next: a set's Complete set button ends clear of both.
    const complete = { top: 700, bottom: 756 };
    const phone = nearestScroll(complete, 844, 84, scrollRoom({ foot: 230 }));
    assert.equal(complete.bottom - phone, 844 - 230 - 12);
    // With no rest on a desktop nothing moves that did not move before.
    assert.equal(nearestScroll({ top: 300, bottom: 348 }, 720, 84, scrollRoom({})), 0);
  });

  test("only html's room reads the foot inset: never the banner's place or the bars' own offsets (no loop)", () => {
    const readers = readdirSync("src", { recursive: true }).map(String)
      .filter((file) => /\.(tsx?|css)$/.test(file) && source(`src/${file}`).replace(/\/\*[\s\S]*?\*\//g, "").includes(FOOT));
    assert.deepEqual(readers.sort(), ["app/globals.css", "components/layout/bottom-inset.ts"]);
    const globals = css("src/app/globals.css");
    assert.equal(globals.split(FOOT).length - 1, 1, "once, in html's --fitx-scroll-room-bottom");
    assert.doesNotMatch(globals.match(/^\.fitx-consent \{[^}]*\}/m)?.[0] ?? "", /page-foot/);
  });
});

describe("the page: the rest timer and Previous and Next set it while they show", () => {
  test("each bar's ref keeps the page's own ref and tracks the bar under foot", () => {
    assert.match(page, /import \{ trackBottomInset \} from "@\/components\/layout\/bottom-inset";/);
    assert.match(page, /const restDockAttach = useMemo\(\(\) => footBarRef\(restDockRef, \(bar\) => trackBottomInset\(bar, "foot"\)\), \[\]\);/);
    assert.match(page, /const stepBarAttach = useMemo\(\(\) => footBarRef\(stepBarRef, \(bar\) => trackBottomInset\(bar, "foot"\)\), \[\]\);/);
    assert.match(page, /\{resting && <RestDock ref=\{restDockAttach\} /, "drawn only while a rest runs");
    assert.match(page, /<div ref=\{stepBarAttach\} className="fixed [^"]* sm:hidden">/, "hidden from 640 px: then it hides nothing");
    assert.doesNotMatch(page, /ref=\{restDockRef\}|ref=\{stepBarRef\}/, "no bar left untracked");
  });

  test("footBarRef: the holder follows the bar, the tracking starts with it and stops when it goes", () => {
    const holder: { current: { id: string } | null } = { current: null };
    const calls: string[] = [];
    const ref = footBarRef(holder, (bar) => { calls.push(`track ${bar.id}`); return () => calls.push(`stop ${bar.id}`); });
    const cleanup = ref({ id: "timer" });
    assert.deepEqual(holder.current, { id: "timer" });
    assert.deepEqual(calls, ["track timer"]);
    assert.equal(typeof cleanup, "function");
    cleanup?.();
    assert.deepEqual(calls, ["track timer", "stop timer"]);
    assert.equal(holder.current, null);
    // React before 19 calls a ref with null instead: the holder is cleared and nothing is tracked.
    assert.equal(ref(null), undefined);
    assert.equal(holder.current, null);
    assert.deepEqual(calls, ["track timer", "stop timer"]);
  });

  test("a new bar attached before the old one's cleanup keeps the holder on the new one", () => {
    const holder: { current: { id: string } | null } = { current: null };
    const ref = footBarRef(holder, () => () => undefined);
    const first = ref({ id: "a" });
    ref({ id: "b" });
    first?.();
    assert.deepEqual(holder.current, { id: "b" });
  });
});

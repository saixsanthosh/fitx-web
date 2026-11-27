// Release 3 fix round 3f (open-3e-active-reasons-under-rest, open item 2 of round 3e). On the live workout, Swap's and
// Add set's reasons, and a refused set's (after its box takes focus), could show under the rest timer on a tablet or
// phone while resting, or under a phone's Previous and Next: only Finish workout's and Abandon's were brought clear of
// them (round 3e). Every action's reason now is, the same way (revealReason, built on revealAboveFoot): the block that
// holds the control used and its reason, or, for a set, the lower of its reason and the box or button focus is on in
// that set's row, so both show. The clock's and the paused banner's reasons come along (same effect, same kind of
// place). Focus never moves, and nothing moves when focus has gone elsewhere meanwhile. The page is JSX, which
// `node --test` cannot render: the decision is pure and runs here on stand-ins; the wiring is read from the source.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FOOT_ROOM, lowerOf, revealReason, type FootBar, type FootPage, type ReasonPlaces } from "@/app/(dashboard)/workouts/active/_lib/foot-clearance";
import type { ActionProblem } from "@/app/(dashboard)/workouts/active/_lib/action-problem";

const page = readFileSync("src/app/(dashboard)/workouts/active/page.tsx", "utf8");

/** A stand-in element: where it is on screen, what it holds, and each time it was asked into view (its margin then). */
function element(name: string, top: number, bottom: number, holds: unknown[] = []) {
  const self = {
    name,
    style: { scrollMarginBottom: "" },
    asked: [] as string[],
    contains: (node: unknown): boolean => node === self || holds.includes(node),
    getBoundingClientRect: () => ({ top, bottom }),
    scrollIntoView: () => { self.asked.push(self.style.scrollMarginBottom); },
  };
  return self;
}
type Stand = ReturnType<typeof element>;
const body = { tag: "body" };
const header = element("header link", 20, 64);

/** A bar fixed over the foot, as getBoundingClientRect gives it. */
const bar = (top: number, height: number, width = 448): FootBar => ({ getBoundingClientRect: () => ({ top, height, width }) });

function placesWith(blocks: Partial<ReasonPlaces["blocks"]>, set: ReasonPlaces["set"] = () => null): ReasonPlaces {
  return { blocks: { finish: null, clock: null, banner: null, swap: null, "add-set": null, ...blocks }, set };
}

/** html's scroll padding once the bars' inset is in it (globals.css: the most any inset hides, plus 12 px). */
const padding = (hidden: number) => hidden + 12;
const at = (activeElement: unknown, viewportHeight: number, scrollPadding: number): FootPage => ({ activeElement, body, viewportHeight, scrollPadding });

/** Where scrollIntoView({ block: "nearest" }) puts a box (CSSOM View): the scrollport less html's padding and the margin. */
function nearestScroll(rect: { top: number; bottom: number }, viewport: number, topRoom: number, bottomRoom: number): number {
  const top = topRoom;
  const bottom = viewport - bottomRoom;
  const fits = rect.bottom - rect.top <= bottom - top;
  if (rect.top < top && rect.bottom > bottom) return 0;
  if ((rect.top < top && fits) || (rect.bottom > bottom && !fits)) return rect.top - top;
  if ((rect.top < top && !fits) || (rect.bottom > bottom && fits)) return rect.bottom - bottom;
  return 0;
}

describe("which part is brought clear for each action's reason", () => {
  const swap: ActionProblem = { at: "swap", exerciseId: "ex-1", message: "That exercise couldn’t be swapped. Check your connection and try again." };

  test("Swap, Add set, Finish workout, the clock and the paused banner: the block with the control and its reason", () => {
    const problems: ActionProblem[] = [
      swap,
      { at: "add-set", exerciseId: "ex-1", message: "A new set could not be added. Check your connection and try again." },
      { at: "finish", message: "This session was already closed or could not be completed. Reload to check its status." },
      { at: "clock", message: "The workout could not be paused. Check your connection and try again." },
      { at: "banner", message: "The workout could not be resumed. Check your connection and try again." },
    ];
    for (const problem of problems) {
      const button = { tag: `${problem.at} button` };
      const block = element(problem.at, 700, 800, [button]);
      const places = placesWith({ [problem.at]: block } as Partial<ReasonPlaces["blocks"]>);
      assert.equal(revealReason(problem, places, [bar(614, 146, 366)], at(button, 844, padding(230))), true, problem.at);
      assert.deepEqual(block.asked, ["0px"], `${problem.at}: asked into view once; the padding already clears the bars`);
    }
  });

  test("with focus lost on the way (Swap's sheet returned it to nothing), the block is brought clear all the same", () => {
    const block = element("swap", 700, 800);
    assert.equal(revealReason(swap, placesWith({ swap: block }), [bar(614, 146, 366)], at(body, 844, padding(230))), true);
    assert.equal(block.asked.length, 1);
  });

  test("nothing moves when focus has gone elsewhere meanwhile, or the block is not drawn", () => {
    const block = element("swap", 700, 800, [{ tag: "Swap" }]);
    assert.equal(revealReason(swap, placesWith({ swap: block }), [bar(614, 146, 366)], at(header, 844, padding(230))), false);
    assert.deepEqual(block.asked, []);
    assert.equal(block.style.scrollMarginBottom, "", "nothing changed");
    assert.equal(revealReason(swap, placesWith({}), [bar(614, 146, 366)], at(body, 844, padding(230))), false);
  });

  test("a bar not measured into the padding yet: the margin asks for the rest, as round 3e's did", () => {
    const button = { tag: "Add set" };
    const block = element("add-set", 700, 800, [button]);
    revealReason({ at: "add-set", exerciseId: "ex-1", message: "A movement can have up to 30 sets in one session." }, placesWith({ "add-set": block }), [bar(614, 146, 366)], at(button, 844, 12));
    assert.deepEqual(block.asked, [`${230 + FOOT_ROOM - 12}px`]);
  });
});

describe("a refused set: the lower of its reason and the box or button focus is on in its row", () => {
  const refused = (field: "draftWeight" | null): ActionProblem => ({ at: "set", setId: "s2", field, message: field ? "The weight must be 2,000 kg or less." : "That set could not be saved. Check your connection and try again." });
  /** The current set's row on a phone: the weight box, the reps box, the reason, then Complete set. */
  function currentRow() {
    const weight = element("weight box", 470, 526);
    const reason = element("reason", 640, 700);
    const complete = element("Complete set", 708, 764);
    const row = element("row", 420, 790, [weight, reason, complete]);
    return { weight, reason, complete, row, set: (setId: string) => (setId === "s2" ? { reason, row } : null) };
  }

  test("the box at fault took focus above the reason: the reason is brought clear (the box comes with it)", () => {
    const { weight, reason, complete, set } = currentRow();
    assert.equal(revealReason(refused("draftWeight"), placesWith({}, set), [bar(614, 146, 366)], at(weight, 844, padding(230))), true);
    assert.equal(reason.asked.length, 1);
    assert.deepEqual([weight.asked, complete.asked], [[], []]);
  });

  test("a set that could not be saved keeps focus on Complete set, under the reason: that button is brought clear", () => {
    const { reason, complete, set } = currentRow();
    revealReason(refused(null), placesWith({}, set), [bar(614, 146, 366)], at(complete, 844, padding(230)));
    assert.deepEqual([reason.asked.length, complete.asked.length], [0, 1]);
  });

  test("another set's row: its check button sits above its reason, so the reason is brought clear", () => {
    const check = element("check", 300, 348);
    const reason = element("reason", 356, 396);
    const row = element("row", 300, 420, [check, reason]);
    revealReason(refused(null), placesWith({}, (setId) => (setId === "s2" ? { reason, row } : null)), [bar(614, 146, 366)], at(check, 844, padding(230)));
    assert.deepEqual([reason.asked.length, check.asked.length], [1, 0]);
  });

  test("focus lost: the reason; focus moved out of the row (the header): nothing; the set not on screen: nothing", () => {
    const lost = currentRow();
    revealReason(refused(null), placesWith({}, lost.set), [bar(614, 146, 366)], at(body, 844, padding(230)));
    assert.equal(lost.reason.asked.length, 1);
    const away = currentRow();
    assert.equal(revealReason(refused(null), placesWith({}, away.set), [bar(614, 146, 366)], at(header, 844, padding(230))), false);
    assert.deepEqual([away.reason.asked, away.complete.asked], [[], []]);
    assert.equal(revealReason({ ...refused(null), setId: "elsewhere" } as ActionProblem, placesWith({}, away.set), [], at(body, 844, 12)), false);
  });

  test("lowerOf: the lower bottom edge wins; the reason when nothing else is focused or they end level", () => {
    const reason = element("reason", 100, 140);
    assert.equal(lowerOf(reason, null), reason);
    assert.equal(lowerOf(reason, element("above", 40, 96)), reason);
    assert.equal(lowerOf(reason, element("level", 120, 140)), reason);
    const below = element("below", 150, 200);
    assert.equal(lowerOf(reason, below), below);
  });
});

describe("where each reason ends at 1280 × 720, 768 × 1024 and 390 × 844 while resting", () => {
  /** Brings `target` clear as the page does, then where the browser's nearest scroll leaves it. */
  function settle(target: Stand, scope: Stand, focused: unknown, view: { width: number; height: number; timerTop: number }) {
    const hidden = view.height - view.timerTop;
    const timer = bar(view.timerTop, hidden - (view.width < 640 ? 84 : 16), view.width < 640 ? 366 : 448);
    revealReason({ at: "swap", exerciseId: "ex-1", message: "…" }, placesWith({ swap: scope }), [timer], at(focused, view.height, padding(hidden)));
    assert.equal(scope.asked.length, 1);
    const margin = Number.parseInt(scope.asked[0], 10);
    const rect = target.getBoundingClientRect();
    const moved = nearestScroll(rect, view.height, 84, padding(hidden) + margin);
    return { top: rect.top - moved, bottom: rect.bottom - moved };
  }
  const views = [
    { width: 1280, height: 720, timerTop: 526 },
    { width: 768, height: 1024, timerTop: 856 },
    { width: 390, height: 844, timerTop: 614 },
  ];

  test("Swap's row and its reason, which showed in the timer's band, end 12 px above the timer, under the header", () => {
    for (const view of views) {
      // The row (44 px), 16 px, the reason (60 px), drawn so the reason starts in the timer's band.
      const swapButton = { tag: "Swap" };
      const block = element("swap block", view.timerTop - 40, view.timerTop + 80, [swapButton]);
      const end = settle(block, block, swapButton, view);
      assert.equal(end.bottom, view.timerTop - FOOT_ROOM, `${view.width} × ${view.height}`);
      assert.ok(end.top >= 84, "the row is still under the header's room");
    }
  });

  test("an already clear block does not move", () => {
    for (const view of views) {
      const button = { tag: "Add set" };
      const block = element("add-set block", 200, 320, [button]);
      const end = settle(block, block, button, view);
      assert.deepEqual(end, { top: 200, bottom: 320 }, `${view.width} × ${view.height}`);
    }
  });
});

describe("the page: one effect for every reason, after a refused set's box has taken focus", () => {
  const effectAt = page.indexOf("revealReason(problem, { blocks, set }");

  test("it runs after the box at fault takes focus, so the box is where the browser and the reveal find focus", () => {
    assert.ok(effectAt > 0);
    assert.ok(effectAt > page.indexOf("}, [focusBox]);"), "declared after the focus-the-box effect (effects run in order)");
    assert.match(page, /const blocks = \{ finish: finishBarRef\.current, clock: clockRef\.current, banner: pausedRef\.current, swap: swapAreaRef\.current, "add-set": addSetAreaRef\.current \};/);
    assert.match(page, /const reason = document\.getElementById\(setProblemId\(setId\)\);\n\s+const row = reason\?\.closest\("li"\);\n\s+return reason && row \? \{ reason, row \} : null;/);
    assert.doesNotMatch(page, /revealAboveFoot\(/, "every reason goes through revealReason");
  });

  test("each block holds its control and its reason", () => {
    assert.match(page, /<section ref=\{clockRef\} aria-label="Workout clock"/);
    assert.match(page, /<div ref=\{swapAreaRef\} className="space-y-4">\n\s+<div className="flex flex-wrap items-center gap-2">\n\s+<button type="button" onClick=\{\(\) => setSwapOpen\(true\)\}[\s\S]*?\n\s+\{swapProblem && <p role="alert" className=\{PROBLEM_CLASS\}>\{swapProblem\}<\/p>\}\n\s+<\/div>/);
    assert.match(page, /<div ref=\{addSetAreaRef\} className="space-y-4">\n\s+<div className="flex flex-wrap items-center gap-2">\n\s+<button type="button" onClick=\{\(\) => void addSet\(currentExercise\)\}[\s\S]*?\n\s+\{addSetProblem && <p role="alert" className=\{PROBLEM_CLASS\}>\{addSetProblem\}<\/p>\}\n\s+<\/div>/);
    assert.match(page, /\{paused && <div ref=\{pausedRef\} className="space-y-4 sm:space-y-5">/);
    // A set's reason is inside its own row, with its id (SetList).
    const setList = readFileSync("src/components/session/SetList.tsx", "utf8");
    assert.match(setList, /<p key="problem" id=\{problemId\} role="alert"/);
    assert.match(setList, /<li key=\{set\.id\}/);
  });
});

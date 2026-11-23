import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FITX_MARK_BOUNDS,
  FITX_MARK_D,
  FITX_MARK_ENTRY,
  FITX_MARK_PATHS,
  FITX_MARK_SIZE,
  FITX_MARK_VIEWBOX,
  polygonPath,
} from "@/components/brand/logo/geometry";
import { REVEAL_MAX_MS, REVEAL_REDUCED_MS, REVEAL_TOTAL_MS, revealPlan } from "@/components/brand/logo/reveal-plan";

const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
const points = (d: string) => {
  const list = numbers(d);
  const out: Array<[number, number]> = [];
  for (let index = 0; index < list.length; index += 2) out.push([list[index], list[index + 1]]);
  return out;
};

test("the mark is the F with the barbell crossed by the X: ten pieces, in drawing order", () => {
  assert.deepEqual(FITX_MARK_PATHS.map(({ id }) => id), [
    "bar", "stem", "arm", "stroke", "branch", "leg-inner", "leg-outer", "plate-1", "plate-2", "plate-3",
  ]);
  assert.equal(FITX_MARK_VIEWBOX, "0 0 600 600");
  assert.equal(FITX_MARK_SIZE, 600);
  for (const { id, d } of FITX_MARK_PATHS) {
    assert.match(d, /^M/, id);
    assert.match(d, /Z$/, `${id} is closed`);
    assert.equal(numbers(d).length % 2, 0, `${id}: x y pairs`);
  }
  assert.equal(FITX_MARK_D, FITX_MARK_PATHS.map(({ d }) => d).join(""));
});

test("straight edges everywhere except the plates' small rounded corners", () => {
  for (const { id, d } of FITX_MARK_PATHS) {
    if (id.startsWith("plate")) assert.match(d, /Q/, `${id} has rounded corners`);
    else assert.doesNotMatch(d, /[QCA]/, `${id} is straight-edged`);
  }
});

test("every point sits inside the stated bounds, and the mark is centred in its square", () => {
  const all = FITX_MARK_PATHS.flatMap(({ d }) => points(d));
  const xs = all.map(([x]) => x);
  const ys = all.map(([, y]) => y);
  const { x, y, width, height } = FITX_MARK_BOUNDS;
  assert.ok(Math.min(...xs) >= x - 0.05 && Math.max(...xs) <= x + width + 0.05, "x within bounds");
  assert.ok(Math.min(...ys) >= y - 0.05 && Math.max(...ys) <= y + height + 0.05, "y within bounds");
  assert.ok(Math.abs(x + width / 2 - 300) < 1, "centred across");
  assert.ok(Math.abs(y + height / 2 - 300) < 1, "centred down");
  assert.ok(Math.min(...xs) >= 0 && Math.max(...xs) <= 600 && Math.min(...ys) >= 0 && Math.max(...ys) <= 600, "never cropped by the viewBox");
});

test("measured proportions of the original: the plates lean, shrink and step down; the X's legs are two parallel strips", () => {
  const piece = (id: string) => points(FITX_MARK_PATHS.find((entry) => entry.id === id)!.d);
  const height = (id: string) => { const ys = piece(id).map(([, y]) => y); return Math.max(...ys) - Math.min(...ys); };
  assert.ok(height("plate-1") > height("plate-2") && height("plate-2") > height("plate-3"), "each plate shorter than the one before");
  const bar = piece("bar");
  assert.equal(bar[0][1], bar[1][1], "the bar's top edge is level");
  assert.ok(Math.abs(bar[2][1] - bar[0][1] - 47) < 0.2, "the bar is 47 px deep in the original");
  const slope = ([a, b]: Array<[number, number]>) => (b[1] - a[1]) / (b[0] - a[0]);
  const inner = piece("leg-inner");
  const outer = piece("leg-outer");
  assert.ok(Math.abs(slope([inner[1], inner[2]]) - slope([outer[1], outer[2]])) < 0.05, "the leg strips run parallel");
});

test("every piece has a direction of travel for the formation", () => {
  for (const { id } of FITX_MARK_PATHS) {
    const entry = FITX_MARK_ENTRY[id];
    assert.ok(entry && (entry.x !== 0 || entry.y !== 0), id);
  }
  // The plates slide onto the bar from its end: to the right, level.
  for (const id of ["plate-1", "plate-2", "plate-3"] as const) assert.ok(FITX_MARK_ENTRY[id].x > 0 && FITX_MARK_ENTRY[id].y === 0, id);
});

test("polygonPath: sharp corners stay sharp, rounded ones never overshoot half an edge", () => {
  assert.equal(polygonPath([[0, 0], [10, 0], [10, 10]]), "M0 0L10 0L10 10Z");
  const rounded = polygonPath([[0, 0], [10, 0], [10, 10], [0, 10]], 20);
  assert.ok(numbers(rounded).every((n) => n >= 0 && n <= 10), rounded);
  assert.equal((rounded.match(/Q/g) ?? []).length, 4);
});

test("the reveal never runs past 2.2 s and holds the still logo briefly with reduced motion", () => {
  assert.ok(REVEAL_TOTAL_MS <= REVEAL_MAX_MS);
  assert.equal(REVEAL_MAX_MS, 2200);
  assert.equal(REVEAL_REDUCED_MS, 400);
  for (const variant of ["welcome", "return", "film-end"] as const) {
    const plan = revealPlan(variant);
    assert.ok(plan.totalMs <= REVEAL_MAX_MS, variant);
    assert.equal(plan.wordmark, true, variant);
  }
  assert.equal(revealPlan("film-end").exits, false, "the film's end card holds on the logo");
  assert.equal(revealPlan("return").exits, true);
  assert.equal(revealPlan("welcome").className, "welcome");
  assert.equal(revealPlan("film-end").className, "filmEnd");
});

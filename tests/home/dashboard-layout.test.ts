import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VISIBLE,
  FIXED_PARTS,
  WIDGETS,
  WIDGET_IDS,
  defaultLayout,
  describePosition,
  hiddenIds,
  layoutReducer,
  readLayout,
  sanitizeLayout,
  serializeLayout,
  visibleIds,
  widgetNames,
  type LayoutItem,
} from "@/lib/domain/dashboard-layout";

test("a new account's Home is the Today ring, To-Do and Goals, plus weight and water; the rest wait in Customise", () => {
  const layout = defaultLayout();
  assert.deepEqual(visibleIds(layout), ["weight", "water"]);
  assert.deepEqual(visibleIds(layout), [...DEFAULT_VISIBLE]);
  assert.equal(layout.length, WIDGET_IDS.length, "every widget is listed once");
  assert.deepEqual(hiddenIds(layout), ["plan", "next", "muscles", "week", "macros"]);
  assert.deepEqual(readLayout(null).fresh, [], "nothing is 'new' on a new account");
});

test("Today, To-Do and Goals are fixed parts of Home, not widgets", () => {
  for (const part of FIXED_PARTS) assert.equal(Object.prototype.hasOwnProperty.call(WIDGETS, part), false, part);
  // A layout stored by the older Home keeps everything else as it was; the fixed parts are dropped and never written back.
  const older = { version: 1, items: [
    { id: "plan", visible: true }, { id: "today", visible: true }, { id: "next", visible: true }, { id: "muscles", visible: true },
    { id: "todo", visible: true }, { id: "goals", visible: true }, { id: "weight", visible: true },
    { id: "water", visible: false }, { id: "week", visible: false }, { id: "macros", visible: false },
  ] };
  const read = readLayout(older);
  assert.deepEqual(visibleIds(read.items), ["plan", "next", "muscles", "weight"]);
  assert.deepEqual(hiddenIds(read.items), ["water", "week", "macros"]);
  assert.deepEqual(read.fresh, [], "nothing new to offer");
  const stored = JSON.stringify(serializeLayout(read.items));
  for (const part of FIXED_PARTS) assert.equal(stored.includes(`"${part}"`), false, `${part} is not written back`);
});

test("widgets released after a layout was saved are reported once as fresh, hidden until accepted", () => {
  const saved = { version: 1, items: [{ id: "today", visible: true }, { id: "todo", visible: true }, { id: "weight", visible: true }, { id: "water", visible: false }, { id: "workout", visible: false }, { id: "week", visible: false }, { id: "macros", visible: false }] };
  const read = readLayout(saved);
  assert.deepEqual(visibleIds(read.items), ["weight"], "Home does not change unasked");
  assert.deepEqual(read.fresh, ["plan", "next", "muscles"], "a hidden Today's workout never showed Today's plan, so it is offered");
  const accepted = layoutReducer(read.items, { type: "adopt", ids: read.fresh });
  assert.deepEqual(visibleIds(accepted), ["plan", "weight", "next", "muscles"], "the wide plan leads; the rest join at the end");
  assert.deepEqual(readLayout(serializeLayout(accepted)).fresh, [], "once saved, nothing is fresh any more");
  assert.deepEqual(readLayout(serializeLayout(read.items)).fresh, [], "saving the layout as it is (Not now) also clears the hint");
  assert.equal(layoutReducer(accepted, { type: "adopt", ids: ["plan"] }), accepted, "adopting what is already shown changes nothing");
  assert.equal(widgetNames(read.fresh), "Today's plan, Focus next and Muscles this week");
});

test("a shown Today's workout becomes Today's plan in the same place", () => {
  const read = readLayout({ version: 1, items: [{ id: "weight", visible: true }, { id: "workout", visible: true }, { id: "water", visible: true }] });
  assert.deepEqual(visibleIds(read.items), ["weight", "plan", "water"]);
  assert.equal(read.fresh.includes("plan"), false, "it was already on Home");
  assert.equal(read.items.some((item) => (item.id as string) === "workout"), false, "the retired id is never written back");
});

test("nothing saved, or something unreadable, means the default layout", () => {
  for (const raw of [null, undefined, "", 42, {}, { items: "x" }, { items: [] }, [], [{ id: "nope" }], [{ id: "today" }, { id: "goals" }]]) {
    assert.deepEqual(sanitizeLayout(raw), defaultLayout(), JSON.stringify(raw));
  }
});

test("a saved layout keeps its order and visibility; unknown and repeated ids are dropped", () => {
  const saved = { version: 1, items: [{ id: "weight", visible: true }, { id: "bogus", visible: true }, { id: "macros", visible: true }, { id: "weight", visible: false }, { id: "water", visible: false }] };
  const layout = sanitizeLayout(saved);
  assert.deepEqual(visibleIds(layout), ["weight", "macros"]);
  assert.equal(layout.filter((item) => item.id === "weight").length, 1);
  assert.equal(layout.find((item) => item.id === "water")?.visible, false);
});

test("widgets released after the layout was saved arrive hidden, so Home never changes unasked", () => {
  const layout = sanitizeLayout({ version: 1, items: [{ id: "macros", visible: true }, { id: "water", visible: true }] });
  assert.deepEqual(visibleIds(layout), ["macros", "water"]);
  assert.deepEqual(new Set(hiddenIds(layout)), new Set(WIDGET_IDS.filter((id) => id !== "macros" && id !== "water")));
  assert.deepEqual(readLayout({ version: 1, items: [{ id: "macros", visible: true }, { id: "water", visible: true }] }).fresh.slice(0, 2), ["plan", "next"]);
});

test("bare arrays of ids or items are read too, and shown widgets always come first", () => {
  assert.deepEqual(visibleIds(sanitizeLayout(["water", "weight"])), ["water", "weight"]);
  const mixed = sanitizeLayout([{ id: "macros", visible: false }, { id: "water" }, { id: "weight", visible: true }]);
  assert.deepEqual(mixed.slice(0, 2).map((item) => item.id), ["water", "weight"], "an item without visible counts as shown");
  assert.equal(mixed[2].id, "macros");
});

const MINIMAL: LayoutItem[] = sanitizeLayout({ version: 1, items: ["plan", "macros", "week", "weight"].map((id) => ({ id, visible: true })) });

test("move shifts a shown widget among the shown ones and stops at the ends", () => {
  const start = MINIMAL;
  const down = layoutReducer(start, { type: "move", id: "plan", delta: 1 });
  assert.deepEqual(visibleIds(down), ["macros", "plan", "week", "weight"]);
  const up = layoutReducer(down, { type: "move", id: "weight", delta: -3 });
  assert.deepEqual(visibleIds(up), ["weight", "macros", "plan", "week"]);
  assert.equal(layoutReducer(up, { type: "move", id: "weight", delta: -1 }), up, "already first: same array, nothing to save");
  assert.equal(layoutReducer(up, { type: "move", id: "water", delta: 1 }), up, "hidden widgets do not move");
  assert.deepEqual(hiddenIds(up), hiddenIds(start), "hidden widgets keep their place");
});

test("reorder applies a drag's order and keeps any shown widget the drag left out", () => {
  const dragged = layoutReducer(MINIMAL, { type: "reorder", order: ["week", "plan", "water"] });
  assert.deepEqual(visibleIds(dragged), ["week", "plan", "macros", "weight"], "water is hidden, so it is ignored");
  assert.equal(layoutReducer(dragged, { type: "reorder", order: ["week", "plan", "macros", "weight"] }), dragged);
});

test("show adds a widget at the end of Home; hide removes it", () => {
  const shown = layoutReducer(MINIMAL, { type: "show", id: "water" });
  assert.deepEqual(visibleIds(shown), ["plan", "macros", "week", "weight", "water"]);
  assert.equal(layoutReducer(shown, { type: "show", id: "water" }), shown);
  const hidden = layoutReducer(shown, { type: "hide", id: "macros" });
  assert.deepEqual(visibleIds(hidden), ["plan", "week", "weight", "water"]);
  assert.equal(hidden.find((item) => item.id === "macros")?.visible, false);
  assert.equal(layoutReducer(hidden, { type: "hide", id: "macros" }), hidden);
});

test("everything can be hidden, and that is kept rather than replaced by the default", () => {
  let layout: LayoutItem[] = defaultLayout();
  for (const id of visibleIds(layout)) layout = layoutReducer(layout, { type: "hide", id });
  assert.deepEqual(visibleIds(layout), []);
  assert.deepEqual(visibleIds(sanitizeLayout(serializeLayout(layout))), [], "an all-hidden layout survives a save");
});

test("reset and replace", () => {
  const changed = layoutReducer(MINIMAL, { type: "move", id: "weight", delta: -2 });
  assert.deepEqual(layoutReducer(changed, { type: "reset" }), defaultLayout());
  assert.equal(layoutReducer(defaultLayout(), { type: "reset" }).length, WIDGET_IDS.length);
  const replaced = layoutReducer(defaultLayout(), { type: "replace", items: [{ id: "macros", visible: true }] });
  assert.deepEqual(visibleIds(replaced), ["macros"]);
});

test("serializeLayout writes the versioned shape the database check expects", () => {
  const stored = serializeLayout(defaultLayout());
  assert.equal(stored.version, 1);
  assert.deepEqual(Object.keys(stored.items[0]), ["id", "visible"]);
  assert.ok(JSON.stringify(stored).length < 4096, "fits the 4 KB column check");
  assert.deepEqual(sanitizeLayout(stored), defaultLayout(), "round-trips");
});

test("describePosition gives screen readers the new place", () => {
  const layout = layoutReducer(MINIMAL, { type: "move", id: "weight", delta: -1 });
  assert.equal(describePosition(layout, "weight"), "Weight, position 3 of 4");
  assert.equal(describePosition(layout, "water"), "Water is hidden");
});

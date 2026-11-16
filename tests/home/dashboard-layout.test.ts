import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VISIBLE,
  WIDGET_IDS,
  defaultLayout,
  describePosition,
  hiddenIds,
  layoutReducer,
  sanitizeLayout,
  serializeLayout,
  visibleIds,
  type LayoutItem,
} from "@/lib/domain/dashboard-layout";

test("a new account gets the minimal Home: Today, To-Do, Goals and Weight", () => {
  const layout = defaultLayout();
  assert.deepEqual(visibleIds(layout), ["today", "todo", "goals", "weight"]);
  assert.deepEqual(visibleIds(layout), [...DEFAULT_VISIBLE]);
  assert.equal(layout.length, WIDGET_IDS.length, "every widget is listed once");
  assert.deepEqual(hiddenIds(layout), ["water", "workout", "week", "macros"]);
});

test("nothing saved, or something unreadable, means the default layout", () => {
  for (const raw of [null, undefined, "", 42, {}, { items: "x" }, { items: [] }, [], [{ id: "nope" }]]) {
    assert.deepEqual(sanitizeLayout(raw), defaultLayout(), JSON.stringify(raw));
  }
});

test("a saved layout keeps its order and visibility; unknown and repeated ids are dropped", () => {
  const saved = { version: 1, items: [{ id: "weight", visible: true }, { id: "bogus", visible: true }, { id: "todo", visible: true }, { id: "weight", visible: false }, { id: "today", visible: false }] };
  const layout = sanitizeLayout(saved);
  assert.deepEqual(visibleIds(layout), ["weight", "todo"]);
  assert.equal(layout.filter((item) => item.id === "weight").length, 1);
  assert.equal(layout.find((item) => item.id === "today")?.visible, false);
});

test("widgets released after the layout was saved arrive hidden, so Home never changes unasked", () => {
  const layout = sanitizeLayout({ version: 1, items: [{ id: "goals", visible: true }, { id: "today", visible: true }] });
  assert.deepEqual(visibleIds(layout), ["goals", "today"]);
  assert.deepEqual(new Set(hiddenIds(layout)), new Set(WIDGET_IDS.filter((id) => id !== "goals" && id !== "today")));
});

test("bare arrays of ids or items are read too, and shown widgets always come first", () => {
  assert.deepEqual(visibleIds(sanitizeLayout(["water", "today"])), ["water", "today"]);
  const mixed = sanitizeLayout([{ id: "todo", visible: false }, { id: "water" }, { id: "today", visible: true }]);
  assert.deepEqual(mixed.slice(0, 2).map((item) => item.id), ["water", "today"], "an item without visible counts as shown");
  assert.equal(mixed[2].id, "todo");
});

test("move shifts a shown widget among the shown ones and stops at the ends", () => {
  const start = defaultLayout();
  const down = layoutReducer(start, { type: "move", id: "today", delta: 1 });
  assert.deepEqual(visibleIds(down), ["todo", "today", "goals", "weight"]);
  const up = layoutReducer(down, { type: "move", id: "weight", delta: -3 });
  assert.deepEqual(visibleIds(up), ["weight", "todo", "today", "goals"]);
  assert.equal(layoutReducer(up, { type: "move", id: "weight", delta: -1 }), up, "already first: same array, nothing to save");
  assert.equal(layoutReducer(up, { type: "move", id: "water", delta: 1 }), up, "hidden widgets do not move");
  assert.deepEqual(hiddenIds(up), hiddenIds(start), "hidden widgets keep their place");
});

test("reorder applies a drag's order and keeps any shown widget the drag left out", () => {
  const start = defaultLayout();
  const dragged = layoutReducer(start, { type: "reorder", order: ["goals", "today", "water"] });
  assert.deepEqual(visibleIds(dragged), ["goals", "today", "todo", "weight"], "water is hidden, so it is ignored");
  assert.equal(layoutReducer(dragged, { type: "reorder", order: ["goals", "today", "todo", "weight"] }), dragged);
});

test("show adds a widget at the end of Home; hide removes it", () => {
  const shown = layoutReducer(defaultLayout(), { type: "show", id: "water" });
  assert.deepEqual(visibleIds(shown), ["today", "todo", "goals", "weight", "water"]);
  assert.equal(layoutReducer(shown, { type: "show", id: "water" }), shown);
  const hidden = layoutReducer(shown, { type: "hide", id: "todo" });
  assert.deepEqual(visibleIds(hidden), ["today", "goals", "weight", "water"]);
  assert.equal(hidden.find((item) => item.id === "todo")?.visible, false);
  assert.equal(layoutReducer(hidden, { type: "hide", id: "todo" }), hidden);
});

test("everything can be hidden, and that is kept rather than replaced by the default", () => {
  let layout: LayoutItem[] = defaultLayout();
  for (const id of visibleIds(layout)) layout = layoutReducer(layout, { type: "hide", id });
  assert.deepEqual(visibleIds(layout), []);
  assert.deepEqual(visibleIds(sanitizeLayout(serializeLayout(layout))), [], "an all-hidden layout survives a save");
});

test("reset and replace", () => {
  const changed = layoutReducer(defaultLayout(), { type: "move", id: "weight", delta: -2 });
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
  const layout = layoutReducer(defaultLayout(), { type: "move", id: "weight", delta: -1 });
  assert.equal(describePosition(layout, "weight"), "Weight, position 3 of 4");
  assert.equal(describePosition(layout, "water"), "Water is hidden");
});

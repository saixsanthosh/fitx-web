import { test } from "node:test";
import assert from "node:assert/strict";
import { nextTabIndex, resolveTab } from "@/components/ui/tabs-keys";

test("arrows move one tab and wrap around", () => {
  assert.equal(nextTabIndex("ArrowRight", 0, 4), 1);
  assert.equal(nextTabIndex("ArrowRight", 3, 4), 0);
  assert.equal(nextTabIndex("ArrowLeft", 0, 4), 3);
  assert.equal(nextTabIndex("ArrowLeft", 2, 4), 1);
});

test("Home and End jump to the ends", () => {
  assert.equal(nextTabIndex("Home", 2, 4), 0);
  assert.equal(nextTabIndex("End", 0, 4), 3);
});

test("disabled tabs are skipped", () => {
  const disabled = [false, true, true, false];
  assert.equal(nextTabIndex("ArrowRight", 0, 4, { disabled }), 3);
  assert.equal(nextTabIndex("ArrowLeft", 3, 4, { disabled }), 0);
  assert.equal(nextTabIndex("Home", 3, 4, { disabled: [true, false, false, false] }), 1);
  assert.equal(nextTabIndex("End", 0, 4, { disabled: [false, false, false, true] }), 2);
  assert.equal(nextTabIndex("ArrowRight", 0, 2, { disabled: [false, true] }), 0);
});

test("right-to-left swaps the arrows", () => {
  assert.equal(nextTabIndex("ArrowLeft", 0, 3, { rtl: true }), 1);
  assert.equal(nextTabIndex("ArrowRight", 0, 3, { rtl: true }), 2);
});

test("other keys, no tabs, and all-disabled lists give null", () => {
  assert.equal(nextTabIndex("Enter", 0, 3), null);
  assert.equal(nextTabIndex("ArrowDown", 0, 3), null);
  assert.equal(nextTabIndex("ArrowRight", 0, 0), null);
  assert.equal(nextTabIndex("Home", 0, 2, { disabled: [true, true] }), null);
  assert.equal(nextTabIndex("ArrowRight", 0, 2, { disabled: [true, true] }), null);
});

test("resolveTab keeps a valid choice and falls back to the first enabled tab", () => {
  const tabs = [{ id: "a", disabled: true }, { id: "b" }, { id: "c" }];
  assert.equal(resolveTab(tabs, "c"), "c");
  assert.equal(resolveTab(tabs, "a"), "b");
  assert.equal(resolveTab(tabs, "nope"), "b");
  assert.equal(resolveTab(tabs, null), "b");
  assert.equal(resolveTab([], "x"), null);
});

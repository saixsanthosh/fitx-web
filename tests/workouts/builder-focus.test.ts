// Bug 14 (workouts-3): in the workout builder, Swap and Remove dropped keyboard focus to the page body (the row is
// rebuilt for a swap and deleted for a remove), and Tab then walked the page behind the open dialog.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { focusAfterRemove, focusAfterSwap, removeNotice, swapNotice } from "@/app/(dashboard)/workouts/_lib/builder-rows";

describe("where focus goes", () => {
  test("after a swap: the same row's Swap button", () => {
    assert.deepEqual(focusAfterSwap(2), { row: 2, control: "swap" });
  });

  test("after a remove: the Remove button of the row taking its place, else the new last row, else the list's heading", () => {
    assert.deepEqual(focusAfterRemove(5, 1), { row: 1, control: "remove" }, "the next row moves up into place");
    assert.deepEqual(focusAfterRemove(5, 4), { row: 3, control: "remove" }, "the last row: the one before it");
    assert.deepEqual(focusAfterRemove(2, 0), { row: 0, control: "remove" });
    assert.deepEqual(focusAfterRemove(1, 0), { heading: true }, "nothing left: the Exercise order heading");
  });

  test("what the live region says", () => {
    assert.equal(swapNotice("Push-Up", "Push-Up Wide"), "Swapped Push-Up for Push-Up Wide.");
    assert.equal(removeNotice("Superman", 5), "Removed Superman. 5 exercises left.");
    assert.equal(removeNotice("Superman", 1), "Removed Superman. 1 exercise left.");
    assert.equal(removeNotice("Superman", 0), "Removed Superman. No exercises left.");
  });
});

describe("the builder (JSX, read from the source)", () => {
  const page = readFileSync("src/app/(dashboard)/workouts/page.tsx", "utf8");
  const row = readFileSync("src/components/workouts/BuilderRow.tsx", "utf8");
  const sheet = readFileSync("src/components/workouts/Sheet.tsx", "utf8");

  test("rows and their Swap and Remove buttons can be found again after the list changes", () => {
    assert.match(row, /<li data-builder-row=\{index\}/);
    assert.match(row, /onClick=\{onSwap\} data-builder-control="swap"/);
    assert.match(row, /onClick=\{onRemove\} data-builder-control="remove"/);
    assert.match(page, /<h3 id="builder-order-title" tabIndex=\{-1\}/);
  });

  test("swap and remove set the target, an effect focuses it, and the live region says what changed", () => {
    assert.match(page, /setBuilderFocus\(\(current\) => \(\{ target: focusAfterSwap\(index\)/);
    assert.match(page, /setBuilderFocus\(\(current\) => \(\{ target: focusAfterRemove\(preview\.length, index\)/);
    assert.match(page, /\[data-builder-row="\$\{builderFocus\.target\.row\}"\] \[data-builder-control="\$\{builderFocus\.target\.control\}"\]/);
    assert.match(page, /onRemove=\{\(\) => removePreview\(index, item\)\}/);
    assert.match(page, /<p role="status" className="sr-only">\{builderNotice\}<\/p>/);
  });

  test("Tab from outside the builder or a sheet (the page body) goes back in, never to the page behind", () => {
    assert.match(page, /if \(!dialog!\.contains\(document\.activeElement\)\) \{ event\.preventDefault\(\); \(event\.shiftKey \? last : first\)\.focus\(\); \}/);
    assert.match(sheet, /if \(!panel\.contains\(document\.activeElement\)\) \{ event\.preventDefault\(\); \(event\.shiftKey \? last : first\)\.focus\(\); \}/);
  });
});

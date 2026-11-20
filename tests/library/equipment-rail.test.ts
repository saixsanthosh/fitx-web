import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The library's Equipment tiles: one sideways row on phones (like Focus), a grid from 640 px.
test("the library's equipment is a phone rail and a grid from sm", () => {
  const source = readFileSync(new URL("../../src/components/exercises/discovery/EquipmentGrid.tsx", import.meta.url), "utf8");
  const group = source.match(/aria-label="Equipment you have"[\s\S]*?className=\{`([^`]+)`\}/)?.[1] ?? "";
  assert.match(group, /\$\{styles\.rail\}/);
  assert.match(group, /\bflex\b[\s\S]*\boverflow-x-auto\b/);
  assert.match(group, /\bsm:grid\b[\s\S]*\bsm:overflow-visible\b/);
  assert.match(source, /w-\[104px\] shrink-0/, "tiles keep a fixed width in the rail");
  assert.match(source, /sm:w-full/, "and fill their cell in the grid");
});

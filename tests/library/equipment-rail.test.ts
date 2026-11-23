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
  assert.match(source, /size="sm"/, "the rail uses the narrow tile");
  const css = readFileSync(new URL("../../src/components/equipment/EquipmentTile.module.css", import.meta.url), "utf8");
  assert.match(css, /\.sm \{ width: 6\.5rem; flex-shrink: 0;/, "tiles keep a fixed width (104 px) in the rail");
  assert.match(css, /@media \(min-width: 640px\) \{\s*\.sm \{ width: auto; \}/, "and fill their cell in the grid");
});

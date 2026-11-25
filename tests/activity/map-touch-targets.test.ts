// Bug 77 (the activity maps' part): the Record screen's Zoom in and Zoom out buttons were 40 × 40 px on a touch
// phone. MapLibre draws them; FITX's map stylesheet sizes them, and every FITX control over the map is 44 px.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync("src/components/activity/ActivityMap.module.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (selector: string) => css.match(new RegExp(`${selector.replace(/[.()]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";

test("the map's zoom buttons are 44 × 44 px", () => {
  const zoom = rule(".frame :global(.maplibregl-ctrl-group button)");
  assert.match(zoom, /width: 44px;/);
  assert.match(zoom, /height: 44px;/);
});

test("the other controls over the map stay 44 px: re-centre, and the Record screen's Hide map", () => {
  const recenter = rule(".recenter");
  assert.match(recenter, /width: 44px;/);
  assert.match(recenter, /height: 44px;/);
  const screen = readFileSync("src/components/activity/ActivityRecorderScreen.tsx", "utf8");
  assert.match(screen, /aria-label="Hide map \(saves battery\)" className="[^"]*\bmin-h-11\b/);
  assert.match(readFileSync("src/components/activity/ActivityMap.tsx", "utf8"), /new NavigationControl\(\{ showCompass: false \}\)/, "zoom in and out are MapLibre's buttons");
});

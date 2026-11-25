import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LAUNCHER_SIZE } from "../../src/lib/shell/coach-launcher-position.ts";

// Bug 77 (the shell's part): on a touch phone the header's account button measured 42 x 44 (a 34 px avatar with
// 4 px each side) and the floating "Hide AI Coach button" 22 x 22. Both are now 44 x 44 px targets. The other
// controls in that bug (sign-in links, body map, record map zoom) belong to other areas.
const source = (file: string) => readFileSync(file, "utf8");
const css = (file: string) => source(file).replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (styles: string, selector: string) => styles.match(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
const px = (block: string, property: string) => Number(block.match(new RegExp(`(?:^|;|\\s)${property}: (-?[\\d.]+)px`))?.[1] ?? Number.NaN);

test("the header's account button is at least 44 x 44 px, the avatar centred in it (was 42 x 44)", () => {
  const menu = source("src/components/layout/AccountMenu.tsx");
  // The header's trigger (the sidebar's account card is the other placement).
  const trigger = menu.match(/: "(flex min-h-11 [^"]+)"\}\s*>/)?.[1] ?? "";
  for (const token of ["flex", "min-h-11", "min-w-11", "items-center", "justify-center"]) assert.ok(trigger.split(/\s+/).includes(token), token);
});

test("the Hide AI Coach button is itself the 44 x 44 px target, with its 22 px badge drawn in the corner by the disc", () => {
  const styles = css("src/components/layout/CoachLauncher.module.css");
  const hide = rule(styles, ".hide");
  assert.equal(px(hide, "width"), 44);
  assert.equal(px(hide, "height"), 44);
  assert.match(hide, /background: transparent;/, "the square itself is see-through");
  const badge = rule(styles, ".hide::before");
  assert.equal(px(badge, "width"), 22);
  assert.equal(px(badge, "height"), 22);
  assert.match(badge, /right: 0;[\s\S]*bottom: 0;/, "the badge sits in the corner nearest the disc");

  // Geometry around the 52 px disc (the button's box from 0 to 52): the badge stays where it was (13 px out from the
  // disc's corner), and the 44 px area reaches out away from the disc, overlapping only its corner's bounding box.
  const top = px(hide, "top");
  const left = px(hide, "left");
  assert.deepEqual([top, left], [-35, -35]);
  const badgeBox = { left: left + 44 - 22, top: top + 44 - 22 };
  assert.deepEqual(badgeBox, { left: -13, top: -13 }, "the badge has not moved");
  const centre = LAUNCHER_SIZE / 2;
  const farthestIn = { x: left + 44, y: top + 44 };
  // The area's innermost corner is only just inside the disc's edge: a press on the disc's face never hides it.
  assert.ok(Math.hypot(centre - farthestIn.x, centre - farthestIn.y) > centre - 3, "at most a sliver of the disc's rim");
  // On the left edge the same, mirrored.
  assert.match(styles, /^\.left \.hide \{ left: auto; right: -35px;/m);
  assert.match(styles, /^\.left \.hide::before \{ right: auto; left: 0; \}/m);
  // The keyboard ring goes round the badge.
  assert.match(styles, /^\.hide:focus-visible::before \{ outline: 2px solid var\(--fitx-primary\); outline-offset: 2px; \}/m);
  // Still named for screen readers and still the same button.
  assert.match(source("src/components/layout/CoachLauncher.tsx"), /<button type="button" aria-label="Hide AI Coach button" title="Hide until you reload" className=\{styles\.hide\}/);
});

// Bug 77 (the activity maps' part): the Record screen's Zoom in and Zoom out buttons were 40 × 40 px on a touch
// phone. MapLibre draws them; FITX's map stylesheet sizes them, and every FITX control over the map is 44 px.
// Review round: the taller zoom column then reached further down the map, and on the Record screen's short live
// map the re-centre button (it was bottom right) covered the lower half of Zoom out. FITX's own controls and
// notices over the map now keep out of the zoom column, at every map size the Record screen uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync("src/components/activity/ActivityMap.module.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (selector: string) => css.match(new RegExp(`${selector.replace(/[.()]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";
const screen = readFileSync("src/components/activity/ActivityRecorderScreen.tsx", "utf8");

test("the map's zoom buttons are 44 × 44 px", () => {
  const zoom = rule(".frame :global(.maplibregl-ctrl-group button)");
  assert.match(zoom, /width: 44px;/);
  assert.match(zoom, /height: 44px;/);
});

test("the other controls over the map stay 44 px: re-centre, and the Record screen's Hide map", () => {
  const recenter = rule(".recenter");
  assert.match(recenter, /width: 44px;/);
  assert.match(recenter, /height: 44px;/);
  assert.match(screen, /aria-label="Hide map \(saves battery\)" className="[^"]*\bmin-h-11\b/);
  assert.match(readFileSync("src/components/activity/ActivityMap.tsx", "utf8"), /new NavigationControl\(\{ showCompass: false \}\)/, "zoom in and out are MapLibre's buttons");
});

// ------------------------------------------------------------------ where the controls sit

type Box = { left: number; top: number; right: number; bottom: number };
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const px = (block: string, property: string): number | null => {
  const found = block.match(new RegExp(`(?:^|[\\s;])${property}: (\\d+(?:\\.\\d+)?)px;`));
  return found ? Number(found[1]) : null;
};
const number = (value: string | undefined, what: string): number => {
  assert.ok(value !== undefined, `${what} not found`);
  return Number(value);
};

// MapLibre puts a top-right control 10 px in from the edges; FITX gives the group a 1 px border round two buttons.
const maplibre = readFileSync("node_modules/maplibre-gl/dist/maplibre-gl.css", "utf8");
const margin = maplibre.match(/\.maplibregl-ctrl-top-right \.maplibregl-ctrl\{margin:(\d+)px (\d+)px 0 0/);
const ZOOM_TOP = number(margin?.[1], "MapLibre's top-right margin");
const ZOOM_RIGHT = number(margin?.[2], "MapLibre's top-right margin");
const BORDER = number(rule(".frame :global(.maplibregl-ctrl-group)").match(/border: (\d+)px solid/)?.[1], "the zoom group's border");
const BUTTON = px(rule(".frame :global(.maplibregl-ctrl-group button)"), "height") ?? 0;

/** Zoom in above Zoom out, in their bordered group, on a map `width` px wide. */
const zoomColumn = (width: number): Box => ({
  left: width - ZOOM_RIGHT - (BUTTON + 2 * BORDER), right: width - ZOOM_RIGHT, top: ZOOM_TOP, bottom: ZOOM_TOP + 2 * BUTTON + 2 * BORDER,
});

/** The re-centre button on a map `width` × `height` px whose lower edge is covered by `insetBottom` px. */
function recenter(width: number, height: number, insetBottom: number): Box {
  const block = rule(".recenter");
  const size = px(block, "width") ?? 0;
  const above = number(block.match(/bottom: calc\((\d+)px \+ var\(--fitx-map-inset-bottom, 0px\)\)/)?.[1], "re-centre's bottom");
  const left = px(block, "left");
  const x = left ?? width - (px(block, "right") ?? 0) - size;
  const bottom = height - above - insetBottom;
  return { left: x, right: x + size, top: bottom - size, bottom };
}

// The Record screen's map: its covered lower edge on phones and large screens, and its smallest heights.
const PHONE_INSET = number(screen.match(/"w-full \[--fitx-map-inset-bottom:(\d+)px\]/)?.[1], "the phone inset");
const WIDE_INSET = number(screen.match(/lg:\[--fitx-map-inset-bottom:(\d+)px\]/)?.[1], "the large-screen inset");
const LIVE_MIN = number(screen.match(/live \? "[^"]*\bmin-h-(\d+)\b/)?.[1], "the live map's least height") * 4;
const IDLE_MIN = number(screen.match(/: "[^"]*\bmin-h-(\d+)\b[^"]*",\n\s*\)\}/)?.[1], "the map's least height before Start") * 4;
const WIDE_MIN = number(screen.match(/lg:min-h-\[(\d+)px\]/)?.[1], "the large-screen least height");
// Hide map: top-left, 10 px in (left-2.5 top-2.5), 44 px tall; its width depends on the font, so allow plenty.
const HIDE_MAP: Box = { left: 10, top: 10, right: 10 + 160, bottom: 10 + 44 };

test("the Record screen's sizes are read from its own classes", () => {
  assert.deepEqual([ZOOM_TOP, ZOOM_RIGHT, BORDER, BUTTON], [10, 10, 1, 44]);
  assert.deepEqual([PHONE_INSET, WIDE_INSET, LIVE_MIN, IDLE_MIN, WIDE_MIN], [28, 0, 192, 288, 520]);
  assert.match(screen, /aria-label="Hide map \(saves battery\)" className="absolute left-2\.5 top-2\.5 /);
  assert.deepEqual(zoomColumn(343), { left: 287, right: 333, top: 10, bottom: 100 });
});

test("re-centre never covers Zoom in, Zoom out or Hide map, down to the smallest live map", () => {
  // The old place (bottom right, 72 px up) overlapped Zoom out by 24 px on a 192 px map.
  const old = { left: 343 - 10 - 44, right: 343 - 10, top: LIVE_MIN - 72 - 44, bottom: LIVE_MIN - 72 };
  assert.equal(overlaps(old, zoomColumn(343)), true, "the overlap the review found");
  // Phones and tablets (below the large-screen layout): the live panel covers the map's lower edge.
  for (let width = 248; width <= 1000; width += 25) {
    for (let height = LIVE_MIN; height <= 900; height += 4) {
      const box = recenter(width, height, PHONE_INSET);
      assert.equal(overlaps(box, zoomColumn(width)), false, `zoom, ${width} × ${height}`);
      assert.equal(overlaps(box, HIDE_MAP), false, `Hide map, ${width} × ${height}`);
      assert.ok(box.top >= 0, `inside the map, ${width} × ${height}`);
    }
  }
  for (const height of [IDLE_MIN, WIDE_MIN]) {
    assert.equal(overlaps(recenter(1024, height, WIDE_INSET), zoomColumn(1024)), false);
    assert.equal(overlaps(recenter(360, height, PHONE_INSET), zoomColumn(360)), false);
  }
});

test("the notice shown when map tiles fail stops short of the zoom column", () => {
  const right = px(rule(".notice.clearOfZoom"), "right") ?? 0;
  for (const width of [248, 343, 1000]) {
    const notice: Box = { left: 10, right: width - right, top: ZOOM_TOP, bottom: ZOOM_TOP + 80 };
    assert.equal(overlaps(notice, zoomColumn(width)), false, `${width} px wide`);
    assert.ok(zoomColumn(width).left - notice.right >= 10, "with a gap");
  }
  assert.match(readFileSync("src/components/activity/ActivityMap.tsx", "utf8"), /tilesFailed && <p className=\{`\$\{styles\.notice\} \$\{styles\.clearOfZoom\}\$\{recentre \? ` \$\{styles\.clearOfRecenter\}` : ""\}`\}>/);
});

// Round 3c: on the Record screen's shortest live map, once the map was dragged, re-centre (bottom left) sat over the
// start of the tiles notice's second line. While it shows, the notice now starts right of its column.
const INSET_TOP = number(screen.match(/\[--fitx-map-inset-top:(\d+)px\]/)?.[1], "the Record screen's top inset");

test("while re-centre shows, the tiles notice keeps clear of it, down to the shortest live map", () => {
  const left = px(rule(".notice.clearOfRecenter"), "left") ?? 0;
  const right = px(rule(".notice.clearOfZoom"), "right") ?? 0;
  const top = number(rule(".notice").match(/top: calc\((\d+)px \+ var\(--fitx-map-inset-top, 0px\)\)/)?.[1], "the notice's top") + INSET_TOP;
  // The place the re-check found: a 343 px wide, 192 px tall map, the notice's two lines over the button.
  const before: Box = { left: px(rule(".notice"), "left") ?? 0, right: 343 - right, top, bottom: top + 52 };
  assert.equal(overlaps(before, recenter(343, LIVE_MIN, PHONE_INSET)), true, "the overlap the re-check saw");
  for (let width = 248; width <= 1000; width += 25) {
    for (let height = LIVE_MIN; height <= 900; height += 4) {
      const button = recenter(width, height, PHONE_INSET);
      // However many lines its words take (down to the map's foot), the notice starts right of the button.
      const notice: Box = { left, right: width - right, top, bottom: height };
      assert.equal(overlaps(notice, button), false, `${width} × ${height}`);
      assert.ok(notice.left - button.right >= 10, "with a gap");
      assert.ok(notice.right - notice.left >= 100, `room for the words at ${width} px`);
    }
  }
  assert.match(readFileSync("src/components/activity/ActivityMap.tsx", "utf8"), /const recentre = follow && !following && current !== null;/);
});

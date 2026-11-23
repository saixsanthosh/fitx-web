// The intro's overlay zones per composition (BRIEF-2 3.2 and 3.3): the matte, the title block, the callout
// areas and the end card's mark, as the overlay places them and as verify.mjs --framing reads them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMPOSITIONS, type FilmComposition } from "@/components/brand/films/compositions";
import { CALLOUTS, FILM_DURATION, LETTERBOX, STAGE_START, TITLES } from "@/components/brand/intro/timeline";
import {
  BRAND_ZONES,
  CALLOUT_ZONES,
  MATTES,
  NOMINAL_VIEWPORT,
  SCOPE_MAX_SHARE,
  TITLE_ZONES,
  calloutPlacement,
  calloutZone,
  frameZones,
  matteShare,
  nominalAspect,
  overlayZones,
  overlayZonesAt,
  toFrame,
  type ZoneBox,
} from "@/components/brand/overlay-zones";

const ids = COMPOSITIONS.map((band) => band.id);
const overlaps = (a: ZoneBox, b: ZoneBox) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const inUnit = (box: ZoneBox) => box.x0 >= 0 && box.y0 >= 0 && box.x1 <= 1 && box.y1 <= 1 && box.x0 < box.x1 && box.y0 < box.y1;
const contains = (outer: ZoneBox, inner: ZoneBox, eps = 1e-4) =>
  inner.x0 >= outer.x0 - eps && inner.y0 >= outer.y0 - eps && inner.x1 <= outer.x1 + eps && inner.y1 <= outer.y1 + eps;

test("every composition has a matte, a title block, an area for each placement and a brand zone", () => {
  for (const comp of ids) {
    assert.ok(MATTES[comp], comp);
    assert.ok(inUnit(TITLE_ZONES[comp]), `${comp} title`);
    assert.ok(inUnit(BRAND_ZONES[comp]), `${comp} brand`);
    for (const placement of ["right", "left", "bottom"] as const) assert.ok(inUnit(CALLOUT_ZONES[comp][placement]), `${comp} ${placement}`);
    const { width, height } = NOMINAL_VIEWPORT[comp];
    const band = COMPOSITIONS.find((entry) => entry.id === comp)!;
    assert.ok(width / height >= band.checkMin && width / height <= band.checkMax, `${comp}'s nominal screen is inside its band`);
  }
});

test("the matte: 2.39:1 scope on laptop and desktop (at most 14% a bar), thin on the tablets and the phone", () => {
  assert.equal(MATTES.laptop.kind, "scope");
  assert.equal(MATTES.desktop.kind, "scope");
  for (const comp of ["phone", "tablet-p", "tablet-l"] as const) assert.equal(MATTES[comp].kind, "thin");
  assert.ok(Math.abs(matteShare("laptop", 16 / 9) - (1 - 16 / 9 / 2.39) / 2) < 1e-12);
  assert.equal(matteShare("laptop", 1.54), SCOPE_MAX_SHARE, "capped on the squarest laptop");
  assert.equal(matteShare("desktop", 2.39), 0, "no bars at 2.39:1");
  assert.equal(matteShare("desktop", 2.6), 0);
  assert.equal(matteShare("phone", 0.46), 0.05);
  assert.ok(Math.abs(matteShare("phone", 0.46, 1000) - 0.044) < 1e-12, "a tall phone: the 44 px cap");
  assert.ok(matteShare("tablet-l", 1.44) < matteShare("phone", 0.46), "tablet-l's matte is thinner than the phone's");
});

test("the CSS keys the same mattes on the composition", () => {
  const css = readFileSync("src/components/brand/IntroFilmOverlay.module.css", "utf8");
  assert.match(css, /\.film\[data-comp="laptop"\],\s*\.film\[data-comp="desktop"\] \{ --bar: clamp\(0px, calc\(\(100vh - 100vw \/ 2\.39\) \/ 2\), 14vh\); \}/);
  assert.match(css, /\.film\[data-comp="phone"\],\s*\.film\[data-comp="tablet-p"\] \{ --bar: clamp\(0px, 5vh, 44px\); \}/);
  assert.match(css, /\.film\[data-comp="tablet-l"\] \{ --bar: clamp\(0px, 4vh, 40px\); \}/);
  const thin = MATTES["tablet-l"];
  assert.ok(thin.kind === "thin" && thin.share === 0.04 && thin.maxPx === 40);
  // Callouts are placed from the zone (custom properties written by IntroFilmOverlay).
  for (const name of ["--zx0", "--zy0", "--zx1", "--zy1"]) assert.ok(css.includes(`var(${name}`), name);
  const tsx = readFileSync("src/components/brand/IntroFilmOverlay.tsx", "utf8");
  assert.match(tsx, /CALLOUT_ZONES\[comp\]\[placement\]/);
  assert.match(tsx, /data-comp=\{comp \?\? undefined\}/);
});

test("titles and callouts stay clear of the matte at both edges of every band", () => {
  for (const band of COMPOSITIONS) {
    for (const aspect of [band.checkMin, band.checkMax]) {
      const bar = matteShare(band.id, aspect);
      const boxes = [TITLE_ZONES[band.id], ...Object.values(CALLOUT_ZONES[band.id])];
      for (const box of boxes) assert.ok(box.y0 >= bar - 1e-9 && box.y1 <= 1 - bar + 1e-9, `${band.id} at ${aspect}: ${JSON.stringify(box)} vs bar ${bar}`);
    }
  }
});

test("every callout has a placement on every composition, and none overlaps a title on screen at the same time", () => {
  for (const callout of CALLOUTS) {
    assert.deepEqual(Object.keys(callout.placement).sort(), [...ids].sort(), callout.id);
    for (const comp of ids) {
      assert.equal(calloutPlacement(callout.id, comp), callout.placement[comp]);
      assert.deepEqual(calloutZone(callout.id, comp), CALLOUT_ZONES[comp][callout.placement[comp]]);
      for (const title of TITLES) {
        const together = callout.start < title.end && title.start < callout.end;
        if (together) assert.ok(!overlaps(calloutZone(callout.id, comp), TITLE_ZONES[comp]), `${callout.id} vs ${title.text} on ${comp}`);
      }
    }
  }
  // Two callouts are never on screen at once.
  const sorted = [...CALLOUTS].sort((a, b) => a.start - b.start);
  for (let index = 1; index < sorted.length; index += 1) assert.ok(sorted[index].start >= sorted[index - 1].end, sorted[index].id);
});

test("the brand zone sits in the middle and only from the brand stage", () => {
  for (const comp of ids) {
    const box = BRAND_ZONES[comp];
    assert.ok(Math.abs((box.x0 + box.x1) / 2 - 0.5) < 1e-9 && Math.abs((box.y0 + box.y1) / 2 - 0.5) < 1e-9, comp);
    assert.ok(!overlayZonesAt(comp, 10.5).some((zone) => zone.id === "brand"));
    assert.ok(overlayZonesAt(comp, 10.6).some((zone) => zone.id === "brand"));
    assert.ok(overlayZonesAt(comp, FILM_DURATION - 0.01).some((zone) => zone.id === "brand"));
  }
});

test("zones by time: the matte for the whole film, each title and callout only while it shows", () => {
  for (const comp of ids) {
    const zones = overlayZones(comp);
    assert.equal(zones.filter((zone) => zone.id.startsWith("title-")).length, TITLES.length);
    assert.equal(zones.filter((zone) => zone.id.startsWith("callout-")).length, CALLOUTS.length);
    const top = zones.find((zone) => zone.id === "letterbox-top");
    assert.ok(top && top.start === LETTERBOX.inStart && top.end === LETTERBOX.outEnd, comp);
    const atPace = overlayZonesAt(comp, 3).map((zone) => zone.id);
    assert.ok(atPace.includes("callout-pace") && atPace.includes("title-train") && !atPace.includes("callout-cadence"));
    assert.ok(!overlayZonesAt(comp, STAGE_START[6] + 1).some((zone) => zone.id.startsWith("letterbox")), "the matte is gone in the tail");
  }
});

test("viewport zones map into the frame a cover fit shows; frameZones holds them at both band edges", () => {
  const box = { x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.5 };
  for (const band of COMPOSITIONS) {
    assert.deepEqual(toFrame(box, band.id, band.aspect), box, `${band.id}: identity at the render aspect`);
    const narrow = toFrame({ x0: 0, y0: 0, x1: 1, y1: 1 }, band.id, band.aspect * 0.8);
    assert.ok(Math.abs(narrow.x1 - narrow.x0 - 0.8) < 1e-12 && narrow.y0 === 0 && narrow.y1 === 1, "narrower: width cropped");
    const wide = toFrame({ x0: 0, y0: 0, x1: 1, y1: 1 }, band.id, band.aspect * 1.25);
    assert.ok(Math.abs(wide.y1 - wide.y0 - 0.8) < 1e-12 && wide.x0 === 0 && wide.x1 === 1, "wider: height cropped");
    const zones = frameZones(band.id, FILM_DURATION);
    const atMin = overlayZones(band.id, band.checkMin);
    const atMax = overlayZones(band.id, band.checkMax);
    zones.forEach((zone, index) => {
      assert.equal(zone.comp, band.id);
      assert.ok(Number.isFinite(zone.end) && zone.end <= FILM_DURATION, "JSON-safe end");
      assert.ok(contains(zone.box, toFrame(atMin[index].box, band.id, band.checkMin)), `${band.id} ${zone.id} at min`);
      assert.ok(contains(zone.box, toFrame(atMax[index].box, band.id, band.checkMax)), `${band.id} ${zone.id} at max`);
    });
    assert.ok(JSON.parse(JSON.stringify(zones)).length === zones.length);
  }
});

test("nominal aspects are each composition's real screen", () => {
  const expected: Record<FilmComposition, number> = { phone: 390 / 844, "tablet-p": 820 / 1180, "tablet-l": 1180 / 820, laptop: 1440 / 810, desktop: 2 };
  for (const comp of ids) assert.ok(Math.abs(nominalAspect(comp) - expected[comp]) < 1e-12, comp);
});

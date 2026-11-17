import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeRoute } from "@/lib/activity/polyline";
import {
  busyness, calmerBand, CARD_FORMATS, CARD_SIZE, cardHeroes, cardStats, composite, contrastRatio, coverRect, photoLayout, relativeLuminance,
  requiredScrimAlpha, RIDE_CLIMB_HERO_M, ROUTE_HIDDEN_NOTE, routeLayout, routeState, SCRIM_TARGET_CONTRAST, type CardData, type CardLayout, type Rgb,
} from "@/lib/activity/share-layouts";
import { ORIGIN, legs } from "./support/tracks";

const ROUTE = encodeRoute([legs(ORIGIN, [[0, 1500], [90, 800], [180, 600]])]);
const base: CardData = {
  sport: "run", title: "Cubbon Park evening run", startedAt: Date.UTC(2026, 10, 17, 12), distanceM: 5240, movingSeconds: 1610,
  avgSpeedMps: 5240 / 1610, avgPaceSecondsPerKm: 307, kcal: 380, elevationGainM: 42, sharePolyline: ROUTE, hadRoute: true, source: "fitx_gps",
};

const texts = (layout: CardLayout) => layout.ops.flatMap((op) => (op.kind === "text" ? [op.text] : op.kind === "value" ? [`${op.value}${op.unit}`] : []));

test("each sport leads with its own numbers; only recorded ones appear", () => {
  assert.deepEqual(cardStats(base).map((s) => s.key), ["pace", "moving", "climb", "kcal"]);
  assert.deepEqual(cardStats({ ...base, sport: "walk" }).map((s) => s.key), ["moving", "pace", "climb", "kcal"]);
  assert.deepEqual(cardStats({ ...base, sport: "ride", elevationGainM: 40 }).map((s) => s.key), ["speed", "moving", "climb", "kcal"]);
  // Unknown values are left out, never drawn as a dash or a zero.
  assert.deepEqual(cardStats({ ...base, avgPaceSecondsPerKm: null, kcal: null, elevationGainM: null }).map((s) => s.key), ["moving"]);
  assert.deepEqual(cardStats({ ...base, sport: "ride", avgSpeedMps: null, kcal: null, elevationGainM: null }).map((s) => s.key), ["moving"]);
  // An imported file's climb isn't called GPS.
  assert.equal(cardStats({ ...base, source: "file" }).find((s) => s.key === "climb")?.label, "Climb");
  assert.equal(cardStats(base).find((s) => s.key === "kcal")?.label, "Calories (est.)");
});

test("a ride's big climb becomes a second headline", () => {
  assert.deepEqual(cardHeroes(base).map((h) => h.key), ["distance"]);
  const climb = { ...base, sport: "ride" as const, elevationGainM: RIDE_CLIMB_HERO_M + 320 };
  assert.deepEqual(cardHeroes(climb).map((h) => `${h.key}:${h.value}${h.unit}`), ["distance:5.24km", "climb:420m"]);
  assert.equal(cardStats(climb).some((s) => s.key === "climb"), false, "not twice");
});

test("the route: drawn when something is left after the privacy trim; otherwise a note or nothing", () => {
  assert.equal(routeState(base), "shown");
  assert.equal(routeState({ ...base, sharePolyline: "" }), "hidden");
  assert.equal(routeState({ ...base, sharePolyline: "", hadRoute: false }), "none");
  assert.equal(routeState({ ...base, sharePolyline: "", hadRoute: undefined }), "none");
  for (const format of CARD_FORMATS) {
    const shown = routeLayout(base, format, "fitx.app");
    assert.equal(shown.ops.filter((op) => op.kind === "route").length, 1);
    assert.equal(texts(shown).includes(ROUTE_HIDDEN_NOTE), false);
    const hidden = routeLayout({ ...base, sharePolyline: "" }, format, "fitx.app");
    assert.equal(hidden.ops.some((op) => op.kind === "route"), false, "no empty frame");
    assert.equal(texts(hidden).includes(ROUTE_HIDDEN_NOTE), true);
    const none = routeLayout({ ...base, sharePolyline: "", hadRoute: false }, format, "fitx.app");
    assert.equal(texts(none).includes(ROUTE_HIDDEN_NOTE), false);
  }
});

test("every layout keeps its drawing inside the card, with the date, distance and brand", () => {
  const cases: CardData[] = [base, { ...base, sport: "ride", elevationGainM: 640 }, { ...base, sharePolyline: "", hadRoute: false }, { ...base, kcal: null, elevationGainM: null }];
  for (const format of CARD_FORMATS) {
    const { width, height } = CARD_SIZE[format];
    for (const data of cases) {
      for (const layout of [routeLayout(data, format, "fitx.app"), photoLayout(data, format, "top"), photoLayout(data, format, "bottom")]) {
        for (const op of layout.ops) {
          const box = op.kind === "route" ? op.box : { x: op.x, y: op.y, width: 0, height: 0 };
          assert.ok(box.x >= -10 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= height, `${format} ${layout.mode} ${op.kind} at ${box.x},${box.y}`);
        }
        const all = texts(layout).join(" | ");
        assert.match(all, /FITX/);
        assert.match(all, /(RUN|RIDE) · 17 Nov 2026/);
        assert.match(all, /5\.24km/);
      }
    }
  }
});

test("photo layouts: the text hangs from the calmer edge and its area is what the scrim covers", () => {
  for (const format of CARD_FORMATS) {
    const { height } = CARD_SIZE[format];
    const top = photoLayout(base, format, "top");
    const bottom = photoLayout(base, format, "bottom");
    assert.ok(top.textArea && top.textArea.y < height * 0.1 && top.textArea.y + top.textArea.height < height * 0.62, `${format} top`);
    assert.ok(bottom.textArea && bottom.textArea.y > height * 0.38 && bottom.textArea.y + bottom.textArea.height <= height, `${format} bottom`);
    // Every text op sits inside the scrimmed area.
    for (const layout of [top, bottom]) {
      for (const op of layout.ops) {
        if (op.kind !== "text" && op.kind !== "value") continue;
        assert.ok(op.y >= layout.textArea!.y && op.y <= layout.textArea!.y + layout.textArea!.height, `${format} ${layout.band}: "${op.kind === "text" ? op.text : op.value}" at ${op.y}`);
      }
    }
  }
});

test("photo cropping covers the card without stretching, placed by the focus", () => {
  // A landscape 4000x3000 photo on a 1080x1920 story: the full height, a slice of the width, centred.
  const crop = coverRect(4000, 3000, 1080, 1920);
  assert.ok(Math.abs(crop.sh - 3000) < 1e-9);
  assert.ok(Math.abs(crop.sw / crop.sh - 1080 / 1920) < 1e-9);
  assert.ok(Math.abs(crop.sx - (4000 - crop.sw) / 2) < 1e-9);
  // A tall photo on a square: the full width; the focus picks top, centre or bottom.
  assert.equal(coverRect(1000, 3000, 1080, 1080, 0).sy, 0);
  assert.equal(coverRect(1000, 3000, 1080, 1080, 1).sy, 2000);
  assert.equal(coverRect(1000, 3000, 1080, 1080, 0.5).sy, 1000);
});

test("contrast maths match WCAG", () => {
  assert.equal(relativeLuminance([255, 255, 255]), 1);
  assert.equal(relativeLuminance([0, 0, 0]), 0);
  assert.ok(Math.abs(contrastRatio([255, 255, 255], [0, 0, 0]) - 21) < 1e-9);
  assert.ok(Math.abs(contrastRatio([118, 118, 118], [255, 255, 255]) - 4.54) < 0.01);
  assert.deepEqual(composite([200, 100, 0], [0, 0, 0], 0.5), [100, 50, 0]);
});

test("the scrim is just dark enough for the text on the brightest part of the photo", () => {
  const text: Rgb = [243, 243, 239];
  const scrim: Rgb = [5, 8, 8];
  const pixels = (colours: Rgb[]) => colours.flatMap(([r, g, b]) => [r, g, b, 255]);
  assert.equal(requiredScrimAlpha(pixels([[0, 0, 0], [20, 30, 25]]), text, scrim), 0, "a dark photo needs none");
  const bright = pixels([[40, 40, 40], [255, 255, 255], [250, 240, 200]]);
  const alpha = requiredScrimAlpha(bright, text, scrim);
  assert.ok(alpha > 0.4 && alpha < 0.8, `alpha ${alpha}`);
  for (const colour of [[255, 255, 255], [250, 240, 200], [40, 40, 40]] as Rgb[]) {
    assert.ok(contrastRatio(text, composite(colour, scrim, alpha)) >= SCRIM_TARGET_CONTRAST - 1e-6, "the target is met on every pixel");
  }
  // The brightest pixel decides: a little less scrim would miss the target there.
  assert.ok(contrastRatio(text, composite([255, 255, 255], scrim, alpha - 0.01)) < SCRIM_TARGET_CONTRAST, "and it is the least that meets it");
  assert.ok(SCRIM_TARGET_CONTRAST >= 4.5, "never below WCAG's minimum for text");
});

test("the calmer half: flat sky beats a busy crowd", () => {
  const flat = new Array(54 * 20).fill(0.6);
  const busy = Array.from({ length: 54 * 20 }, (_, i) => ((i * 7) % 11) / 10);
  assert.ok(busyness(flat, 54) < busyness(busy, 54));
  assert.equal(calmerBand(busyness(flat, 54), busyness(busy, 54)), "top");
  assert.equal(calmerBand(busyness(busy, 54), busyness(flat, 54)), "bottom");
  assert.equal(calmerBand(0.2, 0.2), "top", "a tie keeps the text at the top");
  assert.equal(busyness([], 54), 0);
});

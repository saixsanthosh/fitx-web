import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPOSITIONS,
  FILM_ATTR,
  FILM_CUT_ATTR,
  pickComposition,
  type FilmComposition,
} from "@/components/brand/films/compositions";

const ids = COMPOSITIONS.map(({ id }) => id);
/** A viewport of the given aspect (1000 px high). */
const at = (aspect: number) => [aspect * 1000, 1000] as const;
const cover = (frame: number, viewport: number) =>
  viewport < frame ? { axis: "width", share: 1 - viewport / frame } : { axis: "height", share: 1 - frame / viewport };

test("the table: five compositions narrow to wide, with the render sizes of BRIEF-2 3.1", () => {
  assert.deepEqual(ids, ["phone", "tablet-p", "tablet-l", "laptop", "desktop"]);
  assert.deepEqual(COMPOSITIONS.map(({ width, height }) => `${width}x${height}`), ["960x1920", "1200x1600", "1600x1200", "1920x1080", "1920x960"]);
  for (const band of COMPOSITIONS) {
    assert.equal(band.aspect, band.width / band.height, band.id);
    assert.equal(band.authored, true, band.id);
    assert.ok(band.min <= band.aspect && band.aspect < band.max, `${band.id}'s own aspect is inside its band`);
  }
  assert.ok(Object.isFrozen(COMPOSITIONS));
  assert.equal(FILM_CUT_ATTR, "data-fitx-film-cut");
  assert.equal(FILM_ATTR, "data-fitx-film");
});

test("the bands tile every aspect, and each boundary is the log-midpoint of its neighbours to two decimals", () => {
  assert.equal(COMPOSITIONS[0].min, 0);
  assert.equal(COMPOSITIONS[COMPOSITIONS.length - 1].max, Infinity);
  assert.deepEqual(COMPOSITIONS.slice(1).map(({ min }) => min), [0.61, 1.0, 1.54, 1.89]);
  for (let index = 1; index < COMPOSITIONS.length; index += 1) {
    const [left, right] = [COMPOSITIONS[index - 1], COMPOSITIONS[index]];
    assert.equal(left.max, right.min, `${left.id} ends where ${right.id} starts`);
    assert.equal(Math.round(Math.sqrt(left.aspect * right.aspect) * 100) / 100, right.min, `${left.id} | ${right.id}`);
  }
});

test("the checked edges and the worst cover crop there match the arithmetic", () => {
  assert.deepEqual(COMPOSITIONS.map(({ checkMin, checkMax }) => [checkMin, checkMax]), [
    [0.42, 0.61], [0.61, 1.0], [1.0, 1.54], [1.54, 1.89], [1.89, 2.2],
  ]);
  for (const band of COMPOSITIONS) {
    for (const [edge, crop] of [[band.checkMin, band.worstCrop.atMin], [band.checkMax, band.worstCrop.atMax]] as const) {
      const expected = cover(band.aspect, edge);
      assert.equal(crop.axis, expected.axis, `${band.id} at ${edge}`);
      assert.ok(Math.abs(crop.share - expected.share) <= 0.005, `${band.id} at ${edge}: ${crop.share} vs ${expected.share.toFixed(4)}`);
    }
  }
});

test("pickComposition: real viewports land where BRIEF-2 3.1 says", () => {
  const cases: Array<[number, number, FilmComposition]> = [
    [390, 844, "phone"], [393, 659, "phone"], [412, 915, "phone"],
    [820, 1180, "tablet-p"], [1024, 1366, "tablet-p"],
    [1180, 820, "tablet-l"], [1000, 1000, "tablet-l"],
    [1440, 900, "laptop"], [1440, 790, "laptop"], [1512, 860, "laptop"], [1280, 720, "laptop"],
    [1920, 947, "desktop"], [1536, 730, "desktop"], [1366, 657, "desktop"], [1920, 960, "desktop"],
    [852, 393, "desktop"], [2560, 1080, "desktop"],
  ];
  for (const [width, height, expected] of cases) assert.equal(pickComposition(width, height), expected, `${width}x${height}`);
});

test("pickComposition: a viewport exactly on a boundary goes to the wider composition; ±0.005 either side", () => {
  for (let index = 1; index < COMPOSITIONS.length; index += 1) {
    const [left, right] = [COMPOSITIONS[index - 1], COMPOSITIONS[index]];
    const edge = right.min;
    assert.equal(pickComposition(...at(edge)), right.id, `exactly ${edge}`);
    assert.equal(pickComposition(...at(edge - 0.005)), left.id, `${edge} - 0.005`);
    assert.equal(pickComposition(...at(edge + 0.005)), right.id, `${edge} + 0.005`);
  }
  assert.equal(pickComposition(1000, 1000), "tablet-l", "a square window is exactly 1.00");
});

test("pickComposition: orientation alone never decides; the extremes stay on the end compositions", () => {
  assert.equal(pickComposition(844, 390), "desktop", "a phone turned to landscape is wide");
  assert.equal(pickComposition(390, 844), "phone");
  assert.equal(pickComposition(100, 1000), "phone", "narrower than the checked 0.42 still serves phone");
  assert.equal(pickComposition(5000, 1000), "desktop", "wider than 2.20 still serves desktop (with a scope matte)");
  assert.equal(pickComposition(1199, 1200), "tablet-p", "just under square is portrait");
});

test("pickComposition: a size that is not a usable number serves the 16:9 composition", () => {
  for (const [width, height] of [[0, 0], [1440, 0], [-1, 900], [Number.NaN, 900], [Infinity, 900]]) {
    assert.equal(pickComposition(width, height), "laptop", `${width}x${height}`);
  }
});

test("pickComposition with available: the band's composition when it exists", () => {
  for (const band of COMPOSITIONS) {
    assert.equal(pickComposition(...at(band.aspect), ids), band.id);
    assert.equal(pickComposition(...at(band.aspect), [band.id]), band.id);
  }
  assert.equal(pickComposition(390, 844, []), "phone", "an empty list serves the band's composition");
});

test("pickComposition with available: otherwise the nearest by log-aspect, ties to the wider", () => {
  const noLaptop = ids.filter((id) => id !== "laptop");
  // Between tablet-l (4:3) and desktop (2:1) the split is their log-midpoint, sqrt(4/3 × 2) ≈ 1.633.
  const split = Math.sqrt((4 / 3) * 2);
  assert.equal(pickComposition(...at(1.55), noLaptop), "tablet-l");
  assert.equal(pickComposition(...at(split - 0.001), noLaptop), "tablet-l");
  assert.equal(pickComposition(...at(split), noLaptop), "desktop", "a tie goes to the wider");
  assert.equal(pickComposition(...at(split + 0.001), noLaptop), "desktop");
  assert.equal(pickComposition(1440, 900, noLaptop), "tablet-l", "1.60 is nearer 4:3 than 2:1");
  assert.equal(pickComposition(1440, 790, noLaptop), "desktop", "1.82 is nearer 2:1");

  const noTabletP = ids.filter((id) => id !== "tablet-p");
  assert.equal(pickComposition(820, 1180, noTabletP), "phone", "0.69 is nearer 1:2 than 4:3");
  assert.equal(pickComposition(999, 1000, noTabletP), "tablet-l", "0.999 is nearer 4:3");
  const portraitSplit = Math.sqrt(0.5 * (4 / 3));
  assert.equal(pickComposition(...at(portraitSplit), noTabletP), "tablet-l", "a tie goes to the wider");

  assert.equal(pickComposition(390, 844, ["desktop"]), "desktop", "a single composition serves everything");
  assert.equal(pickComposition(2560, 1080, ["phone", "tablet-p"]), "tablet-p", "the widest available for a very wide window");
  assert.equal(pickComposition(300, 1000, ["laptop", "desktop"]), "laptop", "the narrowest available for a very narrow window");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { COMPOSITIONS, pickComposition, type FilmComposition } from "@/components/brand/films/compositions";
import { COMPOSITION_BANDS_ES5, PICK_COMPOSITION_ES5 } from "@/components/brand/films/bootstrap-twin";

/**
 * BRIEF-2 section 5 (film-runtime): the viewports below, with the composition each gets and the most of its frame a
 * cover fit may lose there; each band boundary ± 0.005; the `available` fallback; and parity between the head
 * script's ES5 twin and the module. Everything is read from COMPOSITIONS.
 */

const band = (id: FilmComposition) => COMPOSITIONS.find((entry) => entry.id === id)!;
/** The share of the frame a cover fit of `comp` loses on a viewport of `aspect`. */
const coverLoss = (comp: FilmComposition, aspect: number) => {
  const frame = band(comp).aspect;
  return aspect < frame ? 1 - aspect / frame : 1 - frame / aspect;
};
/** The band's ceiling: the worse of its two checked edges, and for desktop the scope matte above 2.20. */
const ceiling = (comp: FilmComposition) => Math.max(band(comp).worstCrop.atMin.share, band(comp).worstCrop.atMax.share) + 0.005;

const VIEWPORTS: Array<[number, number, FilmComposition, string]> = [
  [390, 844, "phone", "iPhone 14/15 (the e2e phone)"],
  [393, 659, "phone", "iPhone in Safari with its bars"],
  [412, 915, "phone", "Pixel"],
  [820, 1180, "tablet-p", "iPad Air portrait (the e2e tablet)"],
  [1024, 1366, "tablet-p", "iPad Pro portrait"],
  [1180, 820, "tablet-l", "iPad Air landscape"],
  [1000, 1000, "tablet-l", "a square window"],
  [1440, 900, "laptop", "MacBook full screen (the e2e desktop)"],
  [1440, 790, "laptop", "MacBook with browser chrome"],
  [1512, 860, "laptop", "MacBook Pro 14 with chrome"],
  [1280, 720, "laptop", "720p"],
  [1920, 947, "desktop", "1080p with chrome"],
  [1536, 730, "desktop", "Windows laptop at 125%"],
  [1366, 657, "desktop", "1366 laptop with chrome"],
  [1920, 960, "desktop", "the desktop render size"],
  [852, 393, "desktop", "a phone in landscape"],
  [2560, 1080, "desktop", "ultrawide (scope matte above 2.20)"],
  [768, 1024, "tablet-p", "iPad mini portrait"],
  [1024, 768, "tablet-l", "iPad mini landscape"],
  [360, 800, "phone", "a small Android"],
];

/** The head script's twin, evaluated as it runs in the page. */
const twin = vm.runInNewContext(`(${PICK_COMPOSITION_ES5})`) as (width: number, height: number, available?: readonly string[]) => string;

test("real viewports get the composition BRIEF-2 3.1 says, and a cover fit never loses more than the band allows", () => {
  for (const [width, height, expected, label] of VIEWPORTS) {
    const comp = pickComposition(width, height);
    assert.equal(comp, expected, `${label} ${width}×${height}`);
    const aspect = width / height;
    // Wider than desktop's 2.20 edge, the film is not cropped further: side bars (a scope matte) take the rest.
    const checked = comp === "desktop" ? Math.min(aspect, band("desktop").checkMax) : comp === "phone" ? Math.max(aspect, band("phone").checkMin) : aspect;
    assert.ok(coverLoss(comp, checked) <= ceiling(comp), `${label}: ${coverLoss(comp, checked).toFixed(3)} of the frame lost, ceiling ${ceiling(comp)}`);
  }
});

test("each band boundary: 0.005 below goes to the narrower composition, on it and 0.005 above to the wider", () => {
  for (let index = 1; index < COMPOSITIONS.length; index += 1) {
    const edge = COMPOSITIONS[index].min;
    const [narrow, wide] = [COMPOSITIONS[index - 1].id, COMPOSITIONS[index].id];
    assert.equal(pickComposition((edge - 0.005) * 1000, 1000), narrow, `${edge} - 0.005`);
    assert.equal(pickComposition(edge * 1000, 1000), wide, `${edge} exactly`);
    assert.equal(pickComposition((edge + 0.005) * 1000, 1000), wide, `${edge} + 0.005`);
  }
});

test("available: a film without a composition serves its band from the nearest one by log-aspect, ties to the wider", () => {
  const noLaptop: FilmComposition[] = ["phone", "tablet-p", "tablet-l", "desktop"];
  // 1.78 sits between tablet-l (1.33) and desktop (2.00): log distance 0.29 vs 0.12, so desktop.
  assert.equal(pickComposition(1920, 1080, noLaptop), "desktop");
  // 1.54 (the laptop band's lower edge): 0.146 from tablet-l, 0.262 from desktop.
  assert.equal(pickComposition(1540, 1000, noLaptop), "tablet-l");
  // Exactly between 1.333 and 2.0 by log-aspect (the geometric mean, 1.633): the tie goes to the wider.
  const middle = Math.sqrt((1600 / 1200) * 2);
  assert.equal(pickComposition(middle * 1000, 1000, ["tablet-l", "desktop"]), "desktop");
  assert.equal(pickComposition(390, 844, ["laptop"]), "laptop", "a single composition serves every band");
  assert.equal(pickComposition(390, 844, []), "phone", "an empty list means nothing to choose from");
  assert.equal(pickComposition(390, 844, ["phone", "desktop"]), "phone", "an available band composition is kept");
});

test("the head script's twin matches pickComposition on every viewport, edge and fallback", () => {
  assert.deepEqual(JSON.parse(COMPOSITION_BANDS_ES5).map((row: unknown[]) => row[0]), COMPOSITIONS.map(({ id }) => id));
  const lists: Array<readonly FilmComposition[] | undefined> = [
    undefined,
    [],
    ["phone", "tablet-p", "tablet-l", "laptop", "desktop"],
    ["phone", "tablet-p", "tablet-l", "desktop"],
    ["phone", "laptop"],
    ["tablet-l", "desktop"],
    ["desktop"],
  ];
  const sizes: Array<[number, number]> = VIEWPORTS.map(([width, height]) => [width, height]);
  for (const entry of COMPOSITIONS.slice(1)) for (const shift of [-0.005, 0, 0.005]) sizes.push([(entry.min + shift) * 1000, 1000]);
  for (let aspect = 0.3; aspect < 3.2; aspect += 0.013) sizes.push([aspect * 1000, 1000]);
  sizes.push([0, 0], [-5, 100], [Number.NaN, 400], [Infinity, 400]);
  for (const available of lists) {
    for (const [width, height] of sizes) {
      assert.equal(twin(width, height, available), pickComposition(width, height, available), `${width}×${height} ${JSON.stringify(available)}`);
    }
  }
});

test("the twin is ES5 that fits in the head script's template literal (no backslashes, arrows or let/const)", () => {
  assert.equal(PICK_COMPOSITION_ES5.includes(String.fromCharCode(92)), false);
  assert.equal(/=>|\blet\b|\bconst\b|`/.test(PICK_COMPOSITION_ES5), false);
});

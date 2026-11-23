/**
 * The FITX mark (instruction/logo.jpeg, 2026-11-22) rebuilt as exact vector geometry.
 *
 * The mark is straight-edged: an F whose top bar is a barbell (three plates loaded on its right end), a stem
 * that doubles as the T, and an X whose long stroke cuts through the stem. Every corner below was measured on
 * the 1254 x 1254 px original, not traced: the edge pixels of each side were fitted with a straight line and
 * neighbouring lines intersected. scripts/brand/check-logo-geometry.mjs renders the pieces back at 1254 px over
 * the original: they differ by about 0.5% of the mark's pixels, all of it anti-aliasing along the edges, except
 * for one deliberate change: the outer lower leg of the X ends in a clean corner where the original has a soft
 * curved hook (an artefact of the image, about 6 px wide).
 *
 * Pieces are listed in the order the mark is drawn (the F, then the X, then the plates onto the bar). They are
 * filled shapes; where two meet they overlap slightly, so the mark has no hairline seams at any size. Fill them
 * all with one colour (`currentColor` in the app). Each `d` also works as `new Path2D(d)` on a canvas.
 */

/** A piece of the mark in the original image's pixels, and the corner radius the plates have there. */
type MeasuredPiece = { id: FitxMarkPieceId; radius: number; corners: readonly (readonly [number, number])[] };

export type FitxMarkPieceId =
  | "bar"
  | "stem"
  | "arm"
  | "stroke"
  | "branch"
  | "leg-inner"
  | "leg-outer"
  | "plate-1"
  | "plate-2"
  | "plate-3";

/** The original's pixels that land on the viewBox origin, so the mark sits centred in a 600-unit square. */
const ORIGIN_X = 304.2;
const ORIGIN_Y = 353;
/** Where the viewBox origin sits on the original artwork (for checks that draw the mark back over it). */
export const FITX_MARK_ORIGIN = { x: ORIGIN_X, y: ORIGIN_Y } as const;

/** Measured corners in logo.jpeg pixels (y down). */
const MEASURED: readonly MeasuredPiece[] = [
  // The F's top bar: the barbell's bar. Its left end is cut at 41 degrees; it runs under the first plate.
  { id: "bar", radius: 0, corners: [[319.8, 410], [785, 410], [770, 457], [374.4, 457]] },
  // The stem (the F's upright and the T), 49 px wide, cut under the bar by a slanted notch and at the foot by the X.
  { id: "stem", radius: 0, corners: [[599, 440], [623.3, 440], [623.3, 457], [648, 463.6], [648, 708.8], [599, 767.2]] },
  // The F's middle arm, 52 px deep, with its tail swept down to the left.
  { id: "arm", radius: 0, corners: [[386.9, 533], [620, 533], [620, 585], [422.7, 585], [326, 666.3]] },
  // The X's long stroke, about 48 degrees, widening slightly above the junction.
  { id: "stroke", radius: 0, corners: [[567, 826.4], [680.2, 699.4], [705.5, 663.3], [791.7, 562], [888.6, 562], [567, 922]] },
  // The X's upper-left arm, leaving the stem at 45 to 48 degrees.
  { id: "branch", radius: 0, corners: [[630, 586.9], [712, 669.9], [685.6, 705.3], [630, 644.1]] },
  // The X's lower-right leg, split into two 28 px strips with an 11 px gap, 14 px clear of the long stroke.
  { id: "leg-inner", radius: 0, corners: [[712.2, 779.7], [731.4, 758.6], [817.2, 849.6], [778.8, 850.2]] },
  { id: "leg-outer", radius: 0, corners: [[738.8, 750], [757.7, 729], [870.7, 848.8], [832.7, 850.1], [748.6, 760.5]] },
  // The plates, leaning 17.7 degrees, each shorter and lower than the one before.
  { id: "plate-1", radius: 3, corners: [[777, 384], [808, 384], [769.9, 502.1], [738.6, 501.8]] },
  { id: "plate-2", radius: 3, corners: [[815.7, 396.3], [839.1, 400.6], [811.7, 487.2], [785.1, 491.1]] },
  { id: "plate-3", radius: 3, corners: [[846.9, 411.9], [865.7, 418], [848, 473.5], [826.2, 477.4]] },
];

const fmt = (value: number) => String(Math.round(value * 10) / 10);

/** A closed path through the corners, each corner rounded by `radius` (0 keeps it sharp). */
export function polygonPath(corners: readonly (readonly [number, number])[], radius = 0): string {
  if (radius <= 0) return `M${corners.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join("L")}Z`;
  let d = "";
  corners.forEach((point, index) => {
    const before = corners[(index - 1 + corners.length) % corners.length];
    const after = corners[(index + 1) % corners.length];
    const toward = (other: readonly [number, number]) => {
      const length = Math.hypot(other[0] - point[0], other[1] - point[1]);
      const step = Math.min(radius, length / 2) / length;
      return [point[0] + (other[0] - point[0]) * step, point[1] + (other[1] - point[1]) * step] as const;
    };
    const [inX, inY] = toward(before);
    const [outX, outY] = toward(after);
    d += `${index ? "L" : "M"}${fmt(inX)} ${fmt(inY)}Q${fmt(point[0])} ${fmt(point[1])} ${fmt(outX)} ${fmt(outY)}`;
  });
  return `${d}Z`;
}

/** The viewBox every `FITX_MARK_PATHS` entry is drawn in: a 600-unit square with the mark centred. */
export const FITX_MARK_VIEWBOX = "0 0 600 600";
/** The square's side, in viewBox units. */
export const FITX_MARK_SIZE = 600;
/** The mark's own bounds inside the viewBox (for layouts that crop to the mark). */
export const FITX_MARK_BOUNDS = { x: 15.6, y: 31, width: 568.8, height: 538 } as const;

/** The mark's pieces, in drawing order, in viewBox units. */
export const FITX_MARK_PATHS: readonly { id: FitxMarkPieceId; d: string }[] = MEASURED.map(({ id, radius, corners }) => ({
  id,
  d: polygonPath(corners.map(([x, y]) => [x - ORIGIN_X, y - ORIGIN_Y] as const), radius),
}));

/** Every piece as one path, for places that take a single `d` (icons, the share card). */
export const FITX_MARK_D = FITX_MARK_PATHS.map(({ d }) => d).join("");

/** Where each piece comes from when the mark forms: its direction of travel, in viewBox units. */
export const FITX_MARK_ENTRY: Readonly<Record<FitxMarkPieceId, { x: number; y: number }>> = {
  // The F is written: bar from the left, stem down from the bar, arm out from the stem.
  bar: { x: -470, y: 0 },
  stem: { x: 0, y: -310 },
  arm: { x: 236, y: 0 },
  // The X: the long stroke shoots up from its foot, the arm and legs follow the other diagonal.
  stroke: { x: -322, y: 360 },
  branch: { x: -80, y: -80 },
  "leg-inner": { x: 105, y: 110 },
  "leg-outer": { x: 120, y: 126 },
  // The plates slide onto the bar from its end, one after another.
  "plate-1": { x: 90, y: 0 },
  "plate-2": { x: 120, y: 0 },
  "plate-3": { x: 150, y: 0 },
};

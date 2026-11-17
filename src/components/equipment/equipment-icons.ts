/**
 * FITX's equipment drawings as plain data: one icon per equipment key in src/lib/training/taxonomy.ts,
 * plus "none" for no equipment (body weight). EquipmentIcon.tsx renders them.
 *
 * Every icon is a list of shapes on a 48 x 48 grid, stroked in currentColor with a round 2.25-unit line.
 * `tone: "soft"` adds a faint currentColor fill to the solid parts (plates, bells, balls, pads);
 * `tone: "solid"` fills small details. Paths are filled even-odd, so a second subpath cuts a hole.
 *
 * This file has no imports so tests and plain `node` scripts can load it.
 */

export type EquipmentIconTone = "soft" | "solid";

export type EquipmentIconShape =
  | { d: string; tone?: EquipmentIconTone }
  | { circle: { cx: number; cy: number; r: number }; tone?: EquipmentIconTone }
  | { ellipse: { cx: number; cy: number; rx: number; ry: number }; tone?: EquipmentIconTone }
  | { rect: { x: number; y: number; width: number; height: number; rx?: number }; tone?: EquipmentIconTone };

export type EquipmentIconDrawing = readonly EquipmentIconShape[];

/** The grid every drawing uses (viewBox 0 0 48 48). */
export const EQUIPMENT_ICON_GRID = 48;
export const EQUIPMENT_ICON_STROKE_WIDTH = 2.25;
/** Opacity of the `soft` fill. */
export const EQUIPMENT_ICON_SOFT_OPACITY = 0.15;

/** The icon for "no equipment" (body weight, the floor and a wall). */
export const NO_EQUIPMENT_ICON = "none";
/** The icon shown for a name that has no drawing of its own. */
export const FALLBACK_EQUIPMENT_ICON = "specialty";

export const EQUIPMENT_ICONS: Readonly<Record<string, EquipmentIconDrawing>> = {
  // Two stepped heads each side of a short handle.
  dumbbell: [
    { rect: { x: 5, y: 16, width: 5, height: 16, rx: 2 }, tone: "soft" },
    { rect: { x: 10, y: 11, width: 6.5, height: 26, rx: 2 }, tone: "soft" },
    { d: "M16.5 24H31.5" },
    { rect: { x: 31.5, y: 11, width: 6.5, height: 26, rx: 2 }, tone: "soft" },
    { rect: { x: 38, y: 16, width: 5, height: 16, rx: 2 }, tone: "soft" },
  ],

  // A round bell with a flat base and a thick handle with a window.
  kettlebell: [
    { d: "M18.06 41.5A12.5 12.5 0 1 1 29.94 41.5Z", tone: "soft" },
    { d: "M13.5 23.72C11.5 15 13 6 24 6C35 6 36.5 15 34.5 23.72A12.5 12.5 0 0 0 29.5 19.28C30 15 29.3 11.5 24 11.5C18.7 11.5 18 15 18.5 19.28A12.5 12.5 0 0 0 13.5 23.72Z", tone: "soft" },
  ],

  // A long bar with a big and a small plate near each end and the sleeves showing.
  barbell: [
    { d: "M3.5 24H6M13 24H35M42 24H44.5" },
    { rect: { x: 6, y: 15, width: 3, height: 18, rx: 1.25 }, tone: "soft" },
    { rect: { x: 9, y: 9, width: 4, height: 30, rx: 1.5 }, tone: "soft" },
    { rect: { x: 35, y: 9, width: 4, height: 30, rx: 1.5 }, tone: "soft" },
    { rect: { x: 39, y: 15, width: 3, height: 18, rx: 1.25 }, tone: "soft" },
  ],

  // A shorter bar with a W-shaped camber between one plate each side.
  ez_bar: [
    { d: "M3.5 24H7M11 24H15.5L19.5 29L24 21L28.5 29L32.5 24H37M41 24H44.5" },
    { rect: { x: 7, y: 13, width: 4, height: 22, rx: 1.5 }, tone: "soft" },
    { rect: { x: 37, y: 13, width: 4, height: 22, rx: 1.5 }, tone: "soft" },
  ],

  // A tube band with a D-handle at each end.
  resistance_band: [
    { d: "M12.5 18C9 28 13 40 24 40C35 40 39 28 35.5 18" },
    { d: "M8.5 11L12.5 18L16.5 11M31.5 11L35.5 18L39.5 11" },
    { rect: { x: 6.5, y: 7.5, width: 12, height: 3.5, rx: 1.75 }, tone: "soft" },
    { rect: { x: 29.5, y: 7.5, width: 12, height: 3.5, rx: 1.75 }, tone: "soft" },
  ],

  // A high bar with grips on two posts.
  pull_up_bar: [
    { d: "M4.5 9H12.5M21.5 9H26.5M35.5 9H43.5M10 9V42M38 9V42M6 42H14M34 42H42" },
    { rect: { x: 12.5, y: 6.75, width: 9, height: 4.5, rx: 2.25 }, tone: "soft" },
    { rect: { x: 26.5, y: 6.75, width: 9, height: 4.5, rx: 2.25 }, tone: "soft" },
  ],

  // A padded top on two splayed legs with feet.
  bench: [
    { rect: { x: 5, y: 13.5, width: 38, height: 6.5, rx: 2.5 }, tone: "soft" },
    { d: "M13 20L10.5 38.5M35 20L37.5 38.5M6.5 38.5H14.5M33.5 38.5H41.5" },
  ],

  // A plyo box in perspective with a hand slot.
  box: [
    { d: "M6 17.5L16 8.5H42L32 17.5Z", tone: "soft" },
    { rect: { x: 6, y: 17.5, width: 26, height: 24, rx: 1 } },
    { d: "M42 8.5V32.5L32 41.5" },
    { rect: { x: 13, y: 22.5, width: 12, height: 4, rx: 2 } },
  ],

  // Two parallel handles braced off a wall plate.
  dip_station: [
    { rect: { x: 5, y: 7, width: 6.5, height: 34, rx: 2 }, tone: "soft" },
    { circle: { cx: 8.25, cy: 11, r: 0.9 }, tone: "solid" },
    { circle: { cx: 8.25, cy: 37, r: 0.9 }, tone: "solid" },
    { d: "M11.5 16H32.5M11.5 27H26M11.5 23.5L18.5 16M11.5 34.5L18.5 27" },
    { rect: { x: 32.5, y: 13.5, width: 11.5, height: 5, rx: 2.5 }, tone: "soft" },
    { rect: { x: 26, y: 24.5, width: 11.5, height: 5, rx: 2.5 }, tone: "soft" },
  ],

  // Two uprights with J-hooks holding a loaded bar.
  squat_rack: [
    { d: "M14 5V42M34 5V42M9 42H19M29 42H39" },
    { d: "M3.5 17H6M9.5 17H38.5M42 17H44.5" },
    { rect: { x: 6, y: 8, width: 3.5, height: 18, rx: 1.25 }, tone: "soft" },
    { rect: { x: 38.5, y: 8, width: 3.5, height: 18, rx: 1.25 }, tone: "soft" },
    { d: "M12 15V19H16V15M32 15V19H36V15" },
  ],

  // A tower with a pulley, a cable and a stirrup handle.
  cable_machine: [
    { rect: { x: 7.5, y: 4, width: 12, height: 39, rx: 2 }, tone: "soft" },
    { d: "M13.5 9V38M5 43H22" },
    { circle: { cx: 19.5, cy: 14, r: 3.5 } },
    { circle: { cx: 19.5, cy: 14, r: 0.9 }, tone: "solid" },
    { d: "M22.5 16L35.5 29" },
    { d: "M31.64 35L35.5 29L39.36 35" },
    { rect: { x: 29.5, y: 35, width: 12, height: 3.5, rx: 1.75 }, tone: "soft" },
  ],

  // A seat and inclined backrest beside a weight stack.
  machine: [
    { d: "M5 42V5.5H17V42M3.5 42H44" },
    { rect: { x: 7.5, y: 26, width: 7, height: 16, rx: 1 }, tone: "soft" },
    { d: "M7.5 30H14.5M7.5 34H14.5M7.5 38H14.5M11 9V26" },
    { rect: { x: 22, y: 28.5, width: 14, height: 4.5, rx: 2 }, tone: "soft" },
    { d: "M38.64 11.58L39.14 11.66A2 2 0 0 1 40.76 13.98L38.67 25.8A2 2 0 0 1 36.36 27.42L35.86 27.34A2 2 0 0 1 34.24 25.02L36.33 13.2A2 2 0 0 1 38.64 11.58Z", tone: "soft" },
    { d: "M29 33V42M36.5 28L35.5 33" },
  ],

  // A frame with two guide rails and a bar riding on carriages.
  smith_machine: [
    { d: "M7 43V5H41V43M4 43H10M38 43H44M15 5V43M33 5V43" },
    { d: "M3.5 21H12.5M17.5 21H30.5M35.5 21H44.5" },
    { rect: { x: 12.5, y: 17.5, width: 5, height: 7, rx: 1.5 }, tone: "soft" },
    { rect: { x: 30.5, y: 17.5, width: 5, height: 7, rx: 1.5 }, tone: "soft" },
  ],

  // A treadmill: belt deck, motor hood, upright, console and handrail.
  cardio_machine: [
    { d: "M6.75 35H33.5V40.5H6.75A2.75 2.75 0 0 1 6.75 35Z", tone: "soft" },
    { d: "M33.5 40.5V33.5C33.5 32.4 34.4 31.5 35.5 31.5H41C42.1 31.5 43 32.4 43 33.5V38.5C43 39.6 42.1 40.5 41 40.5Z", tone: "soft" },
    { d: "M38.5 31.5L35.1 14M35.8 17.5H24.5" },
    { d: "M27.5 9H39.5L41 14H29Z", tone: "soft" },
  ],

  // A heavy ball with a grip band.
  medicine_ball: [
    { circle: { cx: 24, cy: 24, r: 17 }, tone: "soft" },
    { d: "M7.61 19.5C16 24 32 24 40.39 19.5M7.61 28.5C16 33 32 33 40.39 28.5" },
  ],

  // A large ball on the floor with a highlight.
  stability_ball: [
    { circle: { cx: 24, cy: 22.5, r: 18.5 } },
    { d: "M12.5 19A12 12 0 0 1 19.5 10.8" },
    { d: "M15 44H33" },
  ],

  // A hollow ridged cylinder.
  foam_roller: [
    { d: "M12 12.5H36A5.5 11.5 0 0 1 36 35.5H12A5.5 11.5 0 0 0 12 12.5Z", tone: "soft" },
    { ellipse: { cx: 12, cy: 24, rx: 5.5, ry: 11.5 } },
    { ellipse: { cx: 12, cy: 24, rx: 2, ry: 4.25 } },
    { d: "M22 12.5A5.5 11.5 0 0 1 22 35.5M29 12.5A5.5 11.5 0 0 1 29 35.5" },
  ],

  // Two handles and a looped rope.
  jump_rope: [
    { d: "M6 7.21L9 17.71A2.6 2.6 0 0 0 14 16.29L11 5.79A2.6 2.6 0 0 0 6 7.21Z", tone: "soft" },
    { d: "M37 5.79L34 16.29A2.6 2.6 0 0 0 39 17.71L42 7.21A2.6 2.6 0 0 0 37 5.79Z", tone: "soft" },
    { d: "M11.8 19.4C14 33 17 42 24 42C31 42 34 33 36.2 19.4" },
  ],

  // Two straps from one anchor, each with a handle.
  suspension_trainer: [
    { d: "M18 4.5H30M24 4.5V8" },
    { circle: { cx: 24, cy: 10.25, r: 2.25 } },
    { d: "M24 12.5V15M24 15L13 33.5M24 15L35 33.5" },
    { d: "M8.91 38.5L13 33.5L17.09 38.5M30.91 38.5L35 33.5L39.09 38.5" },
    { rect: { x: 7, y: 38.5, width: 12, height: 3.5, rx: 1.75 }, tone: "soft" },
    { rect: { x: 29, y: 38.5, width: 12, height: 3.5, rx: 1.75 }, tone: "soft" },
  ],

  // A chair seen from the side.
  chair: [
    { rect: { x: 12.5, y: 5, width: 5, height: 15, rx: 2 }, tone: "soft" },
    { d: "M15 20V42" },
    { rect: { x: 15, y: 24, width: 21, height: 4.5, rx: 1.5 }, tone: "soft" },
    { d: "M34 28.5V42" },
  ],

  // A push sled: skid, deck, push pole and stacked plates.
  sled: [
    { d: "M4.5 41.5H36.5C40.5 41.5 43 39 43.5 35" },
    { d: "M8.5 41.5V36.5H36.5V41.5" },
    { d: "M13.5 36.5L9.5 8M6.5 8H12.5M12.03 26H7.5" },
    { rect: { x: 18, y: 31.5, width: 18, height: 5, rx: 1.5 }, tone: "soft" },
    { rect: { x: 18, y: 26.5, width: 18, height: 5, rx: 1.5 }, tone: "soft" },
    { d: "M27 26.5V22" },
  ],

  // A big tyre lying flat, tread on its wall.
  strongman_implements: [
    { d: "M5 19A19 8.5 0 1 0 43 19A19 8.5 0 1 0 5 19ZM15 19A9 4 0 1 0 33 19A9 4 0 1 0 15 19Z", tone: "soft" },
    { d: "M5 19V28A19 8.5 0 0 0 43 28V19" },
    { d: "M41.22 22.59V31.59M36.21 25.51V34.51M28.92 27.21V36.21M24 27.5V36.5M19.08 27.21V36.21M11.79 25.51V34.51M6.78 22.59V31.59" },
  ],

  // A tri-grip weight plate with a sparkle: other specialist kit.
  specialty: [
    { circle: { cx: 21, cy: 27, r: 15 }, tone: "soft" },
    { circle: { cx: 21, cy: 27, r: 3.25 } },
    { d: "M15.46 19.91A9 9 0 0 1 26.54 19.91M29.91 25.75A9 9 0 0 1 24.37 35.34M17.63 35.34A9 9 0 0 1 12.09 25.75" },
    { d: "M38.5 3.5Q39.58 8.42 44.5 9.5Q39.58 10.58 38.5 15.5Q37.42 10.58 32.5 9.5Q37.42 8.42 38.5 3.5Z", tone: "soft" },
  ],

  // A standing figure on a mat: body weight only.
  none: [
    { circle: { cx: 24, cy: 8.5, r: 4 }, tone: "soft" },
    { d: "M24 15.5V29M24 17L16.5 27M24 17L31.5 27M24 29L18 41M24 29L30 41" },
    { rect: { x: 9, y: 41.5, width: 30, height: 2.5, rx: 1.25 }, tone: "soft" },
  ],
};

/** Every drawn icon name: the equipment keys in catalogue order, then "none". */
export const EQUIPMENT_ICON_NAMES: readonly string[] = Object.keys(EQUIPMENT_ICONS);

/** The drawing to use for a name: its own, or the fallback for names with none. */
export function equipmentIconName(name: string): string {
  return Object.hasOwn(EQUIPMENT_ICONS, name) ? name : FALLBACK_EQUIPMENT_ICON;
}

// FITX's equipment icons (src/components/equipment/equipment-icons.ts): a drawing for every equipment key in
// src/lib/training/taxonomy.ts plus "none", every shape stays on the 48 x 48 grid with room for the stroke,
// no two drawings are alike, and a name without a drawing gets the "specialty" one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EQUIPMENT } from "@/lib/training/taxonomy";
import {
  EQUIPMENT_ICONS,
  EQUIPMENT_ICON_GRID,
  EQUIPMENT_ICON_NAMES,
  FALLBACK_EQUIPMENT_ICON,
  NO_EQUIPMENT_ICON,
  equipmentIconName,
  type EquipmentIconShape,
} from "@/components/equipment/equipment-icons";

type Point = [number, number];

const ARGUMENTS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const TOKEN = /[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/** Splits path data into commands and their numbers; throws on anything that isn't path data. */
function parsePath(d: string): Array<{ command: string; args: number[] }> {
  assert.equal(d.replace(TOKEN, "").replace(/[\s,]/g, ""), "", `unreadable path data: ${d}`);
  const tokens = d.match(TOKEN) ?? [];
  assert.match(tokens[0] ?? "", /^[Mm]$/, `path data starts with a move: ${d}`);
  const commands: Array<{ command: string; args: number[] }> = [];
  let command = "";
  for (let index = 0; index < tokens.length; ) {
    if (/[A-Za-z]/.test(tokens[index])) command = tokens[index++];
    const count = ARGUMENTS[command.toUpperCase()];
    assert.ok(count !== undefined, `unknown path command ${command} in ${d}`);
    const args = tokens.slice(index, index + count).map(Number);
    assert.ok(args.length === count && args.every(Number.isFinite), `${command} needs ${count} numbers in ${d}`);
    index += count;
    commands.push({ command, args });
    if (count === 0) assert.ok(index >= tokens.length || /[A-Za-z]/.test(tokens[index]), `numbers after ${command} in ${d}`);
    if (command === "M") command = "L";
    else if (command === "m") command = "l";
  }
  return commands;
}

/** Points along an elliptical arc, from the SVG spec's endpoint-to-centre conversion. */
function arcPoints(from: Point, to: Point, rxIn: number, ryIn: number, degrees: number, largeArc: boolean, sweep: boolean): Point[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [to];
  const phi = (degrees * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const scale = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (scale > 1) {
    rx *= Math.sqrt(scale);
    ry *= Math.sqrt(scale);
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const factor = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));
  const cx1 = (factor * rx * y1) / ry;
  const cy1 = (-factor * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;
  const points: Point[] = [];
  for (let step = 1; step <= 32; step++) {
    const t = start + (delta * step) / 32;
    points.push([cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]);
  }
  return points;
}

/**
 * Every coordinate a path names (end and control points, made absolute) and points sampled along
 * its outline, curves and arcs included.
 */
function tracePath(d: string): { coordinates: Point[]; outline: Point[] } {
  const coordinates: Point[] = [];
  const outline: Point[] = [];
  let at: Point = [0, 0];
  let start: Point = [0, 0];
  let lastCubic: Point | null = null;
  let lastQuadratic: Point | null = null;
  const bezier = (controls: Point[]) => {
    for (let step = 1; step <= 32; step++) {
      const t = step / 32;
      let level = controls;
      while (level.length > 1) level = level.slice(1).map((point, index): Point => [level[index][0] + (point[0] - level[index][0]) * t, level[index][1] + (point[1] - level[index][1]) * t]);
      outline.push(level[0]);
    }
  };
  for (const { command, args } of parsePath(d)) {
    const upper = command.toUpperCase();
    const relative = command !== upper;
    const point = (x: number, y: number): Point => (relative ? [at[0] + x, at[1] + y] : [x, y]);
    let next: Point = at;
    if (upper === "M") {
      next = point(args[0], args[1]);
      start = next;
      coordinates.push(next);
      outline.push(next);
    } else if (upper === "L") {
      next = point(args[0], args[1]);
      coordinates.push(next);
      outline.push(next);
    } else if (upper === "H") {
      next = [relative ? at[0] + args[0] : args[0], at[1]];
      coordinates.push(next);
      outline.push(next);
    } else if (upper === "V") {
      next = [at[0], relative ? at[1] + args[0] : args[0]];
      coordinates.push(next);
      outline.push(next);
    } else if (upper === "Z") {
      next = start;
      outline.push(next);
    } else if (upper === "C" || upper === "S") {
      const first: Point = upper === "C" ? point(args[0], args[1]) : lastCubic ? [2 * at[0] - lastCubic[0], 2 * at[1] - lastCubic[1]] : at;
      const rest = upper === "C" ? args.slice(2) : args;
      const second = point(rest[0], rest[1]);
      next = point(rest[2], rest[3]);
      coordinates.push(first, second, next);
      bezier([at, first, second, next]);
      lastCubic = second;
    } else if (upper === "Q" || upper === "T") {
      const control: Point = upper === "Q" ? point(args[0], args[1]) : lastQuadratic ? [2 * at[0] - lastQuadratic[0], 2 * at[1] - lastQuadratic[1]] : at;
      next = upper === "Q" ? point(args[2], args[3]) : point(args[0], args[1]);
      coordinates.push(control, next);
      bezier([at, control, next]);
      lastQuadratic = control;
    } else if (upper === "A") {
      next = point(args[5], args[6]);
      coordinates.push(next);
      outline.push(...arcPoints(at, next, args[0], args[1], args[2], args[3] !== 0, args[4] !== 0));
    }
    if (upper !== "C" && upper !== "S") lastCubic = null;
    if (upper !== "Q" && upper !== "T") lastQuadratic = null;
    at = next;
  }
  return { coordinates, outline };
}

function trace(shape: EquipmentIconShape): { coordinates: Point[]; outline: Point[] } {
  if ("d" in shape) return tracePath(shape.d);
  if ("circle" in shape) {
    const { cx, cy, r } = shape.circle;
    assert.ok(r > 0, "a circle has a radius");
    const box: Point[] = [[cx - r, cy - r], [cx + r, cy + r]];
    return { coordinates: [[cx, cy], ...box], outline: box };
  }
  if ("ellipse" in shape) {
    const { cx, cy, rx, ry } = shape.ellipse;
    assert.ok(rx > 0 && ry > 0, "an ellipse has radii");
    const box: Point[] = [[cx - rx, cy - ry], [cx + rx, cy + ry]];
    return { coordinates: [[cx, cy], ...box], outline: box };
  }
  const { x, y, width, height, rx = 0 } = shape.rect;
  assert.ok(width > 0 && height > 0 && rx >= 0, "a rectangle has a size");
  const box: Point[] = [[x, y], [x + width, y + height]];
  return { coordinates: box, outline: box };
}

const EXPECTED = [...EQUIPMENT.map((item) => item.key), NO_EQUIPMENT_ICON];

test("every equipment key and 'none' has its own drawing, listed in catalogue order", () => {
  assert.equal(NO_EQUIPMENT_ICON, "none");
  assert.deepEqual(EQUIPMENT_ICON_NAMES, EXPECTED);
  assert.deepEqual(Object.keys(EQUIPMENT_ICONS), EXPECTED, "no drawing for a key the catalogue doesn't have");
});

test("every drawing has path data that parses, and only known tones", () => {
  for (const name of EXPECTED) {
    const shapes = EQUIPMENT_ICONS[name];
    assert.ok(Array.isArray(shapes) && shapes.length > 0, `${name} has shapes`);
    const paths = shapes.filter((shape) => "d" in shape);
    assert.ok(paths.length > 0, `${name} has at least one path`);
    for (const shape of paths) {
      assert.ok("d" in shape && shape.d.trim().length > 0, `${name} has no empty path`);
      assert.ok(parsePath(shape.d).some(({ command }) => !/^[Mm]$/.test(command)), `${name}: a path draws something, not just a move`);
    }
    for (const shape of shapes) assert.ok(shape.tone === undefined || shape.tone === "soft" || shape.tone === "solid", `${name}: tone ${shape.tone}`);
  }
});

test("every drawing stays on the 48 x 48 grid, with a margin the 2.25 stroke never crosses", () => {
  assert.equal(EQUIPMENT_ICON_GRID, 48);
  const MARGIN = 2;
  for (const name of EXPECTED) {
    for (const shape of EQUIPMENT_ICONS[name]) {
      const { coordinates, outline } = trace(shape);
      for (const [x, y] of coordinates) {
        assert.ok(x >= 0 && x <= 48 && y >= 0 && y <= 48, `${name}: coordinate ${x},${y} is outside 0..48 (${JSON.stringify(shape)})`);
      }
      for (const [x, y] of outline) {
        assert.ok(x >= MARGIN && x <= 48 - MARGIN && y >= MARGIN && y <= 48 - MARGIN, `${name}: outline reaches ${x.toFixed(2)},${y.toFixed(2)}, inside the ${MARGIN}-unit margin (${JSON.stringify(shape)})`);
      }
    }
  }
});

test("no two drawings are the same", () => {
  const seen = new Map<string, string>();
  for (const name of EXPECTED) {
    const signature = JSON.stringify(EQUIPMENT_ICONS[name].map((shape) => JSON.stringify(shape)).sort());
    assert.equal(seen.get(signature), undefined, `${name} is drawn exactly like ${seen.get(signature)}`);
    seen.set(signature, name);
  }
});

test("a name without a drawing gets the specialty drawing", () => {
  assert.equal(FALLBACK_EQUIPMENT_ICON, "specialty");
  for (const name of EXPECTED) assert.equal(equipmentIconName(name), name);
  for (const name of ["trap_bar", "Barbell", "", "bodyweight", "constructor", "__proto__", "toString"]) {
    assert.equal(equipmentIconName(name), "specialty", JSON.stringify(name));
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { FITX_MARK_BOUNDS, FITX_MARK_PATHS } from "@/components/brand/logo/geometry";
import { drawMark, markPlacement, type MarkContext } from "@/lib/activity/share-card";

class RecordedPath {
  d: string;
  constructor(d: string) {
    this.d = d;
  }
}

function recorder() {
  const calls: { op: string; args: unknown[]; fillStyle?: unknown }[] = [];
  const ctx = {
    fillStyle: "" as MarkContext["fillStyle"],
    save: () => calls.push({ op: "save", args: [] }),
    restore: () => calls.push({ op: "restore", args: [] }),
    translate: (...args: unknown[]) => calls.push({ op: "translate", args }),
    scale: (...args: unknown[]) => calls.push({ op: "scale", args }),
    fill: (...args: unknown[]) => calls.push({ op: "fill", args, fillStyle: ctx.fillStyle }),
  };
  return { ctx: ctx as unknown as MarkContext, calls };
}

test("the share card draws the new FITX mark: every piece of FITX_MARK_PATHS, filled in the text colour", () => {
  const { ctx, calls } = recorder();
  drawMark(ctx, 40, 60, 64, "#f5f5f5", RecordedPath as unknown as new (d: string) => Path2D);
  const fills = calls.filter(({ op }) => op === "fill");
  assert.deepEqual(fills.map(({ args }) => (args[0] as RecordedPath).d), FITX_MARK_PATHS.map(({ d }) => d));
  assert.ok(fills.every(({ fillStyle }) => fillStyle === "#f5f5f5"));
  assert.equal(calls[0].op, "save");
  assert.equal(calls.at(-1)?.op, "restore", "the context is left as it was");
  assert.ok(!calls.some(({ op }) => op === "stroke"), "no stroked lines from the earlier mark");
});

test("the mark keeps the place and size the earlier mark had on the card", () => {
  const size = 96;
  const place = markPlacement(100, 200, size);
  const left = place.x + FITX_MARK_BOUNDS.x * place.scale;
  const top = place.y + FITX_MARK_BOUNDS.y * place.scale;
  const right = left + FITX_MARK_BOUNDS.width * place.scale;
  const bottom = top + FITX_MARK_BOUNDS.height * place.scale;
  const area = { left: 100 + (10 / 64) * size, top: 200 + (13 / 64) * size, right: 100 + (54 / 64) * size, bottom: 200 + (54 / 64) * size };
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  assert.ok(left >= area.left - 1e-9 && right <= area.right + 1e-9 && top >= area.top - 1e-9 && bottom <= area.bottom + 1e-9, "inside the old mark's area");
  assert.ok(near(right - left, area.right - area.left) || near(bottom - top, area.bottom - area.top), "as large as fits, proportions kept");
  assert.ok(near((left + right) / 2, (area.left + area.right) / 2) && near((top + bottom) / 2, (area.top + area.bottom) / 2), "centred in it");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { lockScroll } from "@/components/form-coach/scroll-lock";

const page = (overflow = "") => ({ style: { overflow } });

test("an open overlay stops the page scrolling and gives the page's own setting back", () => {
  const body = page("clip");
  const release = lockScroll(body);
  assert.equal(body.style.overflow, "hidden");
  release();
  assert.equal(body.style.overflow, "clip");
});

test("the camera view inside the workout sheet: the page scrolls again whichever closes first", () => {
  for (const order of ["sheet first", "camera view first"] as const) {
    const body = page();
    const sheet = lockScroll(body);
    const cameraView = lockScroll(body);
    // The back button mid-set removes both at once; React cleans up the sheet (the parent) first.
    const [first, second] = order === "sheet first" ? [sheet, cameraView] : [cameraView, sheet];
    first();
    assert.equal(body.style.overflow, "hidden", `${order}: still locked while one overlay is open`);
    second();
    assert.equal(body.style.overflow, "", `${order}: the page scrolls again`);
  }
});

test("releasing twice, or locking again as React's development double run does, is harmless", () => {
  const body = page();
  const outer = lockScroll(body);
  const first = lockScroll(body);
  first();
  first();
  assert.equal(body.style.overflow, "hidden", "a repeated release does not free another overlay's lock");
  const again = lockScroll(body);
  outer();
  again();
  assert.equal(body.style.overflow, "");
});

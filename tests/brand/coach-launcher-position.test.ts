import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LAUNCHER_CLOSE_EVENT,
  LAUNCHER_GAP,
  LAUNCHER_OPEN_EVENT,
  LAUNCHER_SIZE,
  LAUNCHER_TOP,
  launcherHiddenOn,
  openCoachPanel,
  placeLauncher,
  readSpot,
  spotFromDrop,
  viewportClass,
  writeSpot,
} from "@/lib/shell/coach-launcher-position";

const phone = { width: 390, height: 844 };
const desktop = { width: 1440, height: 900 };
// The phone's bottom bar: full width, 68 px tall.
const bottomBar = { left: 0, top: 844 - 68, right: 390, bottom: 844 };

test("hidden on the coach, onboarding and the focus screens, shown everywhere else", () => {
  for (const path of ["/ai-coach", "/ai-coach/history", "/onboarding", "/workouts/active", "/activity/record", "/workouts/form-check"]) assert.equal(launcherHiddenOn(path), true, path);
  for (const path of ["/dashboard", "/workouts", "/activity", "/settings", "/explore", "/ai-coaching"]) assert.equal(launcherHiddenOn(path), false, path);
});

test("viewport classes follow the app's breakpoints", () => {
  assert.equal(viewportClass(390), "phone");
  assert.equal(viewportClass(767), "phone");
  assert.equal(viewportClass(768), "tablet");
  assert.equal(viewportClass(1023), "tablet");
  assert.equal(viewportClass(1024), "desktop");
});

test("default: low on the right edge; on a phone it sits just above the bottom bar, never on it", () => {
  const spot = readSpot(null, "phone");
  assert.deepEqual(spot, { side: "right", y: 1 });
  const placed = placeLauncher(spot, phone, [bottomBar])!;
  assert.equal(placed.x, 390 - LAUNCHER_SIZE - LAUNCHER_GAP);
  assert.ok(placed.y + LAUNCHER_SIZE + LAUNCHER_GAP <= bottomBar.top, `clear of the bar (${placed.y})`);
  const corner = placeLauncher(spot, desktop)!;
  assert.deepEqual(corner, { x: 1440 - LAUNCHER_SIZE - 24, y: 900 - LAUNCHER_SIZE - 24, side: "right" });
});

test("it moves up past stacked bars, and to the other edge when one side has no room", () => {
  const saveBar = { left: 0, top: 700, right: 390, bottom: 776 };
  const above = placeLauncher({ side: "right", y: 1 }, phone, [bottomBar, saveBar])!;
  assert.ok(above.y + LAUNCHER_SIZE <= saveBar.top - LAUNCHER_GAP);
  // A tall camera control column down the whole right edge: the left edge instead.
  const column = { left: 300, top: 0, right: 390, bottom: 844 };
  const moved = placeLauncher({ side: "right", y: 0.5 }, phone, [column])!;
  assert.equal(moved.side, "left");
  assert.equal(moved.x, LAUNCHER_GAP);
  // Nowhere free: it stays out of the way.
  assert.equal(placeLauncher({ side: "right", y: 0.5 }, phone, [{ left: 0, top: 0, right: 390, bottom: 844 }]), null);
  // Empty rects (hidden elements) are ignored.
  assert.ok(placeLauncher({ side: "right", y: 1 }, phone, [{ left: 10, top: 10, right: 10, bottom: 10 }]));
});

test("it never covers the header and stays fully on screen", () => {
  const top = placeLauncher({ side: "left", y: 0 }, phone)!;
  assert.equal(top.y, LAUNCHER_TOP);
  const tiny = placeLauncher({ side: "right", y: 1 }, { width: 320, height: 120 })!;
  assert.ok(tiny.y >= 0 && tiny.y + LAUNCHER_SIZE <= 120);
});

test("a drop snaps to the nearer edge and keeps its height; spots are kept per viewport class", () => {
  assert.deepEqual(spotFromDrop(20, LAUNCHER_TOP, phone), { side: "left", y: 0 });
  const middle = spotFromDrop(300, 400, phone);
  assert.equal(middle.side, "right");
  const back = placeLauncher(middle, phone)!;
  assert.ok(Math.abs(back.y - 400) < 1, "it lands where it was dropped");
  const stored = writeSpot(writeSpot(null, "phone", middle), "desktop", { side: "left", y: 0.25 });
  assert.deepEqual(readSpot(stored, "phone"), middle);
  assert.deepEqual(readSpot(stored, "desktop"), { side: "left", y: 0.25 });
  assert.deepEqual(readSpot(stored, "tablet"), { side: "right", y: 1 });
  assert.deepEqual(readSpot("{not json", "phone"), { side: "right", y: 1 });
  assert.deepEqual(readSpot(JSON.stringify({ phone: { side: "up", y: 2 } }), "phone"), { side: "right", y: 1 });
  assert.deepEqual(readSpot(JSON.stringify({ phone: { side: "left", y: 7 } }), "phone"), { side: "left", y: 1 });
  assert.equal(writeSpot("[1,2]", "phone", middle), JSON.stringify({ phone: middle }));
});

test("opening: the coach panel takes the event when one is mounted; otherwise the AI Coach page opens", () => {
  assert.equal(LAUNCHER_OPEN_EVENT, "fitx:coach-open");
  assert.equal(LAUNCHER_CLOSE_EVENT, "fitx:coach-close");
  const target = new EventTarget();
  let fallback = 0;
  const seen: unknown[] = [];
  assert.equal(openCoachPanel(target, () => fallback++), false);
  assert.equal(fallback, 1, "no panel host: the page");
  target.addEventListener(LAUNCHER_OPEN_EVENT, (event) => {
    seen.push((event as CustomEvent).detail);
    assert.equal(event.cancelable, true);
    event.preventDefault();
  });
  assert.equal(openCoachPanel(target, () => fallback++), true);
  assert.equal(fallback, 1, "the panel took it");
  assert.deepEqual(seen, [{ source: "launcher" }]);
});

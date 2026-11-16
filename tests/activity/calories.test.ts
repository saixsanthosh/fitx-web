import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateKcal, metFor, usableWeight } from "@/lib/activity/calories";

const MPH = 0.44704;

test("MET values match the 2024 Adult Compendium at the middle of each speed range", () => {
  assert.equal(metFor("walk", 3.1 * MPH), 3.8); // 17190 walking 2.8-3.4 mph
  assert.equal(metFor("walk", 3.7 * MPH), 4.8); // 17200 brisk 3.5-3.9 mph
  assert.equal(metFor("run", 6.7 * MPH), 10.5); // 12060 running 6.7 mph
  assert.equal(metFor("run", 10 * MPH), 14.8); // 12120 running 10 mph
  assert.equal(metFor("ride", 12.95 * MPH), 8.0); // 01030 12-13.9 mph
  assert.equal(metFor("ride", 21 * MPH), 16.8); // 01060 more than 20 mph
});

test("MET rises with speed and is held at the table ends", () => {
  for (const sport of ["walk", "run", "ride"] as const) {
    let previous = 0;
    for (let speed = 0; speed <= 12; speed += 0.25) {
      const met = metFor(sport, speed);
      assert.ok(met >= previous, `${sport} at ${speed} m/s`);
      previous = met;
    }
  }
  assert.equal(metFor("walk", 0), 2.3);
  assert.equal(metFor("ride", 30), 16.8);
  assert.equal(metFor("run", Number.NaN), metFor("walk", 0));
});

test("a 'run' slower than 4 mph is costed as walking", () => {
  assert.equal(metFor("run", 3.1 * MPH), metFor("walk", 3.1 * MPH));
  assert.ok(metFor("run", 4.2 * MPH) > metFor("walk", 4.2 * MPH));
});

test("kcal = MET x 3.5 x kg / 200 per minute of moving time", () => {
  // 70 kg running 10 km in 60 min: 10 km/h = 6.21 mph, MET 9.43 by interpolation.
  const kcal = estimateKcal("run", Array.from({ length: 10 }, () => ({ distanceM: 1000, movingSeconds: 360 })), 70);
  const met = metFor("run", 1000 / 360);
  assert.equal(kcal, Math.round(met * 3.5 * 70 / 200 * 60));
  assert.ok(kcal! > 650 && kcal! < 740, `${kcal}`);
});

test("no weight, no estimate; parts without moving time add nothing", () => {
  assert.equal(estimateKcal("walk", [{ distanceM: 1000, movingSeconds: 700 }], null), null);
  assert.equal(estimateKcal("walk", [{ distanceM: 1000, movingSeconds: 700 }], undefined), null);
  assert.equal(estimateKcal("walk", [{ distanceM: 1000, movingSeconds: 700 }], 12), null);
  assert.equal(estimateKcal("walk", [{ distanceM: 1000, movingSeconds: 700 }], "abc"), null);
  assert.equal(estimateKcal("walk", [{ distanceM: 50, movingSeconds: 0 }], 70), 0);
  assert.equal(usableWeight("72.5"), 72.5);
  assert.equal(usableWeight(29), null);
  assert.equal(usableWeight(501), null);
});

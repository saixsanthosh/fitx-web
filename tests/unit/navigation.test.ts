import test from "node:test";
import assert from "node:assert/strict";
import { ScanLine } from "lucide-react";
import { HomeWorkoutNavIcon, SQUAT_POSE_MS, squatAt } from "@/components/home-workout/HomeWorkoutNavIcon";
import { ActivityNavIcon } from "@/components/layout/ActivityNavIcon";
import { ACCOUNT_NAV, MAIN_NAV, PHONE_MORE, PHONE_TAB_COUNT, PHONE_TABS, isActivePath, isAppNavIcon } from "@/config/navigation";
import { HOME_PANELS, HOME_WORKOUT, homePanel } from "@/config/routes";

// One list drives the desktop sidebar, the tablet rail, the phone bar and its More sheet.

test("main sections, in order; Goals has left the menu (it lives on Home)", () => {
  assert.deepEqual(MAIN_NAV.map(({ href }) => href), [
    "/dashboard", "/workouts", "/nutrition", "/activity", "/ai-coach", "/progress", "/exercises", "/home-workout",
  ]);
  assert.equal(MAIN_NAV.find(({ href }) => href === "/ai-coach")?.shortLabel, "Coach");
  assert.ok(!MAIN_NAV.some(({ href }) => href === "/goals"), "Goals is reached from Home, not the menu");
  assert.ok(!MAIN_NAV.some(({ href }) => href === "/planner"), "the planner is not a menu entry");
});

test("Form coach is now Home workout at /home-workout", () => {
  assert.equal(HOME_WORKOUT, "/home-workout");
  const item = MAIN_NAV.find(({ href }) => href === HOME_WORKOUT);
  assert.equal(item?.label, "Home workout");
  assert.equal(item?.icon, HomeWorkoutNavIcon, "Home workout has its own drawn icon");
  assert.equal(isAppNavIcon(HomeWorkoutNavIcon), true, "it draws its own active state");
  assert.deepEqual([0, 1, 2, 3].map((slot) => squatAt(slot * SQUAT_POSE_MS + 10)), [false, true, false, true], "it stands, then squats, in turn");
  assert.ok(!MAIN_NAV.some(({ href, label }) => href === "/form-coach" || /form coach/i.test(label)));
});

test("Activity and Home workout use the animated icons; lucide icons are told apart from app icons", () => {
  const activity = MAIN_NAV.find(({ href }) => href === "/activity");
  assert.equal(activity?.icon, ActivityNavIcon);
  assert.equal(isAppNavIcon(ActivityNavIcon), true);
  assert.equal(isAppNavIcon(ScanLine), false);
  assert.deepEqual(MAIN_NAV.filter(({ icon }) => isAppNavIcon(icon)).map(({ href }) => href), ["/activity", "/home-workout"]);
});

test("account entries: profile, settings, help", () => {
  assert.deepEqual(ACCOUNT_NAV.map(({ href, label }) => [href, label]), [["/profile", "Profile"], ["/settings", "Settings"], ["/help", "Help and feedback"]]);
});

test("the phone bar shows four sections and everything else is in More, once", () => {
  assert.equal(PHONE_TAB_COUNT, 4);
  assert.deepEqual(PHONE_TABS.map(({ href }) => href), ["/dashboard", "/workouts", "/nutrition", "/activity"]);
  const everywhere = [...PHONE_TABS, ...PHONE_MORE].map(({ href }) => href);
  assert.deepEqual([...everywhere].sort(), [...MAIN_NAV, ...ACCOUNT_NAV].map(({ href }) => href).sort());
  assert.equal(new Set(everywhere).size, everywhere.length, "no entry appears twice");
});

test("a section stays highlighted on its sub-pages only", () => {
  assert.equal(isActivePath("/activity/record", "/activity"), true);
  assert.equal(isActivePath("/activity", "/activity"), true);
  assert.equal(isActivePath("/activity-log", "/activity"), false);
  assert.equal(isActivePath("/home-workout", "/dashboard"), false);
});

test("Home panel links: panel first, extras kept, panel never overridden", () => {
  assert.deepEqual([...HOME_PANELS], ["goals", "todo", "week"]);
  assert.equal(homePanel("goals"), "/dashboard?panel=goals");
  assert.equal(homePanel("goals", { new: "water_day" }), "/dashboard?panel=goals&new=water_day");
  assert.equal(homePanel("week", { panel: "todo" }), "/dashboard?panel=week");
  assert.equal(homePanel("todo", { q: "a b&c" }), "/dashboard?panel=todo&q=a+b%26c");
});

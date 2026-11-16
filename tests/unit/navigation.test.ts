import test from "node:test";
import assert from "node:assert/strict";
import { ACCOUNT_NAV, MAIN_NAV, PHONE_MORE, PHONE_TAB_COUNT, PHONE_TABS, isActivePath } from "@/config/navigation";

// One list drives the desktop sidebar, the tablet rail, the phone bar and its More sheet.

test("main sections, in order", () => {
  assert.deepEqual(MAIN_NAV.map(({ href }) => href), [
    "/dashboard", "/workouts", "/nutrition", "/activity", "/ai-coach", "/progress", "/goals", "/exercises", "/form-coach",
  ]);
  assert.equal(MAIN_NAV.find(({ href }) => href === "/ai-coach")?.shortLabel, "Coach");
  assert.ok(!MAIN_NAV.some(({ href }) => href === "/planner"), "the planner is now the Week tab of Goals");
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
});

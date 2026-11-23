import test from "node:test";
import assert from "node:assert/strict";
import { ScanLine } from "lucide-react";
import { ActivityNavIcon } from "@/components/layout/ActivityNavIcon";
import { NAV_ICON_NAMES } from "@/components/layout/nav-icons";
import {
  ACCOUNT_NAV, EXPLORE_NAV, MAIN_NAV, NAV_GROUPS, NAV_INCLUDES_EXPLORE, PHONE_MORE, PHONE_MORE_GROUPS, PHONE_TAB_COUNT, PHONE_TABS,
  isActivePath, isAppNavIcon, navGroups, phoneSlot,
} from "@/config/navigation";
import { EXPLORE, FORM_CHECK, HOME_PANELS, HOME_WORKOUT, homePanel, progressGoals } from "@/config/routes";

// One list drives the desktop sidebar, the tablet rail, the phone bar and its More sheet.

test("main sections, in the phone's order; Goals, Home workout and AI Form Check are not menu entries", () => {
  assert.deepEqual(MAIN_NAV.map(({ href }) => href), [
    "/dashboard", "/workouts", "/nutrition", "/activity", "/ai-coach", "/progress", "/exercises",
  ]);
  assert.deepEqual(MAIN_NAV.map(({ label }) => label), ["Home", "Workouts", "Nutrition", "Activity", "AI Coach", "Progress", "Exercise library"]);
  assert.equal(MAIN_NAV.find(({ href }) => href === "/ai-coach")?.shortLabel, "Coach");
  assert.equal(MAIN_NAV.find(({ href }) => href === "/exercises")?.shortLabel, "Library");
  for (const gone of ["/goals", "/planner", "/tasks", HOME_WORKOUT, "/form-coach", FORM_CHECK]) {
    assert.ok(![...MAIN_NAV, ...ACCOUNT_NAV].some(({ href }) => href === gone), `${gone} is not in the menu`);
  }
  assert.ok(!MAIN_NAV.some(({ label }) => /home workout|form coach|form check/i.test(label)), "AI Form Check is reached from Workouts");
});

test("grouped: Home on its own, then Train, Track and Connect; every main section in exactly one group", () => {
  assert.deepEqual(NAV_GROUPS.map(({ id, label }) => [id, label]), [["home", null], ["train", "Train"], ["track", "Track"], ["connect", "Connect"]]);
  assert.deepEqual(NAV_GROUPS.map(({ items }) => items.map(({ href }) => href)), [
    ["/dashboard"], ["/workouts", "/exercises", "/activity"], ["/nutrition", "/progress"], ["/ai-coach"],
  ]);
  const grouped = NAV_GROUPS.flatMap(({ items }) => items.map(({ href }) => href));
  assert.deepEqual([...grouped].sort(), MAIN_NAV.map(({ href }) => href).sort());
});

test("Explore has its icon and slot, switched off until the integrator turns it on", () => {
  assert.equal(NAV_INCLUDES_EXPLORE, false);
  assert.equal(EXPLORE, "/explore");
  assert.deepEqual([EXPLORE_NAV.href, EXPLORE_NAV.label], ["/explore", "Explore"]);
  assert.equal(isAppNavIcon(EXPLORE_NAV.icon), true);
  assert.ok(!MAIN_NAV.includes(EXPLORE_NAV));
  const withExplore = navGroups(true);
  assert.deepEqual(withExplore.find(({ id }) => id === "connect")?.items.map(({ href }) => href), ["/ai-coach", "/explore"]);
});

test("every main section has its own drawn, animated icon; lucide icons are told apart from app icons", () => {
  const activity = MAIN_NAV.find(({ href }) => href === "/activity");
  assert.equal(activity?.icon, ActivityNavIcon, "Activity keeps its walk, run and ride loop");
  assert.ok(MAIN_NAV.every(({ icon }) => isAppNavIcon(icon)), "no main section uses a stock icon");
  assert.equal(new Set(MAIN_NAV.map(({ icon }) => icon)).size, MAIN_NAV.length, "each icon is its own");
  assert.deepEqual([...NAV_ICON_NAMES], ["home", "workouts", "nutrition", "coach", "progress", "library", "explore"]);
  assert.equal(isAppNavIcon(ScanLine), false);
  assert.ok(ACCOUNT_NAV.every(({ icon }) => !isAppNavIcon(icon)));
});

test("account entries: profile, settings, help", () => {
  assert.deepEqual(ACCOUNT_NAV.map(({ href, label }) => [href, label]), [["/profile", "Profile"], ["/settings", "Settings"], ["/help", "Help and feedback"]]);
});

test("the phone bar shows four sections and everything else is in More, grouped, once", () => {
  assert.equal(PHONE_TAB_COUNT, 4);
  assert.deepEqual(PHONE_TABS.map(({ href }) => href), ["/dashboard", "/workouts", "/nutrition", "/activity"]);
  const everywhere = [...PHONE_TABS, ...PHONE_MORE].map(({ href }) => href);
  assert.deepEqual([...everywhere].sort(), [...MAIN_NAV, ...ACCOUNT_NAV].map(({ href }) => href).sort());
  assert.equal(new Set(everywhere).size, everywhere.length, "no entry appears twice");
  assert.deepEqual(PHONE_MORE_GROUPS.map(({ id, items }) => [id, items.map(({ href }) => href)]), [
    ["train", ["/exercises"]], ["track", ["/progress"]], ["connect", ["/ai-coach"]],
  ]);
});

test("the phone bar's highlighted slot: a tab, More for everything in it, none elsewhere", () => {
  assert.equal(phoneSlot("/dashboard"), 0);
  assert.equal(phoneSlot("/workouts/builder"), 1);
  assert.equal(phoneSlot("/activity/import"), 3);
  for (const path of ["/progress", "/ai-coach", "/exercises/abc", "/settings", "/profile", "/help"]) assert.equal(phoneSlot(path), PHONE_TAB_COUNT, path);
  for (const path of ["/subscription", "/achievements"]) assert.equal(phoneSlot(path), -1, path);
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

test("new routes: AI Form Check, Explore, and goals on Progress", () => {
  assert.equal(FORM_CHECK, "/workouts/form-check");
  assert.equal(EXPLORE, "/explore");
  assert.equal(progressGoals(), "/progress?panel=goals");
  assert.equal(progressGoals({ new: "water_day" }), "/progress?panel=goals&new=water_day");
  assert.equal(progressGoals({ panel: "x", new: "a b" }), "/progress?panel=goals&new=a+b");
});

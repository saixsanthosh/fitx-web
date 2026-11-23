// Home after phase 6: a greeting and the quote of the day, nothing else. The statistics, charts, activity,
// progress cards, widgets and the To-Do list are gone from Home's code (their stored rows stay, and the To-Do
// rows stay in the data export).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dayPart, greeting, longDate } from "@/lib/home/greeting";
import { EXPORT_TABLES } from "@/lib/account/export";

const ROOT = new URL("../../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, ROOT), "utf8");

test("the greeting follows the time of day, with the member's first name", () => {
  assert.equal(greeting(6, "Asha"), "Good morning, Asha");
  assert.equal(greeting(12, "Asha"), "Good afternoon, Asha");
  assert.equal(greeting(17, null), "Good evening");
  assert.equal(greeting(23, "Asha"), "Welcome back, Asha");
  assert.deepEqual([4, 5, 11, 12, 16, 17, 21, 22].map(dayPart), ["night", "morning", "morning", "afternoon", "afternoon", "evening", "evening", "night"]);
  assert.equal(longDate("2026-11-23"), "Monday 23 November");
});

test("Home draws only the greeting and the quote", () => {
  const home = read("src/components/home/DailyHome.tsx") + read("src/app/(dashboard)/dashboard/page.tsx") + read("src/app/(dashboard)/dashboard/HomeView.tsx");
  assert.match(home, /aria-label="Today's quote"/);
  assert.match(home, /<h1 id="home-greeting"/);
  for (const gone of ["widgets/HomeWidgets", "CustomizePanel", "NewWidgetsHint", "NextFocusWidget", "TodayPlanWidget", "MusclesWidget", "HomeHero", "GoalsPanel", "TodoPanel", "WeekPlanner", "useTodaySummary", "useGoalsData", "data-widget", "kcal"]) {
    assert.ok(!home.includes(gone), `${gone} is no longer on Home`);
  }
});

test("the To-Do feature is removed from the interface, but its rows stay in the export", () => {
  for (const file of ["src/components/home/TodoPanel.tsx", "src/components/home/WeekPlanner.tsx", "src/components/home/HomeHero.tsx", "src/components/tasks/TodoList.tsx", "src/components/tasks/TodoEditor.tsx", "src/components/tasks/useTodos.ts"]) {
    assert.equal(existsSync(new URL(file, ROOT)), false, `${file} should be gone`);
  }
  // Nothing in the app still draws a To-Do list.
  const app = new URL("src/", ROOT);
  const files = readdirSync(app, { recursive: true }).map(String).filter((file) => /\.tsx$/.test(file));
  for (const file of files) assert.doesNotMatch(readFileSync(new URL(file, app), "utf8"), /tasks\/(TodoList|TodoEditor|useTodos)|home\/(TodoPanel|WeekPlanner)/, file);
  // The planner rows To-Dos were stored in are still exported.
  assert.ok(EXPORT_TABLES.some((table) => table.table === "planner_events"));
  assert.ok(EXPORT_TABLES.some((table) => table.table === "daily_quote_history"));
  // Progress and goals still use the shared helpers.
  for (const kept of ["src/components/tasks/session.ts", "src/components/tasks/RowMenu.tsx", "src/components/tasks/format.ts"]) assert.ok(existsSync(new URL(kept, ROOT)), kept);
});

test("the old addresses redirect on the server", () => {
  assert.match(read("src/app/(dashboard)/tasks/page.tsx"), /redirect\(HOME_HREF\)/);
  assert.match(read("src/app/(dashboard)/planner/page.tsx"), /redirect\(WORKOUTS_HREF\)/);
  assert.match(read("src/app/(dashboard)/goals/page.tsx"), /redirect\(legacyGoalsTarget\(await searchParams\)\)/);
  assert.match(read("src/app/(dashboard)/dashboard/page.tsx"), /const target = homeRedirect\(await searchParams\);\s*if \(target\) redirect\(target\);/);
});

test("the moving background respects reduced motion and pauses in a hidden tab", () => {
  const scene = read("src/components/home/HomeScene.tsx");
  const css = read("src/components/home/HomeScene.module.css");
  assert.match(scene, /useReducedMotionSafe\(\)/);
  assert.match(scene, /usePageVisible\(\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation-play-state: paused/);
  // Only transforms and opacity are animated.
  for (const block of css.matchAll(/@keyframes [\w-]+ \{([\s\S]*?)\}\s*\}/g)) {
    const properties = [...block[1].matchAll(/([a-z-]+):/g)].map((match) => match[1]);
    for (const property of properties) assert.ok(property === "transform" || property === "opacity", `${property} in ${block[0].slice(0, 40)}`);
  }
});

// The compact Gym tab (phase 7.4, wave 2): anatomy tiles in place of the photo FocusTiles (Train by area and the
// builder), one line per plan with an actions menu, a short programme card with a sessions ring, compact programme
// cards with their days in a sheet, and at most four exercises on the Today card. Flows 02 and 13-planning cover the
// behaviour in the browser; these pin the pure parts and the contracts the flows rely on.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TODAY_ROWS_SHOWN, dayMessage, menuKeyIndex, sessionsRing } from "@/components/workouts/gym-compact";
import type { CalendarState } from "@/lib/training/programme-calendar";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("menuKeyIndex", () => {
  test("Down and Up wrap; Home and End jump to the ends", () => {
    assert.equal(menuKeyIndex("ArrowDown", 0, 3), 1);
    assert.equal(menuKeyIndex("ArrowDown", 2, 3), 0);
    assert.equal(menuKeyIndex("ArrowUp", 0, 3), 2);
    assert.equal(menuKeyIndex("ArrowUp", 2, 3), 1);
    assert.equal(menuKeyIndex("Home", 2, 3), 0);
    assert.equal(menuKeyIndex("End", 0, 3), 2);
  });
  test("from no item, Down goes to the first and Up to the last", () => {
    assert.equal(menuKeyIndex("ArrowDown", -1, 3), 0);
    assert.equal(menuKeyIndex("ArrowUp", -1, 3), 2);
  });
  test("other keys and empty menus give null", () => {
    assert.equal(menuKeyIndex("ArrowRight", 0, 3), null);
    assert.equal(menuKeyIndex("Enter", 0, 3), null);
    assert.equal(menuKeyIndex("ArrowDown", 0, 0), null);
  });
});

describe("sessionsRing", () => {
  test("done of the plan's sessions, completed workouts only", () => {
    assert.deepEqual(sessionsRing(6, 24), { fraction: 0.25, value: "6", total: "of 24", label: "Sessions done: 6 of 24, completed workouts only" });
  });
  test("never past full, never below empty", () => {
    assert.equal(sessionsRing(30, 24).fraction, 1);
    assert.equal(sessionsRing(-2, 24).fraction, 0);
    assert.equal(sessionsRing(Number.NaN, 24).value, "0");
  });
  test("a programme without a length has no total and draws no arc (nothing is invented)", () => {
    for (const target of [null, undefined, 0]) {
      const ring = sessionsRing(1, target);
      assert.equal(ring.total, null);
      assert.equal(ring.fraction, 0);
      assert.equal(ring.label, "Sessions done: 1 workout, completed workouts only");
    }
  });
});

describe("dayMessage", () => {
  const states: CalendarState[] = ["done", "today", "planned", "missed", "unplanned", "projected", "paused", "rest", "before_start", "after_end"];
  test("one short line for every state", () => {
    for (const state of states) {
      const line = dayMessage({ state, date: "2026-11-23", doneOn: null });
      assert.ok(line.length > 0 && line.length <= 50, `${state}: ${line}`);
    }
  });
  test("a rest day keeps the recovery line flow 13 looks for, with the next day after it", () => {
    assert.equal(dayMessage({ state: "rest", date: "2026-11-23", doneOn: null }, "Next: Today · Push."), "Recovery is part of your plan. Next: Today · Push.");
    assert.equal(dayMessage({ state: "rest", date: "2026-11-23", doneOn: null }), "Recovery is part of your plan.");
  });
  test("a day done on another day still counts, and a missed day is never a failure", () => {
    assert.match(dayMessage({ state: "done", date: "2026-11-23", doneOn: "2026-11-24" }), /still counts/);
    assert.equal(dayMessage({ state: "done", date: "2026-11-23", doneOn: "2026-11-23" }), "Done.");
    assert.doesNotMatch(dayMessage({ state: "missed", date: "2026-11-23", doneOn: null }), /fail|missed/i);
  });
});

describe("the Gym tab's layout contracts", () => {
  const page = read("src/app/(dashboard)/workouts/page.tsx");
  test("anatomy tiles replace the photo FocusTiles, on the page and in the builder", () => {
    assert.doesNotMatch(page, /FocusTiles/);
    assert.match(page, /<AreaLaunchRail label="Train by area" onLaunch=\{\(area\) => openCreator\("focus", "gym", \[area\]\)\} \/>/);
    assert.match(page, /<MuscleRail bleed=\{false\} value=\{focusAreas\} label="Body areas to train" details=\{focusDetails\}/);
    assert.doesNotMatch(page, /count\.doable \?\? 0/, "an unknown count is never shown as 0");
  });
  test("the launch tiles open the builder: plain buttons with aria-haspopup, the body map and no photos", () => {
    const rail = read("src/components/workouts/AreaLaunchRail.tsx");
    const css = read("src/components/workouts/AreaLaunchRail.module.css");
    assert.match(rail, /role="group" aria-label=\{label\}/);
    assert.match(rail, /aria-haspopup="dialog"/);
    assert.doesNotMatch(rail, /aria-pressed|next\/image|<Image/);
    assert.match(rail, /<BodyMap /);
    assert.match(css, /@media \(prefers-reduced-motion: no-preference\)/);
    assert.doesNotMatch(css, /transition:[^;]*\b(width|height|left|top|margin)\b/);
    assert.doesNotMatch(css, /margin-inline: -1rem|margin-inline: -16px/, "the phone rail never bleeds past the gutter");
  });
  test("a plan row has one visible action and a menu with Edit, Duplicate and Delete", () => {
    const row = page.slice(page.indexOf('className={styles.planRow}'), page.indexOf("{(planCursor ||"));
    assert.match(row, /<ActionsMenu label=\{`More actions for \$\{plan\.title\}`\}/);
    for (const action of ["Edit", "Duplicate", "Delete"]) assert.match(row, new RegExp(`label: "${action}", name: \`${action} \\$\\{plan\\.title\\}\``));
    assert.equal(row.match(/className=\{styles\.iconButton\}/g), null, "no row of icon buttons any more");
    assert.doesNotMatch(read("src/app/(dashboard)/workouts/Workouts.module.css"), /\.planActions/);
  });
  test("the actions menu is a menu button with menu items, Escape and focus return", () => {
    const menu = read("src/components/workouts/ActionsMenu.tsx");
    assert.match(menu, /aria-haspopup="menu" aria-expanded=\{open\}/);
    assert.match(menu, /role="menu"/);
    assert.match(menu, /role="menuitem" tabIndex=\{-1\}/);
    assert.match(menu, /event\.key === "Escape"[^\n]*button\.current\?\.focus\(\)/);
    assert.match(menu, /menuKeyIndex\(event\.key,/);
    assert.match(read("src/components/workouts/ActionsMenu.module.css"), /\.item \{[^}]*min-height: 44px;/);
  });
  test("the programme card: a ring, one line on where you are, Pause or Resume visible, the rest in its menu", () => {
    const card = read("src/components/workouts/ProgrammeCard.tsx");
    assert.match(card, /aria-label="Your programme"/);
    assert.match(card, /<ActionsMenu label="More programme actions"/);
    assert.match(card, /label: busy \? "Planning…" : "Plan the next 7 days"/);
    assert.match(card, /\{ label: "Leave programme",/);
    assert.match(card, />See the whole programme</);
    assert.match(card, />Pause<\/button>/);
    assert.match(card, />Resume programme<\/button>/);
    assert.doesNotMatch(card, />Leave programme<\/button>/);
    assert.match(card, /training day\{trainingDays === 1 \? "" : "s"\} and \{7 - trainingDays\} rest day/, "flow 13 reads the plan's length and rest days");
  });
  test("programme cards: compact facts, Days in a sheet, Follow kept", () => {
    const browser = read("src/components/workouts/ProgrammeBrowser.tsx");
    assert.match(browser, /function DaysSheet/);
    assert.match(browser, /aria-haspopup="dialog" onClick=\{\(\) => setDaysOf\(programme\)\}/);
    assert.match(browser, />Follow<\/button>/);
    assert.doesNotMatch(browser, /aria-expanded=\{open\}/, "the days no longer unfold inside the list");
    // The card's body map is a thumbnail: no "Front" and "Back" captions crowding it (BodyMap keeps them by default).
    assert.match(browser, /size="sm" captions=\{false\} \/>/);
    const map = read("src/components/anatomy/BodyMap.tsx");
    assert.match(map, /captions = true,/);
    assert.match(map, /\{views\.length > 1 && captions && <span className=\{styles\.caption\}/);
  });
  test("Today lists at most four exercises; the preview lists them all", () => {
    assert.equal(TODAY_ROWS_SHOWN, 4);
    assert.match(read("src/components/workouts/TodayWorkout.tsx"), /const SHOWN = TODAY_ROWS_SHOWN;/);
  });
  test("the Gym tab keeps the headings other flows read", () => {
    for (const title of ['title="Gym equipment"', 'title="Your plans"', 'title="Train by area"', 'title="History"']) assert.ok(page.includes(title), title);
  });
});

// Bug 17 (workouts-1), the pages' side: saving the gym list re-plans the programme's days ahead and says so beside
// the list, wherever it is saved (Workouts' list sheet, Workout setup, the exercise library); Workouts and the
// programme page check the days saved before the list's last save as they open (it can change in Profile or on another
// device), and leave a day saved since, such as the member's own edit, as it is (review round, workouts-r1, r2). The
// Today card says when its exercises need equipment the list lacks, and a programme day can be re-planned from it.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { equipmentGapMessage, equipmentGaps, listChanged } from "@/app/(dashboard)/workouts/_lib/today-equipment";
import { equipmentLabel, expandOwnedEquipment } from "@/lib/training/equipment";

describe("the Today card's equipment check", () => {
  const catalog = new Map([
    ["db_press", { required_equipment: ["dumbbell", "bench"] }],
    ["db_curl", { required_equipment: ["dumbbell"] }],
    ["push_up", { required_equipment: [] as string[] }],
  ]);
  const gym = expandOwnedEquipment(["barbell", "bench"]);

  test("counts the exercises the list does not allow and names what they need", () => {
    const gaps = equipmentGaps([{ exercise_id: "db_press" }, { exercise_id: "db_curl" }, { exercise_id: "push_up" }, { exercise_id: "retired" }, { exercise_id: null }], catalog, gym);
    assert.deepEqual(gaps, { count: 2, missing: ["dumbbell"] });
    assert.equal(equipmentGapMessage(gaps, "gym", equipmentLabel), "2 exercises need dumbbells, not on your gym list.");
    assert.equal(equipmentGapMessage({ count: 1, missing: ["dumbbell", "bench"] }, "home", (key) => key), "1 exercise needs dumbbell and bench, not on your home list.");
  });

  test("nothing to say when every exercise fits", () => {
    const gaps = equipmentGaps([{ exercise_id: "push_up" }], catalog, gym);
    assert.deepEqual(gaps, { count: 0, missing: [] });
    assert.equal(equipmentGapMessage(gaps, "gym", equipmentLabel), "");
  });
});

test("Workout setup changes the programme's list only when it saves a different one", () => {
  assert.equal(listChanged(["dumbbell", "barbell"], ["barbell"]), true);
  assert.equal(listChanged(["dumbbell", "barbell"], ["barbell", "dumbbell"]), false, "the same items in another order");
  assert.equal(listChanged(["dumbbell"], null), false, "a list the setup left unsaved");
  assert.equal(listChanged([], []), false);
});

describe("the Workouts page (JSX, read from the source)", () => {
  const page = readFileSync("src/app/(dashboard)/workouts/page.tsx", "utf8");
  const card = readFileSync("src/components/workouts/TodayWorkout.tsx", "utf8");
  const programmeCard = readFileSync("src/components/workouts/ProgrammeCard.tsx", "utf8");

  test("every visit checks the days saved before the list's last save, before planning more", () => {
    const load = page.slice(page.indexOf("const load = useCallback"), page.indexOf("useEffect(() => { void Promise.resolve().then(load); }, [load]);"));
    assert.ok(load.indexOf("replanProgrammeDays(supabase") > 0 && load.indexOf("replanProgrammeDays(supabase") < load.indexOf("topUpProgrammeDays(supabase"));
    assert.match(load, /mode: "visit", listSavedAt: profileResult\.savedAt\[currentEnrolment\.context\]/);
    assert.match(load, /if \(replanned\) setProgrammeNote\(\{ tone: "info", text: replanned \}\);/);
  });

  test("saving the programme's list re-plans its days and says what changed on the list's card", () => {
    const save = page.slice(page.indexOf("async function saveEquipment()"), page.indexOf("async function replanToday("));
    assert.match(save, /enrolment\.context === saved\.context/);
    assert.match(save, /owned: expandOwnedEquipment\(saved\.keys\)/);
    assert.match(save, /mode: "list-saved"/);
    assert.match(save, /setEquipmentNote\(\{ context: saved\.context, text: note \}\);/);
    assert.match(save, /setEquipmentError\("Your equipment list couldn’t be saved\. Check your connection and try again\."\)/, "a failed save is said inside the sheet, not behind it");
    assert.match(page, /\{equipmentError && <p role="alert"/);
  });

  test("the Today card warns, and a programme day offers Re-plan this day", () => {
    assert.match(page, /equipmentGaps\(loadedToday\.rows, catalogById, ownedFor\(todayContext\)\)/);
    assert.match(page, /onReplan: todayGaps\?\.count && today\.kind !== "none" && today\.programme && enrolment\?\.status === "active" \? \(\) => void replanToday\(todayCard\.id\) : null/);
    assert.match(card, /\{gap\.replanning \? "Re-planning…" : "Re-plan this day"\}/);
    assert.match(card, /" Open Details to swap them\."/, "the member's own plan points to Details, where each exercise can be swapped");
    assert.match(card, /if \(hadReplan\.current && !canReplan && \(!document\.activeElement \|\| document\.activeElement === document\.body\)\) startRef\.current\?\.focus\(\);/, "a fixed day's Re-plan button goes; focus moves to Start");
    assert.match(programmeCard, /<p role="status" className=\{note\?\.tone === "info"/);
  });

  test("Workout setup re-plans the days when it saves a different list for the programme's place, and says so with its own line", () => {
    const saved = page.slice(page.indexOf("function setupSaved("), page.indexOf("useEffect(() => {", page.indexOf("function setupSaved(")));
    assert.match(saved, /if \(programmeList && listChanged\(programmeList, keys\)\) void replanAfterSetup\(next, keys!\);/);
    assert.match(saved, /owned: expandOwnedEquipment\(keys\), level: asLevel\(next\.level\)[\s\S]*mode: "list-saved"/);
    assert.match(saved, /if \(said\) setNotice\(\(current\) => \(current === SETUP_SAVED \? `\$\{SETUP_SAVED\} \$\{said\}` : current\)\);/);
    assert.match(page, /const SETUP_SAVED = "Setup saved\. Workouts now follows your answers\.";/);
  });

  test("the Today card's Re-plan this day replaces everything the list rules out on that day", () => {
    const replan = page.slice(page.indexOf("async function replanToday("), page.indexOf("async function enrol("));
    assert.match(replan, /onlyPlanId: planId, mode: "asked"/);
  });

  test("leaving the programme clears the old status line about it (Also seen)", () => {
    const leave = page.slice(page.indexOf("async function leave()"), page.indexOf("async function pause()"));
    assert.match(leave, /setProgrammeBusy\(true\); setError\(""\); setNotice\(""\); setProgrammeNote\(null\);/);
  });
});

describe("the other places a list is saved or a day begun", () => {
  test("the exercise library's Save as my … list re-plans the programme and says what changed beside its button", () => {
    const library = readFileSync("src/app/(dashboard)/exercises/page.tsx", "utf8");
    const save = library.slice(library.indexOf("async function saveHaveList()"), library.indexOf("const resultsTitle"));
    assert.match(save, /const checked = await replanAfterListSaved\(supabase, \{ userId: account\.userId, context, keys,/);
    assert.match(save, /replanMessage\(checked, context\)/);
    assert.match(save, /if \(replanned\) setListNote\(\(current\) => \(current\?\.text === saved \? \{ tone: "info", text: `\$\{saved\} \$\{replanned\}` \} : current\)\);/);
  });

  test("the programme page checks the days ahead as it opens, before any can be begun there", () => {
    const programmePage = readFileSync("src/app/(dashboard)/workouts/programme/page.tsx", "utf8");
    const load = programmePage.slice(programmePage.indexOf("const load = useCallback"), programmePage.indexOf("}, [todayKey]);"));
    assert.match(load, /mode: "visit", listSavedAt: profiles\.savedAt\[enrolment\.context\]/);
    assert.ok(load.indexOf("replanUpcomingProgrammeDays(supabase") < load.indexOf('setState("ready")'));
    assert.match(load, /plans: dayPlans/, "the days as re-planned are the ones shown");
    assert.match(programmePage, /<p role="status" className=\{loaded\.replanNote \? "fitx-alert" : "sr-only"\}>\{loaded\.replanNote\}<\/p>/);
  });
});

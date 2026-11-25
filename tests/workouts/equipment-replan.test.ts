// Bug 17 (workouts-1), the page's side: saving the gym list re-plans the programme's days ahead and says so beside
// the list; every visit checks them too (the list can change in the library, in setup or on another device); the
// Today card says when its exercises need equipment the list lacks, and a programme day can be re-planned from it.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { equipmentGapMessage, equipmentGaps } from "@/app/(dashboard)/workouts/_lib/today-equipment";
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

describe("the Workouts page (JSX, read from the source)", () => {
  const page = readFileSync("src/app/(dashboard)/workouts/page.tsx", "utf8");
  const card = readFileSync("src/components/workouts/TodayWorkout.tsx", "utf8");
  const programmeCard = readFileSync("src/components/workouts/ProgrammeCard.tsx", "utf8");

  test("every visit checks the programme's days ahead against the list, before planning more", () => {
    const load = page.slice(page.indexOf("const load = useCallback"), page.indexOf("useEffect(() => { void Promise.resolve().then(load); }, [load]);"));
    assert.ok(load.indexOf("replanProgrammeDays(supabase") > 0 && load.indexOf("replanProgrammeDays(supabase") < load.indexOf("topUpProgrammeDays(supabase"));
    assert.match(load, /if \(replanned\) setProgrammeNote\(\{ tone: "info", text: replanned \}\);/);
  });

  test("saving the programme's list re-plans its days and says what changed on the list's card", () => {
    const save = page.slice(page.indexOf("async function saveEquipment()"), page.indexOf("async function replanToday("));
    assert.match(save, /enrolment\.context === saved\.context/);
    assert.match(save, /owned: expandOwnedEquipment\(saved\.keys\)/);
    assert.match(save, /setEquipmentNote\(\{ context: saved\.context, text: note \}\);/);
    assert.match(save, /setEquipmentError\("Your equipment list couldn’t be saved\. Check your connection and try again\."\)/, "a failed save is said inside the sheet, not behind it");
    assert.match(page, /\{equipmentError && <p role="alert"/);
  });

  test("the Today card warns, and a programme day offers Re-plan this day", () => {
    assert.match(page, /equipmentGaps\(loadedToday\.rows, catalogById, ownedFor\(todayContext\)\)/);
    assert.match(page, /onReplan: todayGaps\?\.count && today\.kind !== "none" && today\.programme && enrolment\?\.status === "active" \? \(\) => void replanToday\(todayCard\.id\) : null/);
    assert.match(card, /\{gap\.replanning \? "Re-planning…" : "Re-plan this day"\}/);
    assert.match(card, /" Open Details to swap them\."/, "the member's own plan points to Details, where each exercise can be swapped");
    assert.match(programmeCard, /<p role="status" className=\{note\?\.tone === "info"/);
  });

  test("leaving the programme clears the old status line about it (Also seen)", () => {
    const leave = page.slice(page.indexOf("async function leave()"), page.indexOf("async function pause()"));
    assert.match(leave, /setProgrammeBusy\(true\); setError\(""\); setNotice\(""\); setProgrammeNote\(null\);/);
  });
});

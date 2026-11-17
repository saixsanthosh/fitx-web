// How the exercise page shows the catalogue's own words: steps tidied for display only (never rewritten), the
// description only when it adds something, and the muscle line and lists built from the catalogue's muscles.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
// The catalogue's rows exactly as the migrations create them, and as the clean-up migration derives them.
import { loadSources } from "../../scripts/catalog/source.mjs";
import { loadCatalog as deriveCatalog } from "../../scripts/catalog/catalog.mjs";
import { exerciseRegions } from "@/lib/training/anatomy";
import {
  STEPS_FOLD_AFTER, STEPS_PREVIEW, SUMMARY_ASSISTING, guideSteps, listWords, muscleRows, muscleSummary, muscleWords, shownDescription, splitStep, tidyStep,
  visibleStepCount,
} from "@/lib/training/exercise-guide";

type SourceRow = { id: string; name: string; description: string | null; instructions: string[] | null; primary_muscle: string; secondary_muscles: string[] | null };
const SOURCES = (loadSources() as unknown as { liveRows: SourceRow[] }).liveRows;
const DERIVED = deriveCatalog() as Array<{ id: string; primary_muscle: string; secondary_muscles: string[] | null }>;
const byId = new Map(SOURCES.map((row) => [row.id, row]));
const get = (id: string) => {
  const row = byId.get(id);
  assert.ok(row, `${id} is in the catalogue`);
  return row;
};

const noSpaces = (text: string) => text.replace(/\s+/g, "");
/** What the display may drop from a raw step: list markup remnants and the step's own number repeated in front. */
const allowedDrops = (raw: string, number: number) => raw
  .replace(/<\/?(?:li|ul|ol|p|br)\b[^>]*>/gi, "")
  .replace(/(^|\s)\/?li>(?=\s|$)/gi, "$1")
  .replace(new RegExp(`^\\s*${number}[.)]\\s`), "");

describe("steps", () => {
  test("every step in the catalogue keeps all its words, in order; only spacing, markup remnants and a repeated number go", () => {
    let steps = 0;
    for (const row of SOURCES) {
      const raw = (row.instructions ?? []).filter((step) => noSpaces(allowedDrops(step, 0)) !== "");
      const shown = guideSteps(row.instructions);
      assert.equal(shown.length, raw.length, `${row.id}: every non-empty step is shown`);
      shown.forEach((step, index) => {
        assert.equal(step.number, index + 1, `${row.id}: numbered from 1`);
        assert.equal(noSpaces(step.text), noSpaces(allowedDrops(raw[index], step.number)), `${row.id} step ${step.number}: words unchanged`);
        assert.equal(step.rest ? `${step.lead} ${step.rest}` : step.lead, step.text, `${row.id} step ${step.number}: the split loses nothing`);
        assert.ok(step.lead.length > 0, `${row.id} step ${step.number}: has a first sentence`);
        assert.ok(!/\s{2}/.test(step.text) && step.text === step.text.trim(), `${row.id} step ${step.number}: single spaces`);
        steps += 1;
      });
    }
    assert.ok(steps > 3500, `checked ${steps} steps`);
  });

  test("a starter's steps are shown exactly as FITX wrote them", () => {
    const bench = guideSteps(get("bench_press").instructions);
    assert.deepEqual(bench.map((step) => step.text), ["Set the bench and secure your feet.", "Lower the bar under control to the mid chest.", "Press up without bouncing or losing shoulder position."]);
    assert.deepEqual(bench.map((step) => step.rest), ["", "", ""]);
  });

  test("tidying: markup remnants, a missing space after a full stop, a repeated step number", () => {
    const lunge = guideSteps(get("free-exercise-db-Barbell_Lunge").instructions);
    assert.ok(lunge[2].text.endsWith("as this will put undue stress on the knee joint."), lunge[2].text);
    const pulldown = guideSteps(get("free-exercise-db-Close-Grip_Front_Lat_Pulldown").instructions);
    assert.equal(pulldown[5].text, "Repeat this motion for the prescribed amount of repetitions.");
    assert.equal(tidyStep("6. Repeat for reps.", 5), "6. Repeat for reps.", "another step's number stays");
    assert.equal(tidyStep("Keep the elbows close to the torso.This will be your starting position.", 1), "Keep the elbows close to the torso. This will be your starting position.");
    assert.equal(tidyStep("  Lie   down\n on the floor. ", 1), "Lie down on the floor.");
    assert.equal(tidyStep("<li>Stand tall.</li>", 1), "Stand tall.");
    assert.equal(tidyStep("li>", 1), "");
    assert.deepEqual(guideSteps(["", "  ", "Stand tall.", "li>"]).map((step) => [step.number, step.text]), [[1, "Stand tall."]]);
    assert.deepEqual(guideSteps(null), []);
  });

  test("the first sentence is split off; brackets, quotes and lowercase words after a stop are respected", () => {
    assert.deepEqual(splitStep("Lie down on the bench. Grip the bar. Press up."), { lead: "Lie down on the bench.", rest: "Grip the bar. Press up." });
    assert.deepEqual(splitStep("Lift only your tailbone. (Don't lift the entire spine yet.) Pull in your stomach."), { lead: "Lift only your tailbone.", rest: "(Don't lift the entire spine yet.) Pull in your stomach." });
    assert.deepEqual(splitStep("Hold the bar (shoulder width.) Then press."), { lead: "Hold the bar (shoulder width.)", rest: "Then press." });
    assert.deepEqual(splitStep("Lower slowly as you breathe in. Tip: Keep your back flat."), { lead: "Lower slowly as you breathe in.", rest: "Tip: Keep your back flat." });
    assert.deepEqual(splitStep("Repeat for the recommended amount of repetitions."), { lead: "Repeat for the recommended amount of repetitions.", rest: "" });
    assert.deepEqual(splitStep("e.g. a bench. Then sit."), { lead: "e.g. a bench.", rest: "Then sit." }, "a stop before a lowercase word ends no sentence");
    assert.deepEqual(splitStep("Go. Then sit down."), { lead: "Go. Then sit down.", rest: "" }, "a lead shorter than four characters is not split off");
  });

  test("long lists fold after their first steps until expanded", () => {
    assert.equal(visibleStepCount(3, false), 3);
    assert.equal(visibleStepCount(STEPS_FOLD_AFTER, false), STEPS_FOLD_AFTER);
    assert.equal(visibleStepCount(STEPS_FOLD_AFTER + 1, false), STEPS_PREVIEW);
    assert.equal(visibleStepCount(24, true), 24);
  });
});

describe("description", () => {
  test("an imported exercise's description repeats its first step and is not shown; the starters' are", () => {
    let starters = 0;
    for (const row of SOURCES) {
      const shown = shownDescription(row.description, row.instructions);
      if (row.id.startsWith("free-exercise-db-")) assert.equal(shown, null, row.id);
      else {
        assert.equal(shown, row.description?.trim(), row.id);
        starters += 1;
      }
    }
    assert.equal(starters, 30);
  });

  test("empty, blank or repeated descriptions are not shown", () => {
    assert.equal(shownDescription("", ["Stand tall."]), null);
    assert.equal(shownDescription(null, []), null);
    assert.equal(shownDescription(" Stand  tall. ", ["stand tall."]), null);
    assert.equal(shownDescription("A short summary.", []), "A short summary.");
    assert.equal(shownDescription("A short summary.", ["", "Stand tall."]), "A short summary.");
  });
});

describe("muscles", () => {
  test("the muscle line uses only the catalogue's own muscle words", () => {
    assert.equal(muscleSummary("hamstrings", ["glutes", "lower_back"]), "Works the hamstrings, with the glutes and lower back assisting.");
    assert.equal(muscleSummary("chest", []), "Works the chest.");
    assert.equal(muscleSummary("chest", ["chest", "Triceps", "triceps"]), "Works the chest, with the triceps assisting.");
    assert.equal(muscleSummary("cardio", ["calves"]), null, "cardio is not a muscle on the map");
    assert.equal(muscleSummary("quadriceps", ["cardio", "glutes"]), "Works the quadriceps, with the glutes assisting.");
    assert.equal(muscleSummary(null, ["glutes"]), null);
    assert.equal(
      muscleSummary("lower_back", ["calves", "forearms", "glutes", "hamstrings", "lats"]),
      "Works the lower back, with the calves, forearms, glutes and 2 more assisting.",
      "at most three assisting muscles are named",
    );
    for (const row of DERIVED) {
      const summary = muscleSummary(row.primary_muscle, row.secondary_muscles);
      if (!summary) continue;
      const words = new Set([row.primary_muscle, ...(row.secondary_muscles ?? [])].map(muscleWords));
      const named = summary.replace(/^Works the |\.$/g, "").replace(/, with the | assisting|, | and /g, "|").split("|").filter((word) => word && !/^\d+ more$/.test(word));
      for (const word of named) assert.ok(words.has(word), `${row.id}: "${word}" is one of its catalogue muscles`);
      assert.ok(named.length <= 1 + SUMMARY_ASSISTING, `${row.id}: a short line`);
    }
  });

  test("lists: primary and assisting muscles with their regions, as the map draws them", () => {
    const bench = muscleRows("chest", ["triceps", "front_deltoids"]);
    assert.deepEqual(bench.primary, [{ name: "chest", regions: ["chest"], direct: true }]);
    assert.deepEqual(bench.assisting, [{ name: "triceps", regions: ["triceps"], direct: true }, { name: "front deltoids", regions: ["shoulders"], direct: false }]);
    const rdl = muscleRows("hamstrings", ["glutes", "back"]);
    assert.deepEqual(rdl.assisting.map((row) => [row.name, row.regions]), [["glutes", ["glutes"]], ["back", ["traps", "lats", "middle_back", "lower_back"]]]);
    const jacks = muscleRows("cardio", ["calves", "shoulders"]);
    assert.deepEqual([jacks.primary, jacks.notDrawn], [[], ["cardio"]]);
    assert.deepEqual(jacks.assisting.map((row) => row.name), ["calves", "shoulders"]);
    const calfRaise = muscleRows("calves", ["ankles"]);
    assert.deepEqual([calfRaise.primary.map((row) => row.name), calfRaise.assisting], [["calves"], []], "ankles are drawn as the calves, already listed");
    assert.equal(muscleRows("lower_back", []).primary[0].direct, true);
    assert.deepEqual(muscleRows(null, null), { primary: [], assisting: [], notDrawn: [] });
  });

  test("for every exercise the lists cover exactly the map's primary and secondary regions", () => {
    for (const row of DERIVED) {
      const rows = muscleRows(row.primary_muscle, row.secondary_muscles);
      const regions = exerciseRegions(row.primary_muscle, row.secondary_muscles);
      assert.deepEqual(rows.primary.flatMap((item) => item.regions), regions.primary, `${row.id} primary`);
      assert.deepEqual(rows.assisting.flatMap((item) => item.regions), regions.secondary, `${row.id} assisting`);
    }
  });

  test("word lists", () => {
    assert.equal(listWords([]), "");
    assert.equal(listWords(["glutes"]), "glutes");
    assert.equal(listWords(["glutes", "core"]), "glutes and core");
    assert.equal(listWords(["a", "b", "c"]), "a, b and c");
    assert.equal(muscleWords(" Lower_Back "), "lower back");
  });
});

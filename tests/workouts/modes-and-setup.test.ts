// Workouts and the library (phases 7 and 12): the Home and Gym tabs, the first-time setup, the equipment photos and
// the anatomy tiles. Behaviour is covered by flow 18; these pin the contracts other streams and flows rely on.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { AREA_CROPS } from "@/components/training/muscle-crops";
import { setupLaterKey, setupSteps } from "@/components/workouts/setup-steps";
import { EQUIPMENT_PHOTOS, equipmentPhoto } from "@/lib/training/equipment-photos";
import { FOCUS_AREAS } from "@/lib/training/focus";
import { EQUIPMENT_KEYS } from "@/lib/training/taxonomy";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Home and Gym tabs", () => {
  const tabs = read("src/components/workouts/ModeTabs.tsx");
  const css = read("src/components/workouts/ModeTabs.module.css");
  test("a tablist with the tabs Home and Gym, arrow keys and roving focus", () => {
    assert.match(tabs, /role="tablist"/);
    assert.match(tabs, /role="tab"/);
    assert.match(tabs, /aria-selected=\{on\}/);
    assert.match(tabs, /tabIndex=\{on \? 0 : -1\}/);
    assert.match(tabs, /modeForKey\(event\.key, mode\)/);
    assert.match(tabs, /role="tabpanel"/);
  });
  test("sliding content is clipped, so a phone never zooms out mid-slide", () => {
    assert.match(css, /\.panel \{[^}]*overflow-x: clip;/);
    assert.match(read("src/components/workouts/WorkoutSetup.module.css"), /\.stage \{ overflow-x: clip;/);
    assert.match(read("src/components/workouts/WorkoutSetupFlow.tsx"), /useState<1 \| -1 \| 0>\(0\)/, "the first step does not slide in");
  });
  test("motion is transform and opacity, and reduced motion only fades", () => {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.doesNotMatch(css, /transition:[^;]*\b(width|height|left|top|margin)\b/);
  });
  test("both pages use them with their own names", () => {
    const workouts = read("src/app/(dashboard)/workouts/page.tsx");
    const library = read("src/app/(dashboard)/exercises/page.tsx");
    assert.match(workouts, /<ModeTabs mode=\{mode\} onChange=\{changeMode\}/);
    assert.match(library, /<ModeTabs mode=\{state\.context\} onChange=\{switchContext\}[^>]*label="Exercise library mode"/);
    assert.doesNotMatch(library, /aria-label="Where you train"/, "the old place switch is replaced by the tabs");
    assert.match(library, /writeStoredMode\(next\)/);
    assert.match(workouts, /writeStoredMode\(next\)/);
  });
  test("Home mode and exercise pages use formcheck's AI Form Check entry", () => {
    const home = read("src/components/workouts/HomeCollection.tsx");
    assert.match(home, /<FormCheckEntry variant="card" \/>/, "one card on the Home mode");
    assert.match(home, /<FormCheckEntry variant="inline" exerciseId=\{open\.id\} exerciseName=\{open\.name\} \/>/, "a chip beside an exercise, matched as cameraRuleFor({ id, name })");
    assert.doesNotMatch(home, /HOME_WORKOUT|FormCheckLink/, "the interim link is gone");
    const header = read("src/components/exercises/detail/ExerciseHeader.tsx");
    assert.match(header, /\{cameraRuleId && <FormCheckEntry variant="inline" exerciseId=\{cameraRuleId\} \/>\}/);
    assert.doesNotMatch(header, /HOME_WORKOUT/);
    const entry = read("src/components/form-check/FormCheckEntry.tsx");
    assert.match(entry, /aria-label="AI Form Check"/);
    assert.match(entry, /if \(!href\) return null;/, "nothing for an exercise the camera cannot analyse");
  });
  test("Your plans has no Week link to the removed week view", () => {
    assert.doesNotMatch(read("src/app/(dashboard)/workouts/page.tsx"), /homePanel\("week"\)/);
  });
});

describe("first-time setup", () => {
  test("steps follow the location: each equipment list it needs", () => {
    assert.deepEqual(setupSteps("home"), ["where", "home", "you"]);
    assert.deepEqual(setupSteps("gym"), ["where", "gym", "you"]);
    assert.deepEqual(setupSteps("both"), ["where", "home", "gym", "you"]);
    assert.equal(setupLaterKey("u1"), "fitx:workouts:v1:setup-later:u1");
  });
  test("it never blocks the page: inline with Later, editable later from Workout setup", () => {
    const page = read("src/app/(dashboard)/workouts/page.tsx");
    assert.match(page, /setup && !setup\.done && !setupLater && !setupOpen &&/);
    assert.match(page, /onLater=\{laterSetup\}/);
    assert.match(page, />Workout setup<\/button>/);
    const flow = read("src/components/workouts/WorkoutSetupFlow.tsx");
    assert.match(flow, /saveWorkoutSetup\(supabase, userId, answers, now\)/);
    assert.match(flow, />Later<\/button>/);
  });
});

describe("equipment photos", () => {
  test("every photo names a real equipment key and a file that exists", () => {
    for (const [key, photo] of Object.entries(EQUIPMENT_PHOTOS)) {
      assert.ok(EQUIPMENT_KEYS.includes(key), key);
      assert.ok(photo && existsSync(new URL(`../../public${photo.src}`, import.meta.url)), `${key}: ${photo?.src}`);
      assert.match(photo!.alt, /\S/);
    }
    assert.equal(equipmentPhoto("sled"), null, "items without a photo show their icon");
    assert.ok(Object.keys(EQUIPMENT_PHOTOS).length >= 19);
  });
});

describe("anatomy tiles", () => {
  test("every area has a crop that keeps the figure in the tile", () => {
    for (const area of FOCUS_AREAS) {
      const crop = AREA_CROPS[area];
      assert.ok(crop.scale > 0.3 && crop.scale < 2.5, area);
      assert.ok(crop.top >= 0 && crop.top <= 60, area);
      // A square tile shows 1 / (2.21 × scale) of the figure: the crop must not run past its feet.
      assert.ok(crop.top / 100 + 1 / (2.21 * crop.scale) <= 1.0001 || area === "full_body", area);
    }
  });
  test("the body map inside a tile is hidden from assistive technology (the button's name is the area)", () => {
    assert.match(read("src/components/training/MuscleRail.tsx"), /<span className=\{styles\.art\} aria-hidden="true">/);
  });
});

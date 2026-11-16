import { test } from "node:test";
import assert from "node:assert/strict";
// The derived catalogue: the same data migration 20261118130010 writes (scripts/catalog).
import { loadCatalog as deriveCatalog } from "../../scripts/catalog/catalog.mjs";
import { PROGRAMMES } from "@/data/programmes";
import { toCatalogExercise, type CatalogRow } from "@/lib/training/catalog";
import { expandOwnedEquipment } from "@/lib/training/equipment";
import { generateDay } from "@/lib/training/generator";
import { DEFAULT_GYM_EQUIPMENT } from "@/lib/training/taxonomy";

/*
 * Golden outputs: what the generator picks for every authored programme day from the real cleaned
 * catalogue, for an intermediate lifter with a fixed seed, in three equipment situations. A change
 * here is a change in what users are given, so update it deliberately:
 *   1. look at the new picks and make sure they are sensible training choices;
 *   2. replace EXPECTED with them.
 */
const catalog = (deriveCatalog() as Array<CatalogRow & { is_active: boolean }>).filter((row) => row.is_active).map(toCatalogExercise);
const PROFILES = {
  gym: expandOwnedEquipment(DEFAULT_GYM_EQUIPMENT),
  "home-none": expandOwnedEquipment([]),
  "home-db": expandOwnedEquipment(["dumbbell", "bench"]),
} as const;

const EXPECTED: Record<string, { exercises: string[]; unfilled: string[] }> = {
  "ppl-3/push-a@gym": {
    "exercises": [
      "Barbell Bench Press",
      "Standing Military Press",
      "Incline Dumbbell Press",
      "Dumbbell Lateral Raise",
      "Triceps Pushdown",
      "Dumbbell Overhead Triceps Extension"
    ],
    "unfilled": []
  },
  "ppl-3/pull-a@gym": {
    "exercises": [
      "Pull-Up",
      "Barbell Row",
      "Reverse Flyes",
      "Barbell Curl",
      "Hammer Curls"
    ],
    "unfilled": []
  },
  "ppl-3/legs-a@gym": {
    "exercises": [
      "Barbell Back Squat",
      "Romanian Deadlift",
      "Leg Press",
      "Lying Leg Curls",
      "Standing Calf Raise",
      "Front Plank"
    ],
    "unfilled": []
  },
  "ppl-6/push-a@gym": {
    "exercises": [
      "Barbell Bench Press",
      "Standing Military Press",
      "Incline Dumbbell Press",
      "Dumbbell Lateral Raise",
      "Triceps Pushdown",
      "Dumbbell Overhead Triceps Extension"
    ],
    "unfilled": []
  },
  "ppl-6/pull-a@gym": {
    "exercises": [
      "Pull-Up",
      "Barbell Row",
      "Reverse Flyes",
      "Barbell Curl",
      "Hammer Curls"
    ],
    "unfilled": []
  },
  "ppl-6/legs-a@gym": {
    "exercises": [
      "Barbell Back Squat",
      "Romanian Deadlift",
      "Leg Press",
      "Lying Leg Curls",
      "Standing Calf Raise",
      "Front Plank"
    ],
    "unfilled": []
  },
  "ppl-6/push-b@gym": {
    "exercises": [
      "Standing Military Press",
      "Incline Dumbbell Press",
      "Close-Grip Barbell Bench Press",
      "Dumbbell Flyes",
      "Dumbbell Lateral Raise",
      "Triceps Pushdown"
    ],
    "unfilled": []
  },
  "ppl-6/pull-b@gym": {
    "exercises": [
      "Barbell Row",
      "Pull-Up",
      "Reverse Flyes",
      "Hammer Curls",
      "Barbell Shrug"
    ],
    "unfilled": []
  },
  "ppl-6/legs-b@gym": {
    "exercises": [
      "Romanian Deadlift",
      "Split Squat",
      "Hip Thrust",
      "Leg Extensions",
      "Standing Calf Raise",
      "Front Plank"
    ],
    "unfilled": []
  },
  "bro-split-5/chest@gym": {
    "exercises": [
      "Barbell Bench Press",
      "Incline Dumbbell Press",
      "Dips - Chest Version",
      "Dumbbell Flyes",
      "Cable Crossover"
    ],
    "unfilled": []
  },
  "bro-split-5/back@gym": {
    "exercises": [
      "Pull-Up",
      "Barbell Row",
      "Seated Cable Row",
      "Barbell Shrug",
      "Superman"
    ],
    "unfilled": []
  },
  "bro-split-5/shoulders@gym": {
    "exercises": [
      "Standing Military Press",
      "Arnold Dumbbell Press",
      "Dumbbell Lateral Raise",
      "Reverse Flyes",
      "Cable Seated Lateral Raise"
    ],
    "unfilled": []
  },
  "bro-split-5/legs@gym": {
    "exercises": [
      "Barbell Back Squat",
      "Leg Press",
      "Romanian Deadlift",
      "Lying Leg Curls",
      "Leg Extensions",
      "Standing Calf Raise"
    ],
    "unfilled": []
  },
  "bro-split-5/arms@gym": {
    "exercises": [
      "Close-Grip Barbell Bench Press",
      "Barbell Curl",
      "Triceps Pushdown",
      "Hammer Curls",
      "Seated One-Arm Dumbbell Palms-Down Wrist Curl"
    ],
    "unfilled": []
  },
  "upper-lower-4/upper-a@gym": {
    "exercises": [
      "Barbell Bench Press",
      "Barbell Row",
      "Standing Military Press",
      "Pull-Up",
      "Barbell Curl",
      "Triceps Pushdown"
    ],
    "unfilled": []
  },
  "upper-lower-4/lower-a@gym": {
    "exercises": [
      "Barbell Back Squat",
      "Romanian Deadlift",
      "Leg Press",
      "Lying Leg Curls",
      "Standing Calf Raise",
      "Front Plank"
    ],
    "unfilled": []
  },
  "upper-lower-4/upper-b@gym": {
    "exercises": [
      "Incline Dumbbell Press",
      "Pull-Up",
      "Dumbbell Shoulder Press",
      "Seated Cable Row",
      "Dumbbell Lateral Raise",
      "Hammer Curls",
      "Triceps Pushdown"
    ],
    "unfilled": []
  },
  "upper-lower-4/lower-b@gym": {
    "exercises": [
      "Romanian Deadlift",
      "Split Squat",
      "Hip Thrust",
      "Leg Extensions",
      "Standing Calf Raise",
      "Front Plank"
    ],
    "unfilled": []
  },
  "full-body-3/full-a@gym": {
    "exercises": [
      "Barbell Back Squat",
      "Barbell Bench Press",
      "Barbell Row",
      "Hip Thrust",
      "Front Plank"
    ],
    "unfilled": []
  },
  "full-body-3/full-b@gym": {
    "exercises": [
      "Romanian Deadlift",
      "Standing Military Press",
      "Pull-Up",
      "Split Squat",
      "Front Plank"
    ],
    "unfilled": []
  },
  "full-body-3/full-c@gym": {
    "exercises": [
      "Leg Press",
      "Incline Dumbbell Press",
      "Seated Cable Row",
      "Dumbbell Lateral Raise",
      "Front Plank"
    ],
    "unfilled": []
  },
  "home-bodyweight-3/home-a@home-none": {
    "exercises": [
      "Bodyweight Squat",
      "Push-Up",
      "Superman",
      "Glute Bridge",
      "Front Plank"
    ],
    "unfilled": []
  },
  "home-bodyweight-3/home-b@home-none": {
    "exercises": [
      "Split Squat",
      "Push-Up",
      "Superman",
      "Floor Glute-Ham Raise",
      "Side Bridge"
    ],
    "unfilled": []
  },
  "home-bodyweight-3/home-c@home-none": {
    "exercises": [
      "Bodyweight Squat",
      "Push-Ups - Close Triceps Position",
      "Handstand Push-Ups",
      "Standing Calf Raise",
      "Front Plank",
      "Jumping Jack"
    ],
    "unfilled": []
  },
  "home-bodyweight-3/home-a@home-db": {
    "exercises": [
      "Bodyweight Squat",
      "Push-Up",
      "Superman",
      "Glute Bridge",
      "Front Plank"
    ],
    "unfilled": []
  },
  "home-bodyweight-3/home-b@home-db": {
    "exercises": [
      "Split Squat",
      "Decline Push-Up",
      "Superman",
      "Dumbbell Romanian Deadlift",
      "Side Bridge"
    ],
    "unfilled": []
  },
  "home-bodyweight-3/home-c@home-db": {
    "exercises": [
      "Step-Up",
      "Bench Dips",
      "Arnold Dumbbell Press",
      "Standing Calf Raise",
      "Front Plank",
      "Jumping Jack"
    ],
    "unfilled": []
  },
  "home-dumbbell-4/db-upper-a@home-none": {
    "exercises": [
      "Push-Up",
      "Superman",
      "Handstand Push-Ups",
      "Standing Towel Triceps Extension"
    ],
    "unfilled": [
      "Side delts",
      "Biceps"
    ]
  },
  "home-dumbbell-4/db-lower-a@home-none": {
    "exercises": [
      "Bodyweight Squat",
      "Floor Glute-Ham Raise",
      "Split Squat",
      "Glute Bridge",
      "Standing Calf Raise"
    ],
    "unfilled": []
  },
  "home-dumbbell-4/db-upper-b@home-none": {
    "exercises": [
      "Push-Up",
      "Superman",
      "Handstand Push-Ups",
      "Isometric Chest Squeezes",
      "Push-Ups - Close Triceps Position"
    ],
    "unfilled": [
      "Hammer curl"
    ]
  },
  "home-dumbbell-4/db-lower-b@home-none": {
    "exercises": [
      "Walking Lunge",
      "Floor Glute-Ham Raise",
      "Single Leg Glute Bridge",
      "Standing Calf Raise",
      "Front Plank"
    ],
    "unfilled": []
  },
  "home-dumbbell-4/db-upper-a@home-db": {
    "exercises": [
      "Dumbbell Bench Press",
      "One-Arm Dumbbell Row",
      "Dumbbell Shoulder Press",
      "Dumbbell Lateral Raise",
      "Dumbbell Biceps Curl",
      "Dumbbell Overhead Triceps Extension"
    ],
    "unfilled": []
  },
  "home-dumbbell-4/db-lower-a@home-db": {
    "exercises": [
      "Goblet Squat",
      "Dumbbell Romanian Deadlift",
      "Split Squat with Dumbbells",
      "Glute Bridge",
      "Calf Raise On A Dumbbell"
    ],
    "unfilled": []
  },
  "home-dumbbell-4/db-upper-b@home-db": {
    "exercises": [
      "Incline Dumbbell Press",
      "Bent Over Two-Dumbbell Row",
      "Reverse Flyes",
      "Hammer Curls",
      "Dumbbell Flyes",
      "Bench Dips"
    ],
    "unfilled": []
  },
  "home-dumbbell-4/db-lower-b@home-db": {
    "exercises": [
      "Dumbbell Lunges",
      "Stiff-Legged Dumbbell Deadlift",
      "Single Leg Glute Bridge",
      "Standing Calf Raise",
      "Front Plank"
    ],
    "unfilled": []
  }
};

function generated() {
  const result: Record<string, { exercises: string[]; unfilled: string[] }> = {};
  for (const programme of PROGRAMMES) {
    for (const [profile, owned] of Object.entries(PROFILES)) {
      if ((programme.context === "gym") !== (profile === "gym")) continue;
      for (const day of programme.days) {
        const day_ = generateDay(day.slots, { catalog, owned, level: "intermediate", seed: "golden", context: programme.context });
        result[`${programme.id}/${day.key}@${profile}`] = { exercises: day_.items.map((item) => item.exercise.name), unfilled: day_.unfilled.map((slot) => slot.label ?? "") };
      }
    }
  }
  return result;
}

test("every programme day picks the expected exercises (golden output)", () => {
  assert.deepEqual(generated(), EXPECTED);
});

test("generated days never use a stretch, cardio in a strength slot, a duplicate, or missing equipment", () => {
  for (const programme of PROGRAMMES) {
    for (const [profile, owned] of Object.entries(PROFILES)) {
      if ((programme.context === "gym") !== (profile === "gym")) continue;
      for (const day of programme.days) {
        const { items } = generateDay(day.slots, { catalog, owned, level: "intermediate", seed: "golden", context: programme.context });
        const ids = items.map((item) => item.exercise.id);
        assert.equal(new Set(ids).size, ids.length, `${programme.id}/${day.key}@${profile}: no duplicates`);
        for (const item of items) {
          assert.equal(item.exercise.category, item.slot.category ?? "strength", `${item.exercise.name} matches its slot's category`);
          const groups = Array.isArray(item.slot.muscle) ? item.slot.muscle : [item.slot.muscle];
          assert.ok(groups.includes(item.exercise.muscle_group), `${item.exercise.name} trains ${groups.join("/")}`);
          assert.ok(item.exercise.required_equipment.every((key) => owned.has(key)), `${item.exercise.name} is doable at ${profile}`);
        }
      }
    }
  }
});

test("every exercise named by a programme or the staples list exists and is active", async () => {
  const { STAPLE_EXERCISES } = await import("@/lib/training/staples");
  const active = new Set(catalog.map((exercise) => exercise.id));
  const named = new Set<string>();
  for (const programme of PROGRAMMES) for (const day of programme.days) for (const slot of day.slots) for (const id of slot.preferred ?? []) named.add(id);
  for (const ids of Object.values(STAPLE_EXERCISES)) for (const id of ids ?? []) named.add(id);
  assert.deepEqual([...named].filter((id) => !active.has(id)), []);
});

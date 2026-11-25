// Bug 78 (workouts part): /workouts, its programme, live-workout and record pages, the Exercise library, Browse by
// muscle and every exercise page had no title of their own ("FITX — Train smart. Live fit." or "Exercise | FITX"),
// so tabs, history and the screen reader's page announcement could not tell them apart.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GENERIC_EXERCISE_TITLE, MISSING_EXERCISE_TITLE, exercisePageTitle, exerciseTitleFrom } from "@/lib/training/exercise-title";

const source = (file: string) => readFileSync(file, "utf8");
const titleOf = (file: string) => source(file).match(/export const metadata: Metadata = \{ title: "([^"]+)" \};/)?.[1] ?? null;

describe("each route has its own title (the root template adds ' | FITX')", () => {
  test("client pages get theirs from a layout beside them", () => {
    assert.equal(titleOf("src/app/(dashboard)/workouts/layout.tsx"), "Workouts");
    assert.equal(titleOf("src/app/(dashboard)/workouts/active/layout.tsx"), "Active workout");
    assert.equal(titleOf("src/app/(dashboard)/workouts/programme/layout.tsx"), "Programme");
    assert.equal(titleOf("src/app/(dashboard)/exercises/layout.tsx"), "Exercise library");
    assert.equal(titleOf("src/app/(dashboard)/exercises/muscles/layout.tsx"), "Browse by muscle");
    // Already titled, kept: the history list and AI Form Check.
    assert.equal(titleOf("src/app/(dashboard)/workouts/history/page.tsx"), "Workout history");
    assert.equal(titleOf("src/app/(dashboard)/workouts/form-check/page.tsx"), "AI Form Check");
    assert.match(source("src/app/layout.tsx"), /template: "%s \| FITX"/);
  });

  test("a workout record is 'Workout record'; an address that is not a workout keeps 'Page not found'", () => {
    const page = source("src/app/(dashboard)/workouts/history/[id]/page.tsx");
    assert.doesNotMatch(page, /export const metadata/);
    assert.match(page, /return \{ title: SESSION_ID\.test\(id\) \? "Workout record" : "Page not found" \};/);
    assert.match(page, /if \(!SESSION_ID\.test\(id\)\) notFound\(\);/, "the same check decides the page");
  });

  test("an exercise page is titled with the exercise (a merged id: the exercise it became)", () => {
    const page = source("src/app/(dashboard)/exercises/[id]/page.tsx");
    assert.doesNotMatch(page, /title: "Exercise"/);
    assert.match(page, /return \{ title: await exercisePageTitle\(survivingExerciseId\(id\)\) \};/);
  });
});

describe("exercisePageTitle", () => {
  const answer = (rows: unknown, ok = true) => {
    const calls: Array<{ url: string; init: RequestInit & { next?: { revalidate?: number } } }> = [];
    const fetch = async (url: string, init: RequestInit & { next?: { revalidate?: number } }) => {
      calls.push({ url, init });
      return { ok, json: async () => rows };
    };
    return { calls, fetch };
  };

  test("reads the active catalogue row's name with the publishable key, cached for ten minutes", async () => {
    const { calls, fetch } = answer([{ name: "Front Plank" }]);
    assert.equal(await exercisePageTitle("plank", { url: "https://db.example/", key: "pk", fetch }), "Front Plank");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://db.example/rest/v1/exercise_library?select=name&is_active=eq.true&id=eq.plank&limit=1");
    assert.deepEqual(calls[0].init.headers, { apikey: "pk", Authorization: "Bearer pk", Accept: "application/json" });
    assert.equal(calls[0].init.next?.revalidate, 600);
    assert.ok(calls[0].init.signal, "a time limit");
  });

  test("an unknown exercise is 'Exercise not found'; a failure or no database gives the plain title", async () => {
    assert.equal(await exercisePageTitle("no_such_move", { url: "https://db.example", key: "pk", fetch: answer([]).fetch }), MISSING_EXERCISE_TITLE);
    assert.equal(await exercisePageTitle("plank", { url: "https://db.example", key: "pk", fetch: answer(null, false).fetch }), GENERIC_EXERCISE_TITLE);
    const throwing = async () => { throw new Error("offline"); };
    assert.equal(await exercisePageTitle("plank", { url: "https://db.example", key: "pk", fetch: throwing }), GENERIC_EXERCISE_TITLE);
    assert.equal(await exercisePageTitle("plank", { url: null, key: null, fetch: answer([{ name: "x" }]).fetch }), GENERIC_EXERCISE_TITLE);
  });

  test("an address that cannot be an exercise id is not sent to the database", async () => {
    const { calls, fetch } = answer([{ name: "x" }]);
    for (const id of ["a b", "x,y", "id=eq.1", "../etc", ""]) assert.equal(await exercisePageTitle(id, { url: "https://db.example", key: "pk", fetch }), GENERIC_EXERCISE_TITLE, id);
    assert.equal(calls.length, 0);
  });

  test("the name is tidied and kept to a title's length", () => {
    assert.equal(exerciseTitleFrom([{ name: "  Barbell   Bench Press " }]), "Barbell Bench Press");
    assert.equal(exerciseTitleFrom([{ name: "" }]), GENERIC_EXERCISE_TITLE);
    assert.equal(exerciseTitleFrom({ message: "error" }), GENERIC_EXERCISE_TITLE);
    assert.equal(exerciseTitleFrom([{ name: "x".repeat(300) }]).length, 120);
  });
});

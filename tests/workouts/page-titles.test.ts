// Bug 78 (workouts part): /workouts, its programme, live-workout and record pages, the Exercise library, Browse by
// muscle and every exercise page had no title of their own ("FITX — Train smart. Live fit." or "Exercise | FITX"),
// so tabs, history and the screen reader's page announcement could not tell them apart. Re-check of release 3: the
// Workouts and Exercise library layouts set their titles as plain strings, which in Next ends the root layout's
// "%s | FITX" template for every page below them ("Programme", "Workout history", "Front Plank" with no suffix).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { resolveTitle } from "next/dist/lib/metadata/resolvers/resolve-title.js";
import { GENERIC_EXERCISE_TITLE, MISSING_EXERCISE_TITLE, exercisePageTitle, exerciseTitleFrom } from "@/lib/training/exercise-title";

const source = (file: string) => readFileSync(file, "utf8");
const titleOf = (file: string) => source(file).match(/export const metadata: Metadata = \{ title: "([^"]+)" \};/)?.[1] ?? null;
const ROOT_TEMPLATE = source("src/app/layout.tsx").match(/title: \{ default: [^,]+, template: "([^"]+)" \}/)?.[1] ?? null;

/** A segment's static title as Next reads it: a string, { default, template }, or none. */
function staticTitle(file: string): Metadata["title"] | null {
  if (!existsSync(file)) return null;
  const text = source(file);
  const withTemplate = text.match(/export const metadata: Metadata = \{ title: \{ default: "([^"]+)", template: "([^"]+)" \} \};/);
  if (withTemplate) return { default: withTemplate[1], template: withTemplate[2] };
  return titleOf(file);
}

/**
 * The document title Next 16 gives a route whose segments (root layout first, page last) have these titles: each title
 * is resolved with the template the segments above passed on, and after each segment but the last layout and its page
 * the template becomes that segment's resolved one, which a plain string leaves empty (accumulateMetadata in
 * next/dist/lib/metadata/resolve-metadata.js; resolveTitle is Next's own).
 */
function documentTitle(segments: ReadonlyArray<Metadata["title"] | null>): string | null {
  let resolved: ReturnType<typeof resolveTitle> | null = null;
  let template: string | null = null;
  for (let index = 0; index < segments.length; index++) {
    const title = segments[index];
    if (title != null) resolved = resolveTitle(title, template);
    if (index < segments.length - 2) template = resolved?.template ?? null;
  }
  return resolved?.absolute ?? null;
}

const APP = "src/app/(dashboard)";
/** The segments of an app route below (dashboard): each folder's layout title, then the page's (`page`, or its file's). */
function routeTitle(route: string, page?: Metadata["title"]): string | null {
  const parts = route.split("/").filter(Boolean);
  const layouts = parts.map((_, index) => staticTitle(path.join(APP, ...parts.slice(0, index + 1), "layout.tsx")));
  const root = { default: "FITX — Train smart. Live fit.", template: ROOT_TEMPLATE ?? "" };
  return documentTitle([root, staticTitle(`${APP}/layout.tsx`), ...layouts, page ?? staticTitle(path.join(APP, ...parts, "page.tsx"))]);
}

describe("each route has its own title, and the root template adds ' | FITX' to every one", () => {
  test("the root layout's template", () => {
    assert.equal(ROOT_TEMPLATE, "%s | FITX");
  });

  test("the resolver works as Next does: a plain-string layout ends the template for the pages below it", () => {
    const root = { default: "FITX", template: "%s | FITX" };
    assert.equal(documentTitle([root, null, "Workouts", "Programme", null]), "Programme", "release 3 before this re-check");
    assert.equal(documentTitle([root, null, { default: "Workouts", template: "%s | FITX" }, "Programme", null]), "Programme | FITX");
    assert.equal(documentTitle([root, null, "Workouts", null]), "Workouts | FITX", "the layout's own page keeps the root's suffix");
  });

  test("Workouts and every page below it", () => {
    assert.equal(routeTitle("/workouts"), "Workouts | FITX");
    assert.equal(routeTitle("/workouts/programme"), "Programme | FITX");
    assert.equal(routeTitle("/workouts/active"), "Active workout | FITX");
    assert.equal(routeTitle("/workouts/history"), "Workout history | FITX");
    assert.equal(routeTitle("/workouts/form-check"), "AI Form Check | FITX");
    // The record's title comes from generateMetadata (tested below).
    assert.equal(routeTitle("/workouts/history/[id]", "Workout record"), "Workout record | FITX");
    assert.equal(routeTitle("/workouts/history/[id]", "Page not found"), "Page not found | FITX");
  });

  test("the Exercise library and every page below it", () => {
    assert.equal(routeTitle("/exercises"), "Exercise library | FITX");
    assert.equal(routeTitle("/exercises/muscles"), "Browse by muscle | FITX");
    assert.equal(routeTitle("/exercises/[id]", "Front Plank"), "Front Plank | FITX");
    assert.equal(routeTitle("/exercises/[id]", MISSING_EXERCISE_TITLE), "Exercise not found | FITX");
  });

  test("a layout with pages below it passes the template on, in every workouts and exercise folder", () => {
    const routesBelow = (dir: string): boolean => readdirSync(dir, { withFileTypes: true }).some((entry) => entry.isDirectory() && !entry.name.startsWith("_")
      && (existsSync(path.join(dir, entry.name, "page.tsx")) || routesBelow(path.join(dir, entry.name))));
    const layouts = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
      ? layouts(path.join(dir, entry.name)) : entry.name === "layout.tsx" ? [path.join(dir, entry.name)] : []);
    const checked = [`${APP}/workouts`, `${APP}/exercises`, `${APP}/home-workout`].filter(existsSync).flatMap(layouts);
    assert.ok(checked.length >= 5, checked.join(", "));
    for (const file of checked) {
      if (!routesBelow(path.dirname(file))) continue;
      const title = staticTitle(file);
      assert.ok(title && typeof title === "object" && "template" in title && title.template === "%s | FITX", `${file} passes " | FITX" on`);
    }
  });

  test("client pages get theirs from a layout beside them", () => {
    assert.deepEqual(staticTitle(`${APP}/workouts/layout.tsx`), { default: "Workouts", template: "%s | FITX" });
    assert.deepEqual(staticTitle(`${APP}/exercises/layout.tsx`), { default: "Exercise library", template: "%s | FITX" });
    assert.equal(titleOf(`${APP}/workouts/active/layout.tsx`), "Active workout");
    assert.equal(titleOf(`${APP}/workouts/programme/layout.tsx`), "Programme");
    assert.equal(titleOf(`${APP}/exercises/muscles/layout.tsx`), "Browse by muscle");
    // Already titled, kept: the history list and AI Form Check.
    assert.equal(titleOf(`${APP}/workouts/history/page.tsx`), "Workout history");
    assert.equal(titleOf(`${APP}/workouts/form-check/page.tsx`), "AI Form Check");
  });

  test("a workout record is 'Workout record'; an address that is not a workout keeps 'Page not found'", () => {
    const page = source(`${APP}/workouts/history/[id]/page.tsx`);
    assert.doesNotMatch(page, /export const metadata/);
    assert.match(page, /return \{ title: SESSION_ID\.test\(id\) \? "Workout record" : "Page not found" \};/);
    assert.match(page, /if \(!SESSION_ID\.test\(id\)\) notFound\(\);/, "the same check decides the page");
  });

  test("an exercise page is titled with the exercise (a merged id: the exercise it became)", () => {
    const page = source(`${APP}/exercises/[id]/page.tsx`);
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

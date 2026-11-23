// The demonstration model and index (wave 2, D6): one index fetch and one setup read per page, however many cards;
// cards swap to the member's model's start frame; the index can only point at the demo files.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEMO_ATTRIBUTION, DEMO_LABEL, DEMO_LICENSE, EMPTY_DEMO_INDEX, demoCoverFrame, demoForLibraryIds, demoFramePath, demoModelsFor, demoStills,
  isDemoMediaUrl, isOptimizableImageUrl, parseDemoIndex, resolveExerciseMedia, withDemoMedia, PINNED_PHOTO_BASE,
} from "@/lib/training/media";
import { thumbSource } from "@/components/exercises/thumb-source";
import { createDemoStore, DEMO_SETUP_NOTE } from "@/lib/training/use-demo-model";
import { loadDemoModel, saveDemoModel } from "@/lib/training/setup";

const index = (items: Record<string, unknown>, credit?: unknown) => parseDemoIndex({ version: 1, items, ...(credit ? { credit } : {}) });
const both = (id: string) => ({
  male: { frames: [demoFramePath("male", id, 0), demoFramePath("male", id, 1)], captions: ["Plank, arms straight", "Chest near the floor"] },
  female: { frames: [demoFramePath("female", id, 0), demoFramePath("female", id, 1)], captions: ["Plank, arms straight", "Chest near the floor"] },
});

describe("one index fetch and one setup read per page", () => {
  test("50 cards make 2 requests: the index and the member's model", async () => {
    let fetches = 0;
    let reads = 0;
    const store = createDemoStore({
      fetchIndex: async () => { fetches += 1; return { version: 1, items: { push_up: both("push_up") } }; },
      loadModel: async () => { reads += 1; return "female"; },
      saveModel: async () => ({ error: null, stored: true }),
    });
    const cards = Array.from({ length: 50 }, () => Promise.all([store.loadIndex(), store.loadModel()]));
    await Promise.all(cards);
    assert.equal(fetches + reads, 2);
    assert.deepEqual([fetches, reads], [1, 1]);
    assert.deepEqual(store.index()?.models.get("push_up"), ["male", "female"]);
    assert.equal(store.model(), "female");
  });

  test("a page that knows the model reads nothing; a choice made on the page wins and is saved", async () => {
    const saved: string[] = [];
    let notified = 0;
    const store = createDemoStore({ fetchIndex: async () => null, loadModel: async () => "male", saveModel: async (model) => { saved.push(model); return { error: null, stored: true }; } });
    store.subscribe(() => { notified += 1; });
    assert.equal(store.model("male"), "male");
    assert.equal(store.model(null), null, "a page that says unknown stays unknown");
    await store.choose("female");
    assert.deepEqual(saved, ["female"]);
    assert.equal(store.model("male"), "female");
    assert.ok(notified >= 1, "every card hears the change");
  });

  test("no index file (404), a broken one or a failed read: an empty index, and nothing changes", async () => {
    for (const fetchIndex of [async () => null, async () => ({ version: 99 }), async () => { throw new Error("offline"); }]) {
      const store = createDemoStore({ fetchIndex, loadModel: async () => { throw new Error("offline"); }, saveModel: async () => ({ error: null, stored: false }) });
      assert.equal(await store.loadIndex(), EMPTY_DEMO_INDEX);
      assert.equal(await store.loadModel(), null);
    }
  });
});

describe("the index", () => {
  test("only exact demo paths for their model and exercise are kept; captions are trimmed to 120 characters", () => {
    const parsed = index({
      push_up: { male: { frames: ["/media/demos/male/push_up/0.webp", "/media/demos/male/push_up/1.webp"], captions: [`  ${"A".repeat(130)} `, 7] } },
      plank: { female: { frames: ["https://example.org/a.webp", "/media/demos/female/plank/1.webp"], captions: ["", ""] } },
      squat: { male: { frames: ["/media/demos/female/squat/0.webp", "/media/demos/female/squat/1.webp"], captions: [] } },
      "../etc": both("etc"),
    });
    assert.ok(parsed);
    assert.deepEqual([...parsed.items.keys()], ["push_up"]);
    assert.equal(parsed.items.get("push_up")?.male?.captions[0].length, 120);
    assert.equal(parsed.items.get("push_up")?.male?.captions[1], "");
    assert.deepEqual(parsed.credit, { attribution: DEMO_ATTRIBUTION, license: DEMO_LICENSE });
    assert.equal(parseDemoIndex({ version: 2, items: {} }), null);
  });

  test("demo files are never optimised by next/image", () => {
    assert.equal(isDemoMediaUrl("/media/demos/female/push_up/1.webp"), true);
    assert.equal(isDemoMediaUrl("/media/demos/female/push_up/2.webp"), false);
    assert.equal(isOptimizableImageUrl("/media/demos/male/push_up/0.webp", "https://abc.supabase.co"), false);
    assert.equal(isOptimizableImageUrl(`${PINNED_PHOTO_BASE}Pushups/0.jpg`, "https://abc.supabase.co"), true);
  });

  test("an entry becomes stills at positions 2 and 3 (male) and 4 and 5 (female), labelled as AI demonstrations", () => {
    const parsed = index({ push_up: both("push_up") })!;
    const stills = demoStills("push_up", "Push-Up", parsed.items.get("push_up"), parsed.credit);
    assert.deepEqual(stills.map((still) => [still.model, still.position]), [["male", 2], ["male", 3], ["female", 4], ["female", 5]]);
    assert.ok(stills.every((still) => still.aiDemo && still.attribution === DEMO_ATTRIBUTION && still.license === DEMO_LICENSE));
    assert.match(stills[0].alt, new RegExp(DEMO_LABEL.toLowerCase()));
    assert.deepEqual(stills.map((still) => still.caption), ["Plank, arms straight", "Chest near the floor", "Plank, arms straight", "Chest near the floor"]);
  });
});

describe("media follows the member's model, with Free Exercise DB as the fallback", () => {
  const photos = resolveExerciseMedia({ exerciseId: "push_up", name: "Push-Up", sourceRef: "Pushups", rows: null });
  const parsed = index({ push_up: both("push_up"), plank: { male: both("plank").male } })!;

  test("the member's model replaces the photos; never two people in one loop", () => {
    const female = withDemoMedia(photos, { exerciseId: "push_up", name: "Push-Up", index: parsed, model: "female" });
    assert.deepEqual(female.stills.map((still) => still.url), [demoFramePath("female", "push_up", 0), demoFramePath("female", "push_up", 1)]);
    const male = withDemoMedia(photos, { exerciseId: "push_up", name: "Push-Up", index: parsed, model: "male" });
    assert.deepEqual(male.stills.map((still) => still.model), ["male", "male"]);
  });

  test("a model the exercise lacks, or no choice: the real photos, and the other model is left out", () => {
    const plank = resolveExerciseMedia({ exerciseId: "plank", name: "Plank", sourceRef: "Plank", rows: null });
    const female = withDemoMedia(plank, { exerciseId: "plank", name: "Plank", index: parsed, model: "female" });
    assert.ok(female.stills.every((still) => !still.model && still.url.startsWith(PINNED_PHOTO_BASE)));
    const none = withDemoMedia(photos, { exerciseId: "push_up", name: "Push-Up", index: parsed, model: null });
    assert.ok(none.stills.every((still) => !still.aiDemo));
    assert.equal(withDemoMedia(photos, { exerciseId: "squat", name: "Squat", index: parsed, model: "male" }), photos, "no entry: unchanged");
    assert.equal(withDemoMedia(photos, { exerciseId: "push_up", name: "Push-Up", index: null, model: "male" }), photos, "no index: unchanged");
  });

  test("with no photo at all (jumping_jack), a demonstration shows even without a choice", () => {
    const jack = resolveExerciseMedia({ exerciseId: "jumping_jack", name: "Jumping Jack", rows: null });
    assert.equal(jack.stills.length, 0);
    const shown = withDemoMedia(jack, { exerciseId: "jumping_jack", name: "Jumping Jack", index: index({ jumping_jack: both("jumping_jack") }), model: null });
    assert.deepEqual(shown.stills.map((still) => still.model), ["male", "male"]);
  });

  test("ExerciseCover's swap: the chosen model's start frame replaces the card photo; otherwise the photo stays", () => {
    const base = { exerciseId: "push_up", name: "Push-Up", src: `${PINNED_PHOTO_BASE}Pushups/0.jpg` };
    assert.deepEqual(thumbSource({ ...base, demo: { index: parsed, model: "female" } }), { url: demoFramePath("female", "push_up", 0), alt: "Push-Up, AI demonstration made from a real photo of the movement", aiDemo: true });
    assert.equal(thumbSource({ ...base, demo: { index: parsed, model: null } })?.url, base.src);
    assert.equal(thumbSource({ ...base, demo: { index: null, model: "female" } })?.url, base.src, "while the index loads");
    assert.equal(thumbSource({ ...base, exerciseId: "plank", demo: { index: parsed, model: "female" } })?.url, base.src, "female missing: the photo");
    assert.equal(demoCoverFrame(parsed, "plank", "male"), demoFramePath("male", "plank", 0));
    assert.deepEqual(demoModelsFor(parsed, "plank"), ["male"]);
  });

  test("the Form Check reel uses the first library id the index has for the member's model", () => {
    const found = demoForLibraryIds(parsed, ["missing", "plank", "push_up"], "male");
    assert.equal(found?.exerciseId, "plank");
    assert.equal(demoForLibraryIds(parsed, ["plank"], "female"), null);
    assert.equal(demoForLibraryIds(parsed, ["push_up"], null), null);
  });
});

describe("saving and reading the model", () => {
  type Call = { table: string; op: string; values?: unknown };
  function fakeDb(rows: { updated: number; error?: { code: string; message: string } | null }) {
    const calls: Call[] = [];
    const chain = (table: string, op: string, values?: unknown, result: unknown = { data: null, error: null }) => {
      calls.push({ table, op, values });
      const builder: Record<string, unknown> = {
        eq: () => builder,
        select: () => builder,
        maybeSingle: () => Promise.resolve(result),
        then: (resolve: (value: unknown) => void) => resolve(result),
      };
      return builder;
    };
    return {
      calls,
      from(table: string) {
        return {
          update: (values: unknown) => chain(table, "update", values, rows.error ? { data: null, error: rows.error } : { data: Array.from({ length: rows.updated }, () => ({ user_id: "u" })), error: null }),
          upsert: (values: unknown) => chain(table, "upsert", values),
          select: (columns: string) => chain(table, `select ${columns}`, undefined, table === "profiles" ? { data: { gender: "Female" }, error: null } : { data: { demo_model: null }, error: null }),
        };
      },
    };
  }

  test("saving updates only demo_model; only a member with no preferences row gets one", async () => {
    const existing = fakeDb({ updated: 1 });
    assert.deepEqual(await saveDemoModel(existing as never, "u", "male"), { error: null, stored: true });
    assert.deepEqual(existing.calls.map((call) => [call.op, call.values]), [["update", { demo_model: "male" }]]);
    const fresh = fakeDb({ updated: 0 });
    await saveDemoModel(fresh as never, "u", "female");
    assert.deepEqual(fresh.calls.map((call) => call.op), ["update", "upsert"]);
    const old = fakeDb({ updated: 0, error: { code: "42703", message: "column user_preferences.demo_model does not exist" } });
    assert.deepEqual(await saveDemoModel(old as never, "u", "male"), { error: null, stored: false });
  });

  test("with no choice the profile's gender decides", async () => {
    assert.equal(await loadDemoModel(fakeDb({ updated: 0 }) as never, "u"), "female");
  });

  test("the Workouts setup note", () => {
    assert.match(DEMO_SETUP_NOTE(false), /original photos for now/);
    assert.match(DEMO_SETUP_NOTE(true), /AI demonstrations, made from real photos/);
    // The Workouts setup shows it, with "available" meaning the site's index lists at least one demonstration.
    const flow = readFileSync(new URL("../../src/components/workouts/WorkoutSetupFlow.tsx", import.meta.url), "utf8");
    assert.match(flow, /\{DEMO_SETUP_NOTE\(demosAvailable\)\}/);
    assert.match(flow, /const demosAvailable = \(demoIndex\?\.size \?\? 0\) > 0;/);
    assert.match(flow, /const demoIndex = useDemoIndex\(\);/);
  });
});

describe("every surface reads the index the same way (source)", () => {
  const read = (file: string) => readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8");
  test("cards, thumbnails, the player, the Home collection, the sheet and the Form Check reel", () => {
    for (const file of ["components/exercises/ExerciseCover.tsx", "components/exercises/ExerciseThumb.tsx"]) {
      const source = read(file);
      assert.match(source, /useDemoIndexData\(\)/, file);
      assert.match(source, /demo: demoFailed \? null : \{ index, model \}/, file);
    }
    assert.match(read("components/exercises/ExerciseDemoPlayer.tsx"), /withDemoMedia\(given, \{ exerciseId, name, index, model \}\)/);
    assert.match(read("components/workouts/HomeCollection.tsx"), /withDemoMedia\(/);
    assert.match(read("components/workouts/ExerciseInfoSheet.tsx"), /exerciseId=\{exercise\.id\} model=\{model\}/);
    assert.match(read("components/exercises/detail/GuidePanel.tsx"), /exerciseId=\{exercise\.id\}/);
    assert.match(read("components/form-check/DemoReel.tsx"), /demoForLibraryIds\(demos, exercise\.rule\.libraryIds, model\)/);
    assert.match(read("lib/training/use-demo-model.ts"), /fetch\(DEMO_INDEX_PATH/);
  });

  test("every surface that shows an AI demonstration frame says so, visibly and to screen readers", () => {
    // The square thumbnails (Today, the builder, Up next, the session record, pickers, alternatives, muscles).
    const thumb = read("components/exercises/ExerciseThumb.tsx");
    assert.match(thumb, /\{showPhoto && found\.aiDemo && \(/);
    assert.match(thumb, /aria-hidden="true"\s+data-ai-demo-tag/);
    assert.match(thumb, /\{size === "lg" \? "AI demo" : "AI"\}/);
    assert.match(thumb, /alt=\{found\.alt\}/);
    // Cards and the Home collection.
    assert.match(read("components/exercises/ExerciseCover.tsx"), /\{showPhoto && found\.aiDemo && <span[^>]*>AI demo<\/span>\}/);
    assert.match(read("components/workouts/HomeCollection.tsx"), />AI demo</);
    // The grid thumbnail's alt matches its tag.
    const media = read("components/exercises/ExerciseMedia.tsx");
    assert.match(media, /alt=\{url === demo \? `\$\{name\}, \$\{DEMO_LABEL\}` : `\$\{name\}, photo`\}/);
    assert.match(media, /\{url === demo \? "AI demo" : "Photo"\}/);
  });

  test("the committed index is a valid, empty index until demonstrations are accepted", () => {
    const committed = JSON.parse(readFileSync(new URL("../../public/media/demos/index.json", import.meta.url), "utf8"));
    const parsed = parseDemoIndex(committed);
    assert.ok(parsed);
    assert.equal(parsed.items.size, Object.keys(committed.items).length);
  });
});

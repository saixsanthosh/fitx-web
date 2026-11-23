// The image audit (phase 12): every active exercise has a relevant photo except the ones listed here, the stand-ins
// say what their photos show, and demonstration media follows the member's chosen model.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCatalog as deriveCatalog } from "../../scripts/catalog/catalog.mjs";
import { toCatalogExercise, type CatalogRow } from "@/lib/training/catalog";
import {
  EXERCISE_MEDIA_OPTIONAL_COLUMNS, FREE_EXERCISE_DB_ATTRIBUTION, FREE_EXERCISE_DB_LICENSE, PHOTO_STAND_INS, PINNED_PHOTO_BASE, forModel,
  resolveExerciseMedia, type ExerciseMediaRow, type MediaItem,
} from "@/lib/training/media";

const catalog = (deriveCatalog() as (CatalogRow & { is_active: boolean })[]).filter((row) => row.is_active).map(toCatalogExercise);
const cleanup = readFileSync(new URL("../../supabase/migrations/20261118130010_fitx_exercise_catalog_cleanup.sql", import.meta.url), "utf8");
/** No public-domain photo shows these movements; they say so instead of showing an unrelated picture. */
const NO_PHOTO = ["jumping_jack"];

describe("image audit", () => {
  test("every active exercise resolves a photo, except the known gaps", () => {
    const missing = catalog.filter((exercise) => !resolveExerciseMedia({ exerciseId: exercise.id, name: exercise.name, sourceRef: exercise.source_ref, rows: null }).stills.length);
    assert.deepEqual(missing.map((exercise) => exercise.id), NO_PHOTO);
    assert.ok(catalog.length > 800, `${catalog.length} active exercises`);
  });

  test("each stand-in is a real Free Exercise DB entry for an exercise without its own photos, and says what it shows", () => {
    for (const [id, standIn] of Object.entries(PHOTO_STAND_INS)) {
      const exercise = catalog.find((item) => item.id === id);
      assert.ok(exercise, `${id} is active`);
      assert.equal(exercise.source_ref, null, `${id} has no photos of its own`);
      assert.ok(cleanup.includes(`"source_ref":"${standIn.ref}"`), `${standIn.ref} is a catalogued Free Exercise DB entry`);
      assert.match(standIn.note, /^Photos show /);
      const media = resolveExerciseMedia({ exerciseId: id, name: exercise.name, rows: null });
      assert.equal(media.standIn, standIn.note);
      assert.equal(media.stills[0].url, `${PINNED_PHOTO_BASE}${standIn.ref}/0.jpg`);
      assert.match(media.stills[0].alt, /closely related variation/);
    }
  });

  test("an exercise with its own photos never uses a stand-in", () => {
    const media = resolveExerciseMedia({ exerciseId: "free-exercise-db-Cable_Crossover", name: "Cable Crossover", rows: null });
    assert.equal(media.standIn, undefined);
    assert.equal(media.stills[0].caption, undefined);
  });
});

describe("demonstration models and captions (20261123100020)", () => {
  const row = (overrides: Partial<ExerciseMediaRow>): ExerciseMediaRow => ({
    exercise_id: "push_up", kind: "video_loop", position: 0, storage_path: null, source_url: "https://example.org/a.mp4", mirrored_at: null,
    alt: null, attribution: FREE_EXERCISE_DB_ATTRIBUTION, license: FREE_EXERCISE_DB_LICENSE, ...overrides,
  });
  const rows = [
    row({ position: 0, model: "male", source_url: "https://example.org/male.mp4", caption: "  Keep a straight line.  " }),
    row({ position: 1, model: "female", source_url: "https://example.org/female.mp4" }),
  ];

  test("the member's model is kept; the other is left out", () => {
    const female = resolveExerciseMedia({ exerciseId: "push_up", name: "Push-Up", rows, model: "female" });
    assert.deepEqual(female.videos.map((item) => item.url), ["https://example.org/female.mp4"]);
    const male = resolveExerciseMedia({ exerciseId: "push_up", name: "Push-Up", rows, model: "male" });
    assert.deepEqual(male.videos.map((item) => [item.url, item.caption]), [["https://example.org/male.mp4", "Keep a straight line."]]);
  });

  test("with no choice, or a model the kind lacks, one model is shown, never both", () => {
    assert.equal(resolveExerciseMedia({ exerciseId: "push_up", name: "Push-Up", rows }).videos.length, 1);
    const items: MediaItem[] = [
      { kind: "still", url: "a", alt: "", position: 0, selfHosted: false, attribution: "", license: "" },
      { kind: "still", url: "b", alt: "", position: 1, selfHosted: false, attribution: "", license: "", model: "male" },
    ];
    assert.deepEqual(forModel(items, "female").map((item) => item.url), ["a", "b"]);
    assert.deepEqual(forModel(items, null).map((item) => item.url), ["a", "b"]);
  });

  test("the model and caption columns are read only once they exist", () => {
    assert.deepEqual([...EXERCISE_MEDIA_OPTIONAL_COLUMNS], ["model", "caption"]);
    const loader = readFileSync(new URL("../../src/components/exercises/media-loader.ts", import.meta.url), "utf8");
    assert.match(loader, /withOptionalColumns\(EXERCISE_MEDIA_OPTIONAL_COLUMNS/);
  });
});

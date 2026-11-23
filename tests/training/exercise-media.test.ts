import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EXERCISE_MEDIA_BUCKET,
  EXERCISE_MEDIA_COLUMNS,
  FREE_EXERCISE_DB_ATTRIBUTION,
  FREE_EXERCISE_DB_LICENSE,
  FREE_EXERCISE_DB_REVISION,
  freeExerciseDbRef,
  groupMediaRows,
  isOptimizableImageUrl,
  mediaCreditLines,
  mediaRowUrl,
  PINNED_PHOTO_BASE,
  pinnedPhotoUrl,
  resolveExerciseMedia,
  storagePublicUrl,
  type ExerciseMediaRow,
} from "@/lib/training/media";

const SUPABASE = "https://abcdefgh.supabase.co";
const migration = readFileSync(new URL("../../supabase/migrations/20261118130020_fitx_exercise_media.sql", import.meta.url), "utf8");
const nextConfig = readFileSync(new URL("../../next.config.ts", import.meta.url), "utf8");

const row = (overrides: Partial<ExerciseMediaRow> = {}): ExerciseMediaRow => ({
  exercise_id: "free-exercise-db-Pullups", kind: "still", position: 0, storage_path: "free-exercise-db/Pullups/0.jpg",
  source_url: `${PINNED_PHOTO_BASE}Pullups/0.jpg`, mirrored_at: null, alt: "Pullups, photo 1 of 2",
  attribution: FREE_EXERCISE_DB_ATTRIBUTION, license: FREE_EXERCISE_DB_LICENSE, ...overrides,
});

describe("matches the migration and the image config", () => {
  test("every column read exists in exercise_media", () => {
    const table = migration.slice(migration.indexOf("create table if not exists public.exercise_media"), migration.indexOf(");", migration.indexOf("create table if not exists public.exercise_media")));
    for (const column of EXERCISE_MEDIA_COLUMNS) assert.match(table, new RegExp(`\\n\\s+${column}\\s`), column);
  });

  test("the bucket, revision, credit and seeded paths are the migration's", () => {
    assert.match(migration, new RegExp(`'${EXERCISE_MEDIA_BUCKET}'`));
    assert.ok(migration.includes(`'${PINNED_PHOTO_BASE}'`), "seeded source_url prefix");
    assert.ok(migration.includes(`'${FREE_EXERCISE_DB_ATTRIBUTION}'`));
    assert.ok(migration.includes(`'${FREE_EXERCISE_DB_LICENSE}'`));
    assert.ok(migration.includes("'free-exercise-db/' || e.source_ref || '/' || frame.position || '.jpg'"));
  });

  test("next/image may load the pinned photos and project storage", () => {
    assert.ok(nextConfig.includes(`/yuhonas/free-exercise-db/${FREE_EXERCISE_DB_REVISION}/exercises/**`));
    assert.ok(nextConfig.includes(`pathname: "/storage/v1/object/**"`));
    assert.ok(PINNED_PHOTO_BASE.startsWith(`https://raw.githubusercontent.com/yuhonas/free-exercise-db/${FREE_EXERCISE_DB_REVISION}/exercises/`));
  });
});

describe("Free Exercise DB references", () => {
  test("source_ref first, else the id suffix, validated", () => {
    assert.equal(freeExerciseDbRef("bench_press", "Barbell_Bench_Press_-_Medium_Grip"), "Barbell_Bench_Press_-_Medium_Grip");
    assert.equal(freeExerciseDbRef("free-exercise-db-3_4_Sit-Up"), "3_4_Sit-Up");
    assert.equal(freeExerciseDbRef("free-exercise-db-Pullups", "../../etc"), "Pullups");
    assert.equal(freeExerciseDbRef("bench_press"), null);
    assert.equal(freeExerciseDbRef("bench_press", ""), null);
    assert.equal(freeExerciseDbRef("free-exercise-db-"), null);
    assert.equal(freeExerciseDbRef("free-exercise-db-a/b"), null);
  });

  test("pinned photo URLs", () => {
    assert.equal(pinnedPhotoUrl("Pullups", 1), `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${FREE_EXERCISE_DB_REVISION}/exercises/Pullups/1.jpg`);
  });
});

describe("storage and source URLs", () => {
  test("the public bucket URL, with or without a trailing slash", () => {
    assert.equal(storagePublicUrl("free-exercise-db/Pullups/0.jpg", SUPABASE), `${SUPABASE}/storage/v1/object/public/exercise-media/free-exercise-db/Pullups/0.jpg`);
    assert.equal(storagePublicUrl("a/b.jpg", `${SUPABASE}///`), `${SUPABASE}/storage/v1/object/public/exercise-media/a/b.jpg`);
    assert.equal(storagePublicUrl("a/b.jpg", "http://127.0.0.1:54321"), "http://127.0.0.1:54321/storage/v1/object/public/exercise-media/a/b.jpg");
  });

  test("unsafe paths and missing project URLs give nothing", () => {
    for (const path of ["../secrets/x.jpg", "a/../../b.jpg", "/abs.jpg", "a//b.jpg", "a/./b.jpg", "a b.jpg", "a?.jpg", "a%2e.jpg", ""]) {
      assert.equal(storagePublicUrl(path, SUPABASE), null, path);
    }
    assert.equal(storagePublicUrl("a.jpg", null), null);
    assert.equal(storagePublicUrl("a.jpg", "not a url"), null);
    assert.equal(storagePublicUrl("a.jpg", "javascript:alert(1)"), null);
  });

  test("a row: the mirrored copy when there is one, else its https source", () => {
    assert.deepEqual(mediaRowUrl(row({ mirrored_at: "2026-11-18T10:00:00Z" }), SUPABASE), { url: `${SUPABASE}/storage/v1/object/public/exercise-media/free-exercise-db/Pullups/0.jpg`, selfHosted: true });
    assert.deepEqual(mediaRowUrl(row(), SUPABASE), { url: `${PINNED_PHOTO_BASE}Pullups/0.jpg`, selfHosted: false });
    assert.deepEqual(mediaRowUrl(row({ mirrored_at: "2026-11-18T10:00:00Z" }), null), { url: `${PINNED_PHOTO_BASE}Pullups/0.jpg`, selfHosted: false });
    assert.deepEqual(mediaRowUrl(row({ mirrored_at: "2026-11-18T10:00:00Z", storage_path: "../x.jpg" }), SUPABASE), { url: `${PINNED_PHOTO_BASE}Pullups/0.jpg`, selfHosted: false });
    assert.equal(mediaRowUrl(row({ source_url: "http://example.org/a.jpg" }), SUPABASE), null);
    assert.equal(mediaRowUrl(row({ source_url: null, storage_path: null }), SUPABASE), null);
  });

  test("which URLs next/image may optimise", () => {
    assert.equal(isOptimizableImageUrl(`${PINNED_PHOTO_BASE}Pullups/0.jpg`, null), true);
    assert.equal(isOptimizableImageUrl(`${SUPABASE}/storage/v1/object/public/exercise-media/a.jpg`, SUPABASE), true);
    assert.equal(isOptimizableImageUrl("https://other.supabase.co/storage/v1/object/public/exercise-media/a.jpg", SUPABASE), false);
    assert.equal(isOptimizableImageUrl(`${SUPABASE}/rest/v1/exercise_media`, SUPABASE), false);
    assert.equal(isOptimizableImageUrl("https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/Pullups/0.jpg", SUPABASE), false);
    assert.equal(isOptimizableImageUrl("https://cdn.example.org/a.jpg", SUPABASE), false);
    // FITX's demonstration files ship ready-sized and are served as they are (D6: no Vercel transformations).
    assert.equal(isOptimizableImageUrl("/media/demos/female/push_up/0.webp", SUPABASE), false);
  });
});

describe("resolveExerciseMedia", () => {
  test("table missing (null) or empty: the two pinned photos", () => {
    for (const rows of [null, []]) {
      const media = resolveExerciseMedia({ exerciseId: "free-exercise-db-Pullups", name: "Pullups", rows, supabaseUrl: SUPABASE });
      assert.equal(media.origin, "pinned");
      assert.deepEqual(media.stills.map((still) => [still.url, still.alt, still.selfHosted]), [
        [`${PINNED_PHOTO_BASE}Pullups/0.jpg`, "Pullups, photo 1 of 2", false],
        [`${PINNED_PHOTO_BASE}Pullups/1.jpg`, "Pullups, photo 2 of 2", false],
      ]);
      assert.deepEqual(media.videos, []);
      assert.equal(media.stills[0].attribution, FREE_EXERCISE_DB_ATTRIBUTION);
    }
  });

  test("a starter exercise uses its source_ref; without one there is nothing", () => {
    assert.equal(resolveExerciseMedia({ exerciseId: "bench_press", name: "Barbell Bench Press", sourceRef: "Barbell_Bench_Press_-_Medium_Grip" }).stills[0].url, `${PINNED_PHOTO_BASE}Barbell_Bench_Press_-_Medium_Grip/0.jpg`);
    assert.deepEqual(resolveExerciseMedia({ exerciseId: "bench_press", name: "Barbell Bench Press", rows: [] }), { stills: [], videos: [], origin: "none" });
  });

  test("table rows: mirrored copies preferred, sorted by position, other exercises and kinds ignored", () => {
    const media = resolveExerciseMedia({
      exerciseId: "free-exercise-db-Pullups",
      name: "Pullups",
      supabaseUrl: SUPABASE,
      rows: [
        row({ position: 1, storage_path: "free-exercise-db/Pullups/1.jpg", source_url: `${PINNED_PHOTO_BASE}Pullups/1.jpg`, alt: "" }),
        row({ position: 0, mirrored_at: "2026-11-18T10:00:00Z" }),
        row({ exercise_id: "push_up", position: 0 }),
        row({ kind: "gif", position: 2 }),
      ],
    });
    assert.equal(media.origin, "table");
    assert.deepEqual(media.stills.map((still) => [still.url, still.selfHosted, still.alt]), [
      [`${SUPABASE}/storage/v1/object/public/exercise-media/free-exercise-db/Pullups/0.jpg`, true, "Pullups, photo 1 of 2"],
      [`${PINNED_PHOTO_BASE}Pullups/1.jpg`, false, "Pullups, photo 2"],
    ]);
  });

  test("rows that cannot be served fall back to the pinned photos", () => {
    const media = resolveExerciseMedia({ exerciseId: "free-exercise-db-Pullups", name: "Pullups", rows: [row({ source_url: null, mirrored_at: null })], supabaseUrl: SUPABASE });
    assert.equal(media.origin, "pinned");
    assert.equal(media.stills.length, 2);
  });

  test("a video loop is listed and keeps the pinned photos as posters", () => {
    const media = resolveExerciseMedia({
      exerciseId: "free-exercise-db-Pullups",
      name: "Pullups",
      supabaseUrl: SUPABASE,
      rows: [row({ kind: "video_loop", storage_path: "fitx/Pullups/loop.mp4", mirrored_at: "2026-12-01T00:00:00Z", source_url: null, alt: "Pullups demonstration", attribution: "FITX", license: "FITX licence" })],
    });
    assert.equal(media.origin, "table");
    assert.deepEqual(media.videos.map((video) => [video.kind, video.url, video.alt]), [["video_loop", `${SUPABASE}/storage/v1/object/public/exercise-media/fitx/Pullups/loop.mp4`, "Pullups demonstration"]]);
    assert.deepEqual(media.stills.map((still) => still.url), [`${PINNED_PHOTO_BASE}Pullups/0.jpg`, `${PINNED_PHOTO_BASE}Pullups/1.jpg`]);
  });

  test("groups rows by exercise", () => {
    const groups = groupMediaRows([row(), row({ position: 1 }), row({ exercise_id: "push_up" })]);
    assert.deepEqual([...groups.keys()], ["free-exercise-db-Pullups", "push_up"]);
    assert.equal(groups.get("free-exercise-db-Pullups")?.length, 2);
  });
});

describe("credits", () => {
  test("one line per source and licence, named by what is shown", () => {
    const pinned = resolveExerciseMedia({ exerciseId: "free-exercise-db-Pullups", name: "Pullups" });
    assert.deepEqual(mediaCreditLines(pinned.stills), [`Photos: ${FREE_EXERCISE_DB_ATTRIBUTION}. Licence: ${FREE_EXERCISE_DB_LICENSE}.`]);
    assert.deepEqual(mediaCreditLines(pinned.stills.slice(0, 1)), [`Photo: ${FREE_EXERCISE_DB_ATTRIBUTION}. Licence: ${FREE_EXERCISE_DB_LICENSE}.`]);
    const video = { ...pinned.stills[0], kind: "video_loop" as const, attribution: "FITX", license: "FITX licence" };
    assert.deepEqual(mediaCreditLines([video, pinned.stills[0]]), ["Video: FITX. Licence: FITX licence.", `Photo: ${FREE_EXERCISE_DB_ATTRIBUTION}. Licence: ${FREE_EXERCISE_DB_LICENSE}.`]);
    assert.deepEqual(mediaCreditLines([]), []);
  });
});

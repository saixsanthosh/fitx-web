import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { FORMCHECK_MEDIA } from "@/data/form-check-media";
import { HOMEWORKOUT1_MEDIA } from "@/data/home-workout-1-media";
import { HOMEWORKOUT2_MEDIA } from "@/data/home-workout-2-media";
import { EXERCISE_RULES } from "@/lib/form-rules/catalog";
import { HOME_EXERCISES, homeExercise } from "@/lib/home-workout/catalog";

const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const KNOWN = new Set<string>([...Object.values(FORMCHECK_MEDIA), ...Object.values(HOMEWORKOUT1_MEDIA), ...Object.values(HOMEWORKOUT2_MEDIA)].map((image) => image.src));

test("every exercise is on the page, and every photo comes from a checked, generated set", () => {
  assert.equal(HOME_EXERCISES.length, EXERCISE_RULES.length);
  for (const exercise of HOME_EXERCISES) {
    for (const photo of [exercise.photos.start, exercise.photos.end]) {
      if (!photo) continue;
      assert.ok(KNOWN.has(photo.image.src), `${exercise.id}: ${photo.image.src}`);
      assert.ok(photo.label.length > 2, `${exercise.id}: the photo says which position it shows`);
    }
    assert.equal(exercise.poster?.src ?? null, (exercise.photos.end ?? exercise.photos.start)?.image.src ?? null);
  }
});

test("the squat and the jumping jack play as two-position demonstrations", () => {
  for (const id of ["bodyweight_squat", "jumping_jack"]) {
    const exercise = homeExercise(id);
    assert.ok(exercise?.photos.start && exercise.photos.end, `${id} has both ends`);
    assert.notEqual(exercise.photos.start.image.src, exercise.photos.end.image.src);
  }
});

test("photos that showed the wrong technique are gone and stay gone", () => {
  // Superman (2026-11-20), the first jumping jack (arms up, feet still together) and the glute bridge
  // labelled as its top (hips still on the mat) were removed after checking by eye.
  assert.equal(homeExercise("superman")?.poster, null);
  for (const file of ["media/home-workout-1/jumping-jack.webp", "media/home-workout-1/glute-bridge.webp", "media/home-workout-2/superman.webp"]) {
    assert.equal(existsSync(new URL(`public/${file}`, ROOT)), false, file);
  }
  assert.doesNotMatch(read("src/data/home-workout-1-media.ts"), /jumping-jack|glute-bridge/);
  // The rejected generations were never published.
  for (const id of ["push-up-bottom", "shoulder-press-start", "glute-bridge-top"]) {
    assert.equal(id in FORMCHECK_MEDIA, false, id);
    assert.equal(existsSync(new URL(`public/media/form-check/${id}.webp`, ROOT)), false, id);
  }
});

test("the form-check prompts record every image the set asked for, including the rejected ones", () => {
  const manifest = JSON.parse(read("scripts/media/form-check.prompts.json")) as { images: Array<{ id: string; status?: string; prompt: string }> };
  assert.ok(manifest.images.length <= 12);
  for (const id of Object.keys(FORMCHECK_MEDIA)) assert.ok(manifest.images.some((image) => image.id === id && !image.status), id);
  for (const image of manifest.images.filter((entry) => entry.status)) assert.match(image.status ?? "", /^Rejected/);
});

test("the animated YOU is gone: no live figure, no drawn figure, no You tile", () => {
  for (const file of [
    "src/components/home-workout/LiveFigure.tsx",
    "src/components/home-workout/FigureSvg.tsx",
    "src/components/home-workout/DemoPlayer.tsx",
    "src/lib/home-workout/live-figure.ts",
    "src/lib/home-workout/figure.ts",
    "src/components/form-coach/ExerciseGlyph.tsx",
  ]) {
    assert.equal(existsSync(new URL(file, ROOT)), false, file);
  }
  const stage = read("src/components/form-coach/CoachStage.tsx");
  assert.doesNotMatch(stage, /LiveFigure|FigureSvg|>You</);
  assert.match(stage, /DemoReel/);
});

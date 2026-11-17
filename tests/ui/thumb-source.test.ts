import { test } from "node:test";
import assert from "node:assert/strict";
import { exerciseInitials, thumbSource } from "@/components/exercises/thumb-source";
import { PINNED_PHOTO_BASE } from "@/lib/training/media";

test("a free-exercise-db id gets its pinned first photo", () => {
  const found = thumbSource({ exerciseId: "free-exercise-db-Barbell_Curl", name: "Barbell curl" });
  assert.equal(found?.url, `${PINNED_PHOTO_BASE}Barbell_Curl/0.jpg`);
  assert.match(found?.alt ?? "", /Barbell curl/);
});

test("source_ref finds the photo for other ids", () => {
  const found = thumbSource({ exerciseId: "fitx-123", name: "Row", sourceRef: "Bent_Over_Row" });
  assert.equal(found?.url, `${PINNED_PHOTO_BASE}Bent_Over_Row/0.jpg`);
});

test("table media wins over the pinned photo", () => {
  const found = thumbSource({
    exerciseId: "free-exercise-db-Plank",
    name: "Plank",
    rows: [{ exercise_id: "free-exercise-db-Plank", kind: "still", position: 0, source_url: "https://example.com/plank.jpg", alt: "Plank hold" }],
  });
  assert.equal(found?.url, "https://example.com/plank.jpg");
  assert.equal(found?.alt, "Plank hold");
});

test("an explicit src is used as given; no photo gives null", () => {
  assert.equal(thumbSource({ exerciseId: "x", name: "X", src: "https://example.com/a.jpg" })?.url, "https://example.com/a.jpg");
  assert.equal(thumbSource({ exerciseId: "custom-1", name: "My move" }), null);
});

test("initials", () => {
  assert.equal(exerciseInitials("Barbell curl"), "BC");
  assert.equal(exerciseInitials("Plank"), "PL");
  assert.equal(exerciseInitials("  "), "?");
});

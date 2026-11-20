import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LIBRARY_STATE, filterChips, quickLevel, readLibraryState, withQuickLevel, writeLibraryState } from "@/app/(dashboard)/exercises/_lib/library-state";

describe("the library's level row", () => {
  test("All levels is on with no level filter; one level shows only that level", () => {
    assert.equal(quickLevel(DEFAULT_LIBRARY_STATE), null);
    const beginner = withQuickLevel(DEFAULT_LIBRARY_STATE, "beginner");
    assert.deepEqual(beginner.difficulties, ["beginner"]);
    assert.equal(quickLevel(beginner), "beginner");
    assert.deepEqual(withQuickLevel(beginner, null).difficulties, []);
  });

  test("a level replaces the earlier one, and keeps every other filter", () => {
    const state = { ...DEFAULT_LIBRARY_STATE, q: "press", muscles: ["chest" as const], difficulties: ["beginner" as const, "advanced" as const] };
    assert.equal(quickLevel(state), "mixed");
    const next = withQuickLevel(state, "intermediate");
    assert.deepEqual(next.difficulties, ["intermediate"]);
    assert.equal(next.q, "press");
    assert.deepEqual(next.muscles, ["chest"]);
  });

  test("the choice is kept in the address and shows as a removable chip", () => {
    const search = writeLibraryState(withQuickLevel(DEFAULT_LIBRARY_STATE, "advanced"));
    assert.match(search, /difficulty=advanced/);
    const back = readLibraryState(search);
    assert.equal(quickLevel(back), "advanced");
    assert.ok(filterChips(back).some((chip) => chip.kind === "Level" && chip.label === "Advanced"));
  });
});

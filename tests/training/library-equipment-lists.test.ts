import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { afterProfilesReload, listsLoadNote, withSavedList } from "@/app/(dashboard)/exercises/_lib/equipment-lists";
import type { EquipmentProfiles } from "@/lib/training/data";

const PROFILES: EquipmentProfiles = { home: ["dumbbell"], gym: null, available: true };

describe("the library's saved equipment lists", () => {
  test("a list just saved replaces that context only, sorted like the stored lists", () => {
    const next = withSavedList(PROFILES, "gym", ["dumbbell", "barbell", "bench"]);
    assert.deepEqual(next.home, ["dumbbell"]);
    assert.ok(next.gym && next.gym.length === 3 && ["barbell", "bench", "dumbbell"].every((key) => next.gym!.includes(key)));
    assert.deepEqual(withSavedList(PROFILES, "home", []).home, [], "no equipment is a saved list too");
    assert.deepEqual(PROFILES.home, ["dumbbell"], "the input is not changed");
  });

  test("a failed read back keeps what is known instead of the starting lists", () => {
    const saved = withSavedList(PROFILES, "gym", ["barbell"]);
    const failedRead = { error: new Error("offline"), profiles: { home: null, gym: null, available: true } };
    assert.deepEqual(afterProfilesReload({ profiles: saved, failed: false }, failedRead), { profiles: saved, failed: false });
    assert.deepEqual(afterProfilesReload({ profiles: saved, failed: true }, failedRead).failed, true, "an earlier failure is still reported");
  });

  test("after a failed read, the starting-list note names only a list that is still unknown", () => {
    const unknown: EquipmentProfiles = { home: null, gym: null, available: true };
    assert.equal(listsLoadNote({ profiles: unknown, failed: false }, "home"), null);
    assert.equal(listsLoadNote({ profiles: unknown, failed: true }, "home"), "Your saved lists could not be loaded, so a starting list is used for now.");
    // The Home list was saved since (its read back failed too): the results use it, so only Gym is a starting list.
    const savedHome = withSavedList(unknown, "home", ["dumbbell"]);
    assert.equal(listsLoadNote({ profiles: savedHome, failed: true }, "home"), "Your saved Gym list could not be loaded, so a starting list is used there for now.");
    assert.equal(listsLoadNote({ profiles: savedHome, failed: true }, "gym"), "Your saved lists could not be loaded, so a starting list is used for now.");
    assert.equal(listsLoadNote({ profiles: withSavedList(savedHome, "gym", []), failed: true }, "home"), null, "both known, an empty list included");
  });

  test("a good read back is used and clears an earlier failure", () => {
    const fresh = { error: null, profiles: { home: ["kettlebell"], gym: ["barbell"], available: true } };
    assert.deepEqual(afterProfilesReload({ profiles: PROFILES, failed: true }, fresh), { profiles: fresh.profiles, failed: false });
  });
});

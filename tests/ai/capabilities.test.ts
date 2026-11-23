// The eight coach jobs: starters on the page, the rules in the chat prompt, and the activity summary the coach reads.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { COACH_CAPABILITIES, capabilityStarters } from "../../src/lib/ai/capabilities.ts";

describe("coach capability starters", () => {
  test("members who share their data get every starter in personal wording", () => {
    const starters = capabilityStarters({ sharesData: true });
    assert.deepEqual(starters.map((starter) => starter.id), ["workout_plan", "meal_plan", "exercise_help", "progress", "motivation", "recovery", "adjust"]);
    assert.equal(starters.find((starter) => starter.id === "workout_plan")?.mode, "workout_plan");
    assert.match(starters.find((starter) => starter.id === "motivation")?.text ?? "", /what I've actually done/);
  });

  test("without data sharing, data starters are left out, never shown dead", () => {
    const starters = capabilityStarters({ sharesData: false });
    assert.deepEqual(starters.map((starter) => starter.id), ["exercise_help", "motivation", "recovery", "adjust"]);
    for (const starter of starters) {
      assert.equal(starter.mode, "chat");
      assert.doesNotMatch(starter.text, /\bmy (last|training this week)\b/, "general wording does not promise to read logs");
    }
  });

  test("labels stay short", () => {
    for (const capability of COACH_CAPABILITIES) assert.ok(capability.label.split(" ").length <= 4, capability.label);
  });
});

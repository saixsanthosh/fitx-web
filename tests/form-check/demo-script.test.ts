import { test } from "node:test";
import assert from "node:assert/strict";
import { EXERCISE_RULES } from "@/lib/form-rules/catalog";
import { demoScript, momentAt, phaseStart } from "@/lib/home-workout/demo-script";

test("every camera exercise has a demonstration script with short captions and one technique line each", () => {
  for (const rule of EXERCISE_RULES) {
    const script = demoScript(rule.id);
    assert.ok(script, `${rule.id} has a script`);
    assert.equal(script.phases.length, rule.motion.kind === "reps" ? 4 : 3, rule.id);
    assert.ok(script.totalMs >= 1200 && script.totalMs <= 8000, `${rule.id}: ${script.totalMs} ms`);
    for (const phase of script.phases) {
      assert.ok(phase.caption.split(" ").length <= 5, `${rule.id}: "${phase.caption}" is short`);
      assert.ok(phase.detail.length > 5 && phase.detail.length <= 48, `${rule.id}: "${phase.detail}"`);
      assert.ok(phase.ms >= 150, `${rule.id}: every phase is long enough to read or see`);
    }
  }
});

test("a rep demonstration starts at the start, moves out, holds the turnaround, and moves back", () => {
  const script = demoScript("bodyweight_squat");
  assert.ok(script);
  assert.deepEqual(script.phases.map((phase) => [phase.frame, phase.move]), [["start", false], ["end", true], ["end", false], ["start", true]]);
});

test("captions change exactly at the phase boundaries, and the photo mix eases between the two ends", () => {
  const script = demoScript("bodyweight_squat");
  assert.ok(script);
  const [start, out, turn] = script.phases;
  assert.equal(momentAt(script, 0).phase.caption, start.caption);
  assert.equal(momentAt(script, start.ms - 1).phase.caption, start.caption);
  assert.equal(momentAt(script, start.ms).phase.caption, out.caption);
  assert.equal(momentAt(script, start.ms + out.ms).phase.caption, turn.caption);
  assert.equal(momentAt(script, 0).mix, 0, "the start photo shows at the start");
  assert.equal(momentAt(script, start.ms + out.ms + 1).mix, 1, "the end photo shows at the turnaround");
  const halfway = momentAt(script, start.ms + out.ms / 2).mix;
  assert.ok(Math.abs(halfway - 0.5) < 1e-9, `halfway through the move the photos are evenly mixed (${halfway})`);
  // The dissolve is short (so two positions are rarely seen together) but never a cut, and it only goes one way per move.
  assert.equal(momentAt(script, start.ms + out.ms * 0.3).mix, 0, "the start photo holds through the first part of the move");
  assert.equal(momentAt(script, start.ms + out.ms * 0.7).mix, 1, "and the end photo is fully there before the move ends");
  let previous = momentAt(script, 0).mix;
  let steps = 0;
  for (let t = 10; t <= script.totalMs * 2; t += 10) {
    const mix = momentAt(script, t).mix;
    assert.ok(Math.abs(mix - previous) < 0.15, `jump at ${t} ms`);
    if (mix !== previous) steps += 1;
    previous = mix;
  }
  assert.ok(steps > 40, "the dissolve takes many frames");
});

test("looping wraps around; with looping off it rests on the last moment", () => {
  const script = demoScript("jumping_jack");
  assert.ok(script);
  assert.equal(momentAt(script, script.totalMs + 1).index, 0);
  assert.equal(momentAt(script, script.totalMs + 1, false).index, script.phases.length - 1);
  assert.equal(phaseStart(script, 0), 0);
  assert.equal(phaseStart(script, 2), script.phases[0].ms + script.phases[1].ms);
});

test("a hold demonstration never moves between photos", () => {
  const script = demoScript("plank");
  assert.ok(script);
  for (let t = 0; t < script.totalMs; t += 50) assert.equal(momentAt(script, t).mix, 0);
});

// Bug 51 (workouts-9): "Your split" in the builder said "From Full Body · 3 days" (the Profile's training split) for
// a member following Push, Pull, Legs, and offered only Full body days.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROGRAMMES, programmeById } from "@/data/programmes";
import { builderSplit } from "@/app/(dashboard)/workouts/_lib/split-source";

const ppl = programmeById("ppl-3")!;
const run = (overrides: Partial<Parameters<typeof builderSplit>[0]>) => builderSplit({ target: "gym", followed: null, split: "full_body", programmes: PROGRAMMES, hasDumbbells: true, ...overrides });

describe("where Your split takes its days from", () => {
  test("the programme the member follows, at the day they are on, and the builder says so", () => {
    const split = run({ followed: { programme: ppl, nextDayIndex: 1 } });
    assert.equal(split?.source, "programme");
    assert.equal(split?.programme.id, "ppl-3");
    assert.equal(split?.label, `From the programme you follow: ${ppl.title}`);
    assert.equal(split?.startDay, 1);
    assert.deepEqual(split?.programme.days.map((day) => day.title).slice(0, 3), ppl.days.map((day) => day.title).slice(0, 3));
    assert.equal(run({ followed: { programme: ppl, nextDayIndex: 4 } })?.startDay, 1, "the day wraps round the cycle");
  });

  test("without a programme: the Profile's training split, named as such", () => {
    const split = run({});
    assert.equal(split?.source, "profile");
    assert.equal(split?.programme.id, "full-body-3");
    assert.match(split?.label ?? "", /^From your training split in Profile: /);
    assert.equal(split?.startDay, 0);
    assert.equal(run({ split: "push_pull_legs" })?.programme.id, "ppl-3");
  });

  test("a gym programme does not set a home workout: home uses FITX's home track for the equipment", () => {
    const home = run({ target: "home", followed: { programme: ppl, nextDayIndex: 2 }, hasDumbbells: false });
    assert.equal(home?.source, "home");
    assert.equal(home?.programme.context, "home");
    assert.match(home?.label ?? "", /^From FITX’s home track for your equipment: /);
  });

  test("no split saved: the default programme, without claiming it came from Profile", () => {
    const split = run({ split: null });
    assert.equal(split?.source, "default");
    assert.doesNotMatch(split?.label ?? "", /Profile/);
  });
});

test("the builder uses it for its days, its first day and its line under the title", () => {
  const page = readFileSync("src/app/(dashboard)/workouts/page.tsx", "utf8");
  assert.match(page, /followed: followed && enrolment \? \{ programme: followed, nextDayIndex: enrolment\.next_day_index \} : null/);
  assert.match(page, /\{builderSplitSource && <p className="mt-1 text-sm text-fitx-text-secondary">\{builderSplitSource\.label\}<\/p>\}/);
  assert.match(page, /const startDay = nextMode === "auto" \? autoSplit\(target\)\?\.startDay \?\? 0 : 0;/);
});
